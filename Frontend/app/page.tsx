'use client'

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import ChatPanel from '../components/ChatPanel'
import GuideDialog from '../components/GuideDialog'
import GridEditor, { type DesignSelectionRect } from '../components/GridEditor'
import ImagePanel from '../components/ImagePanel'
import PalettePanel from '../components/PalettePanel'
import PreviewControls, { PreviewSettings } from '../components/PreviewControls'
import {
  assetUrl,
  chatAssistant,
  createPreview,
  fetchDmcColors,
  finalizePreview,
  importImageFromUrl,
  PaletteColor,
  uploadImage,
} from '../lib/api'

type ColorEditSnapshot = {
  cells: string[][]
  enabledColorHexes: string[]
  previewPalette: PaletteColor[]
  activePaintColor: string | null
  removalMode: 'fill' | 'blank'
  manualCellOverrides: Record<string, string>
}

type CommandResult = {
  reply: string
}

function hexToRgb(hex: string) {
  const cleaned = hex.replace('#', '')
  return [
    Number.parseInt(cleaned.slice(0, 2), 16),
    Number.parseInt(cleaned.slice(2, 4), 16),
    Number.parseInt(cleaned.slice(4, 6), 16),
  ] as const
}

function colorDistance(a: string, b: string) {
  const [ar, ag, ab] = hexToRgb(a)
  const [br, bg, bb] = hexToRgb(b)
  return Math.sqrt((ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2)
}

function colorSaturation(hex: string) {
  const [r, g, b] = hexToRgb(hex)
  return Math.max(r, g, b) - Math.min(r, g, b)
}

const DISPLAY_GROUP_DISTANCE = 12
const MIN_PALETTE_STATE_OVERLAP_RATIO = 0.6
const MOBILE_BREAKPOINT = 980

function cloneCells(source: string[][]) {
  return source.map((row) => [...row])
}

function countCellsByHex(source: string[][]) {
  const counts: Record<string, number> = {}
  source.forEach((row) => {
    row.forEach((cell) => {
      if (cell === '#FFFFFF') return
      counts[cell] = (counts[cell] ?? 0) + 1
    })
  })
  return counts
}

function pickDistinctPaletteHexes(
  palette: PaletteColor[],
  colorCountsByHex: Record<string, number>,
  targetCount: number,
  preferredHex?: string | null
) {
  if (targetCount >= palette.length) {
    return palette.map((color) => color.hex)
  }

  const maxCount = Math.max(
    1,
    ...palette.map((color) => colorCountsByHex[color.hex] ?? 0)
  )
  const selected: string[] = []

  if (preferredHex && palette.some((color) => color.hex === preferredHex)) {
    selected.push(preferredHex)
  } else {
    const topColor = [...palette].sort(
      (left, right) => (colorCountsByHex[right.hex] ?? 0) - (colorCountsByHex[left.hex] ?? 0)
    )[0]
    if (topColor) {
      selected.push(topColor.hex)
    }
  }

  while (selected.length < targetCount) {
    let bestHex: string | null = null
    let bestScore = Number.NEGATIVE_INFINITY

    palette.forEach((color) => {
      if (selected.includes(color.hex)) return

      const count = colorCountsByHex[color.hex] ?? 0
      const normalizedCount = count / maxCount
      const minDistance = selected.length
        ? Math.min(...selected.map((selectedHex) => colorDistance(color.hex, selectedHex)))
        : 0
      const saturationBonus = colorSaturation(color.hex) / 255
      const score = normalizedCount * 58 + minDistance * 0.42 + saturationBonus * 12

      if (score > bestScore) {
        bestScore = score
        bestHex = color.hex
      }
    })

    if (!bestHex) break
    selected.push(bestHex)
  }

  return selected
}

function makeCellKey(row: number, col: number) {
  return `${row}:${col}`
}

type EyeDropperResult = {
  sRGBHex: string
}

type EyeDropperConstructor = new () => {
  open: () => Promise<EyeDropperResult>
}

function applyManualOverrides(sourceCells: string[][], manualCellOverrides: Record<string, string>) {
  const entries = Object.entries(manualCellOverrides)
  if (!entries.length) return sourceCells

  const nextCells = cloneCells(sourceCells)
  entries.forEach(([key, hex]) => {
    const [rowText, colText] = key.split(':')
    const row = Number(rowText)
    const col = Number(colText)
    if (!Number.isInteger(row) || !Number.isInteger(col)) return
    if (row < 0 || row >= nextCells.length || col < 0 || col >= nextCells[row].length) return
    nextCells[row][col] = hex
  })

  return nextCells
}

function getClampedSelectionBounds(
  selection: DesignSelectionRect,
  rowCount: number,
  colCount: number
) {
  const top = Math.max(0, Math.min(selection.startRow, selection.endRow))
  const bottom = Math.min(rowCount - 1, Math.max(selection.startRow, selection.endRow))
  const left = Math.max(0, Math.min(selection.startCol, selection.endCol))
  const right = Math.min(colCount - 1, Math.max(selection.startCol, selection.endCol))

  if (top > bottom || left > right) return null

  return { top, bottom, left, right }
}

function applyPaletteStateToCells(
  sourceCells: string[][],
  sourcePalette: PaletteColor[],
  nextEnabledColorHexes: string[],
  nextRemovalMode: 'fill' | 'blank'
) {
  const enabledSet = new Set(nextEnabledColorHexes)
  const enabledPalette = sourcePalette.filter((color) => enabledSet.has(color.hex))
  const enabledHexes = enabledPalette.map((color) => color.hex)
  const nextCells = cloneCells(sourceCells).map((row) =>
    row.map((cell) => {
      if (enabledSet.has(cell)) return cell
      if (nextRemovalMode === 'blank') return '#FFFFFF'
      if (!enabledHexes.length) return '#FFFFFF'

      return enabledHexes.reduce((closest, candidate) =>
        colorDistance(cell, candidate) < colorDistance(cell, closest) ? candidate : closest
      )
    })
  )

  const usedHexes = new Set(nextCells.flat().filter((cell) => cell !== '#FFFFFF'))
  const nextPreviewPalette = sourcePalette.filter((color) => usedHexes.has(color.hex))

  return {
    nextCells,
    nextPreviewPalette,
  }
}

function collapsePaletteShades(
  sourceCells: string[][],
  sourcePalette: PaletteColor[],
  mergeDistance = DISPLAY_GROUP_DISTANCE
) {
  if (!sourceCells.length || sourcePalette.length <= 1) {
    return {
      cells: sourceCells,
      palette: sourcePalette,
    }
  }

  const counts = countCellsByHex(sourceCells)
  const sortedPalette = [...sourcePalette].sort(
    (left, right) => (counts[right.hex] ?? 0) - (counts[left.hex] ?? 0)
  )
  const dominantMap = new Map<string, string>()

  sortedPalette.forEach((dominant) => {
    if (dominantMap.has(dominant.hex)) return
    dominantMap.set(dominant.hex, dominant.hex)

    sortedPalette.forEach((candidate) => {
      if (dominantMap.has(candidate.hex)) return
      if (colorDistance(dominant.hex, candidate.hex) > mergeDistance) return
      dominantMap.set(candidate.hex, dominant.hex)
    })
  })

  const changed = sortedPalette.some((color) => dominantMap.get(color.hex) !== color.hex)
  if (!changed) {
    return {
      cells: sourceCells,
      palette: sourcePalette,
    }
  }

  const nextCells = sourceCells.map((row) => row.map((cell) => dominantMap.get(cell) ?? cell))
  const paletteByHex = new Map(sourcePalette.map((color) => [color.hex, color]))
  const nextPalette = sortedPalette
    .filter((color) => dominantMap.get(color.hex) === color.hex)
    .map((color) => paletteByHex.get(color.hex) ?? color)

  return {
    cells: nextCells,
    palette: nextPalette,
  }
}

function findOutsideBorderCoords(source: string[][], inset = 2) {
  const rowCount = source.length
  const colCount = source[0]?.length ?? 0

  if (!rowCount || !colCount) {
    return []
  }

  const visited = Array.from({ length: rowCount }, () => Array(colCount).fill(false))
  const queue: Array<[number, number]> = []
  const coords: Array<[number, number]> = []
  const seen = new Set<string>()

  function enqueue(row: number, col: number) {
    if (row < 0 || row >= rowCount || col < 0 || col >= colCount) return
    if (visited[row][col]) return

    visited[row][col] = true
    if (source[row][col] === '#FFFFFF') return

    queue.push([row, col])
    const key = `${row}:${col}`
    if (!seen.has(key)) {
      seen.add(key)
      coords.push([row, col])
    }
  }

  for (let row = 0; row < rowCount; row += 1) {
    for (let col = 0; col < colCount; col += 1) {
      const nearEdge =
        row <= inset || col <= inset || row >= rowCount - 1 - inset || col >= colCount - 1 - inset

      if (!nearEdge) continue
      enqueue(row, col)
    }
  }

  while (queue.length) {
    const [row, col] = queue.shift()!
    enqueue(row - 1, col)
    enqueue(row + 1, col)
    enqueue(row, col - 1)
    enqueue(row, col + 1)
  }

  return coords
}

function normalizeCommandText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function extractCommandNumber(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      return Number(match[1])
    }
  }

  return null
}

function getSettingsKey(settings: PreviewSettings | null) {
  if (!settings) return null

  return JSON.stringify({
    width_inches: settings.width_inches,
    height_inches: settings.height_inches,
    mesh_count: settings.mesh_count,
    color_count: settings.color_count,
    show_grid: settings.show_grid,
    clean_background: settings.clean_background,
    simplify_colors: settings.simplify_colors,
    strengthen_dark_detail: settings.strengthen_dark_detail,
    preserve_accents: settings.preserve_accents,
    contrast_level: settings.contrast_level,
    source_type: settings.source_type,
  })
}

const DEFAULT_SETTINGS: PreviewSettings = {
  width_inches: 5,
  height_inches: 5,
  mesh_count: 13,
  color_count: 128,
  show_grid: true,
  clean_background: false,
  simplify_colors: false,
  strengthen_dark_detail: false,
  preserve_accents: false,
  contrast_level: 'normal',
  source_type: 'photo',
}

function applySourceTypeDefaults(
  current: PreviewSettings,
  sourceType: 'photo' | 'stitched_photo' | 'graphic_art'
): PreviewSettings {
  if (sourceType === 'stitched_photo') {
    return {
      ...current,
      source_type: sourceType,
      color_count: 128,
      clean_background: false,
      simplify_colors: false,
      strengthen_dark_detail: false,
      preserve_accents: false,
      contrast_level: current.contrast_level === 'high' ? 'normal' : current.contrast_level,
    }
  }

  if (sourceType === 'graphic_art') {
    return {
      ...current,
      source_type: sourceType,
      color_count: 128,
      clean_background: false,
      simplify_colors: false,
      strengthen_dark_detail: false,
      preserve_accents: false,
      contrast_level: current.contrast_level === 'low' ? 'normal' : current.contrast_level,
    }
  }

  return {
    ...current,
    source_type: sourceType,
    color_count: 128,
    clean_background: false,
    simplify_colors: false,
    strengthen_dark_detail: false,
    preserve_accents: false,
  }
}

export default function HomePage() {
  const [activeImagePath, setActiveImagePath] = useState<string | null>(null)
  const [importedAspectRatio, setImportedAspectRatio] = useState<number | null>(null)
  const [lockAspectRatio, setLockAspectRatio] = useState(true)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [previewImagePath, setPreviewImagePath] = useState<string | null>(null)
  const [originalPreviewImagePath, setOriginalPreviewImagePath] = useState<string | null>(null)
  const [lastVisibleImageUrl, setLastVisibleImageUrl] = useState<string | null>(null)
  const [allPalette, setAllPalette] = useState<PaletteColor[]>([])
  const [allDmcColors, setAllDmcColors] = useState<PaletteColor[]>([])
  const [previewPalette, setPreviewPalette] = useState<PaletteColor[]>([])
  const [originalCells, setOriginalCells] = useState<string[][]>([])
  const [enabledColorHexes, setEnabledColorHexes] = useState<string[]>([])
  const [cells, setCells] = useState<string[][]>([])
  const [activePaintColor, setActivePaintColor] = useState<string | null>(null)
  const [removalMode, setRemovalMode] = useState<'fill' | 'blank'>('fill')
  const [undoStack, setUndoStack] = useState<ColorEditSnapshot[]>([])
  const [redoStack, setRedoStack] = useState<ColorEditSnapshot[]>([])
  const [viewMode, setViewMode] = useState<'original' | 'stitch'>('original')
  const [isPreviewExpanded, setIsPreviewExpanded] = useState(false)
  const [highlightSelection, setHighlightSelection] = useState(false)
  const [selectedRegion, setSelectedRegion] = useState<DesignSelectionRect | null>(null)
  const [manualCellOverrides, setManualCellOverrides] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [showFinalizeModal, setShowFinalizeModal] = useState(false)
  const [finalPdfPath, setFinalPdfPath] = useState<string | null>(null)
  const [lastSettings, setLastSettings] = useState<PreviewSettings | null>(null)
  const [draftSettings, setDraftSettings] = useState<PreviewSettings>(DEFAULT_SETTINGS)
  const [hasGeneratedPreview, setHasGeneratedPreview] = useState(false)
  const [showGuideDialog, setShowGuideDialog] = useState(false)
  const [viewportWidth, setViewportWidth] = useState(1280)
  const [showMobileAssistant, setShowMobileAssistant] = useState(false)
  const [showMobileSettings, setShowMobileSettings] = useState(false)
  const [showMobilePalette, setShowMobilePalette] = useState(false)
  const [, startPaletteTransition] = useTransition()
  const deferredCells = useDeferredValue(cells)
  const latestApplyRequestIdRef = useRef(0)

  useEffect(() => {
    const updateViewportWidth = () => {
      setViewportWidth(window.innerWidth || 1280)
    }

    updateViewportWidth()
    window.addEventListener('resize', updateViewportWidth)
    return () => window.removeEventListener('resize', updateViewportWidth)
  }, [])

  const isMobile = viewportWidth < MOBILE_BREAKPOINT

  const displayedImage = useMemo(() => {
    if (viewMode === 'stitch' && previewImagePath) {
      return assetUrl(previewImagePath)
    }
    return assetUrl(activeImagePath)
  }, [viewMode, previewImagePath, activeImagePath])

  useEffect(() => {
    if (displayedImage) {
      setLastVisibleImageUrl(displayedImage)
    }
  }, [displayedImage])

  const shouldShowStitchGrid = viewMode === 'stitch' && cells.length > 0

  const paletteDisplaySource = useMemo(() => {
    const byHex = new Map<string, PaletteColor>()

    allPalette.forEach((color) => {
      byHex.set(color.hex, color)
    })
    previewPalette.forEach((color) => {
      if (!byHex.has(color.hex)) {
        byHex.set(color.hex, color)
      }
    })

    return Array.from(byHex.values())
  }, [allPalette, previewPalette])

  const displayPalette = paletteDisplaySource

  const paletteCountsByHex = useMemo(() => countCellsByHex(deferredCells), [deferredCells])
  const displayColorCounts = paletteCountsByHex
  const displayEnabledColorHexes = enabledColorHexes
  const requestedColorCount = displayEnabledColorHexes.length
  const hasPendingPreviewSettings = useMemo(
    () => hasGeneratedPreview && getSettingsKey(draftSettings) !== getSettingsKey(lastSettings),
    [draftSettings, hasGeneratedPreview, lastSettings]
  )
  const currentDesignPalette = useMemo(() => buildPaletteForCells(cells), [allDmcColors, allPalette, cells, previewPalette])
  const currentDesignColorCounts = useMemo(() => countCellsByHex(cells), [cells])
  const currentDesignStitchCount = useMemo(
    () => Object.values(currentDesignColorCounts).reduce((total, count) => total + count, 0),
    [currentDesignColorCounts]
  )
  const selectedRegionCount = useMemo(() => {
    if (!activePaintColor || !selectedRegion || !cells.length) return 0

    const bounds = getClampedSelectionBounds(selectedRegion, cells.length, cells[0]?.length ?? 0)
    if (!bounds) return 0

    const { top, bottom, left, right } = bounds

    let count = 0
    for (let row = top; row <= bottom; row += 1) {
      for (let col = left; col <= right; col += 1) {
        if (cells[row]?.[col] === activePaintColor) {
          count += 1
        }
      }
    }

    return count
  }, [activePaintColor, cells, selectedRegion])
  const selectionMergeSuggestions = useMemo(() => {
    if (!activePaintColor || !selectedRegion || !cells.length) return []

    const neighborCounts = new Map<string, number>()
    const directions: Array<[number, number]> = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]
    const bounds = getClampedSelectionBounds(selectedRegion, cells.length, cells[0]?.length ?? 0)
    if (!bounds) return []

    const { top, bottom, left, right } = bounds

    for (let row = top; row <= bottom; row += 1) {
      for (let col = left; col <= right; col += 1) {
        if (cells[row]?.[col] !== activePaintColor) continue

        directions.forEach(([rowOffset, colOffset]) => {
          const nextRow = row + rowOffset
          const nextCol = col + colOffset
          if (nextRow < 0 || nextRow >= cells.length || nextCol < 0 || nextCol >= cells[nextRow].length) return
          if (nextRow >= top && nextRow <= bottom && nextCol >= left && nextCol <= right) return

          const neighborHex = cells[nextRow][nextCol]
          if (neighborHex === activePaintColor) return

          neighborCounts.set(neighborHex, (neighborCounts.get(neighborHex) ?? 0) + 1)
        })
      }
    }

    const byHex = new Map<string, PaletteColor>()
    ;[...displayPalette, ...allDmcColors].forEach((color) => {
      if (!byHex.has(color.hex)) {
        byHex.set(color.hex, color)
      }
    })

    return Array.from(neighborCounts.entries())
      .sort((left, right) => right[1] - left[1])
      .map(([hex]) => byHex.get(hex))
      .filter((color): color is PaletteColor => Boolean(color))
      .slice(0, 6)
  }, [activePaintColor, allDmcColors, cells, displayPalette, selectedRegion])
  const selectionOtherColors = useMemo(() => {
    const preferredHexOrder = ['#FFFFFF', '#000000']
    const suggestionHexes = new Set(selectionMergeSuggestions.map((color) => color.hex))
    const availableColors = allDmcColors
      .filter((color, index, source) => {
        if (color.hex === activePaintColor || suggestionHexes.has(color.hex)) return false
        return source.findIndex((candidate) => candidate.hex === color.hex) === index
      })
    const preferredColors = preferredHexOrder
      .map((hex) => availableColors.find((color) => color.hex === hex))
      .filter((color): color is PaletteColor => Boolean(color))
    const preferredSet = new Set(preferredColors.map((color) => color.hex))

    return [...preferredColors, ...availableColors.filter((color) => !preferredSet.has(color.hex))]
  }, [activePaintColor, allDmcColors, selectionMergeSuggestions])

  const applyImportedImage = useCallback((url: string) => {
    latestApplyRequestIdRef.current += 1
    setUploadError(null)
    setActiveImagePath(url)
    setImportedAspectRatio(null)
    setPreviewImagePath(null)
    setOriginalPreviewImagePath(null)
    setLastVisibleImageUrl(assetUrl(url))
    setAllPalette([])
    setPreviewPalette([])
    setOriginalCells([])
    setEnabledColorHexes([])
    setCells([])
    setActivePaintColor(null)
    setRemovalMode('fill')
    setManualCellOverrides({})
    setUndoStack([])
    setRedoStack([])
    setFinalPdfPath(null)
    setLastSettings(null)
    setDraftSettings(DEFAULT_SETTINGS)
    setLockAspectRatio(true)
    setHasGeneratedPreview(false)
    setViewMode('original')

    const resolvedUrl = assetUrl(url)
    if (!resolvedUrl) {
      setUploadError('Imported image URL was empty.')
      setLoading(false)
      return
    }

    const img = new Image()
    img.onload = () => {
      setImportedAspectRatio(img.width / img.height)
      setLoading(false)
    }
    img.onerror = () => {
      setUploadError('Image import succeeded, but the image could not be loaded.')
      setLoading(false)
    }
    img.src = resolvedUrl
  }, [])

  function buildPaletteForCells(nextCells: string[][]) {
    const usedHexes = new Set(nextCells.flat().filter((cell) => cell !== '#FFFFFF'))
    const byHex = new Map<string, PaletteColor>()

    ;[...previewPalette, ...allPalette, ...allDmcColors].forEach((color) => {
      byHex.set(color.hex, color)
    })

    return Array.from(usedHexes)
      .map((hex) => byHex.get(hex))
      .filter((color): color is PaletteColor => Boolean(color))
  }

  function refreshPreviewPalette(nextCells: string[][]) {
    startPaletteTransition(() => {
      setPreviewPalette(buildPaletteForCells(nextCells))
    })
  }

  function buildEffectiveSourceState(overrideState = manualCellOverrides) {
    const sourceCells = applyManualOverrides(originalCells, overrideState)
    const sourcePalette = buildPaletteForCells(sourceCells)

    return {
      sourceCells,
      sourcePalette,
    }
  }

  useEffect(() => {
    let cancelled = false

    async function loadDmcColors() {
      try {
        const colors = await fetchDmcColors()
        if (!cancelled) {
          setAllDmcColors(colors)
        }
      } catch {
        if (!cancelled) {
          setAllDmcColors([])
        }
      }
    }

    void loadDmcColors()

    return () => {
      cancelled = true
    }
  }, [])

  function pushUndoSnapshot() {
    setUndoStack((current) => [
      ...current,
      {
        cells: cloneCells(cells),
        enabledColorHexes: [...enabledColorHexes],
        previewPalette: [...previewPalette],
        activePaintColor,
        removalMode,
        manualCellOverrides: { ...manualCellOverrides },
      },
    ])
    setRedoStack([])
  }

  async function handleApply(settings: PreviewSettings) {
    if (!activeImagePath) return
    const requestId = latestApplyRequestIdRef.current + 1
    latestApplyRequestIdRef.current = requestId

    const previousEnabledColorHexes = [...enabledColorHexes]
    const previousRemovalMode = removalMode
    const previousActivePaintColor = activePaintColor
    const previousViewMode = viewMode
    const previousManualCellOverrides = manualCellOverrides
    const previousEffectiveSourcePaletteHexes = buildEffectiveSourceState(previousManualCellOverrides).sourcePalette.map(
      (color) => color.hex
    )
    const previousHadFilteredPalette =
      previousRemovalMode !== 'fill' ||
      previousEnabledColorHexes.length !== previousEffectiveSourcePaletteHexes.length ||
      previousEffectiveSourcePaletteHexes.some((hex) => !previousEnabledColorHexes.includes(hex))
    const canAttemptToPreservePaletteState =
      hasGeneratedPreview &&
      lastSettings !== null &&
      settings.color_count === lastSettings.color_count &&
      previousHadFilteredPalette

    const stitchWidth = Math.max(1, Math.round(settings.width_inches * settings.mesh_count))
    const stitchHeight = Math.max(1, Math.round(settings.height_inches * settings.mesh_count))
    const sameGeometryAsLastSettings = Boolean(
      lastSettings &&
        settings.width_inches === lastSettings.width_inches &&
        settings.height_inches === lastSettings.height_inches &&
        settings.mesh_count === lastSettings.mesh_count
    )

    setLoading(true)
    try {
      const result = await createPreview({
        image_url: activeImagePath,
        stitch_width: stitchWidth,
        stitch_height: stitchHeight,
        color_count: settings.color_count,
        show_grid: settings.show_grid,
        clean_background: settings.clean_background,
        simplify_colors: settings.simplify_colors,
        strengthen_dark_detail: settings.strengthen_dark_detail,
        preserve_accents: settings.preserve_accents,
        mesh_count: settings.mesh_count,
        contrast_level: settings.contrast_level,
        source_type: settings.source_type,
      })
      const collapsed = collapsePaletteShades(result.cells, result.palette)
      const nextAllPalette = collapsed.palette
      const nextOriginalCells = collapsed.cells
      const nextFullPaletteHexes = nextAllPalette.map((color) => color.hex)
      const nextEnabledColorHexes = canAttemptToPreservePaletteState
        ? nextFullPaletteHexes.filter((hex) => previousEnabledColorHexes.includes(hex))
        : nextFullPaletteHexes
      const paletteOverlapRatio =
        previousEnabledColorHexes.length > 0
          ? nextEnabledColorHexes.length / previousEnabledColorHexes.length
          : 1
      const shouldPreservePaletteState =
        canAttemptToPreservePaletteState &&
        nextEnabledColorHexes.length > 0 &&
        paletteOverlapRatio >= MIN_PALETTE_STATE_OVERLAP_RATIO
      const resolvedEnabledColorHexes = shouldPreservePaletteState
        ? nextEnabledColorHexes
        : nextFullPaletteHexes
      const shouldReapplyPaletteState =
        shouldPreservePaletteState &&
        (previousRemovalMode !== 'fill' ||
          resolvedEnabledColorHexes.length !== nextFullPaletteHexes.length)
      const rebuiltFromPaletteState = shouldReapplyPaletteState
        ? applyPaletteStateToCells(
            nextOriginalCells,
            nextAllPalette,
            resolvedEnabledColorHexes,
            previousRemovalMode
          )
        : null
      const nextCells = rebuiltFromPaletteState ? rebuiltFromPaletteState.nextCells : nextOriginalCells
      const nextPreviewPalette = rebuiltFromPaletteState
        ? rebuiltFromPaletteState.nextPreviewPalette
        : nextAllPalette
      const shouldReapplyManualOverrides =
        sameGeometryAsLastSettings && Object.keys(previousManualCellOverrides).length > 0
      const finalCells = shouldReapplyManualOverrides
        ? applyManualOverrides(nextCells, previousManualCellOverrides)
        : nextCells
      const finalPreviewPalette = shouldReapplyManualOverrides
        ? buildPaletteForCells(finalCells)
        : nextPreviewPalette
      const nextActivePaintColor =
        previousActivePaintColor && previousActivePaintColor !== '#FFFFFF'
          ? (finalPreviewPalette.find((color) => color.hex === previousActivePaintColor)?.hex ??
            nextAllPalette.find((color) => color.hex === previousActivePaintColor)?.hex ??
            finalPreviewPalette[0]?.hex ??
            '#FFFFFF')
          : previousActivePaintColor ?? finalPreviewPalette[0]?.hex ?? '#FFFFFF'

      if (requestId !== latestApplyRequestIdRef.current) {
        return
      }

      setPreviewImagePath(result.stitch_preview_url)
      setOriginalPreviewImagePath(result.stitch_preview_url)
      setAllPalette(nextAllPalette)
      setPreviewPalette(finalPreviewPalette)
      setEnabledColorHexes(
        shouldReapplyManualOverrides
          ? Array.from(
              new Set([
                ...(shouldReapplyPaletteState ? resolvedEnabledColorHexes : nextFullPaletteHexes),
                ...finalPreviewPalette.map((color) => color.hex),
              ])
            )
          : shouldReapplyPaletteState
            ? resolvedEnabledColorHexes
            : nextFullPaletteHexes
      )
      setOriginalCells(nextOriginalCells)
      setCells(finalCells)
      setActivePaintColor(nextActivePaintColor)
      setRemovalMode(shouldReapplyPaletteState ? previousRemovalMode : 'fill')
      setManualCellOverrides(shouldReapplyManualOverrides ? previousManualCellOverrides : {})
      setUndoStack([])
      setRedoStack([])
      setLastSettings(settings)
      setDraftSettings(settings)
      setFinalPdfPath(null)
      setHasGeneratedPreview(true)
      setViewMode(hasGeneratedPreview ? previousViewMode : 'stitch')
      setSelectedRegion(null)
    } finally {
      if (requestId === latestApplyRequestIdRef.current) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    if (!hasGeneratedPreview || !activeImagePath || !lastSettings) return

    const draftKey = getSettingsKey(draftSettings)
    const lastKey = getSettingsKey(lastSettings)
    if (draftKey === lastKey) return

    const timeoutId = window.setTimeout(() => {
      void handleApply(draftSettings)
    }, 250)

    return () => window.clearTimeout(timeoutId)
  }, [activeImagePath, draftSettings, hasGeneratedPreview, lastSettings])

  function updateSettings(patch: Partial<PreviewSettings>) {
    setDraftSettings((current) => ({ ...current, ...patch }))
  }

  function applyEnabledPalette(nextEnabledColorHexes: string[], nextRemovalMode = removalMode) {
    const { sourceCells, sourcePalette } = buildEffectiveSourceState()
    const fullPaletteHexes = sourcePalette.map((color) => color.hex)
    const hasFullPaletteEnabled =
      nextEnabledColorHexes.length === fullPaletteHexes.length &&
      fullPaletteHexes.every((hex) => nextEnabledColorHexes.includes(hex))

    if (hasFullPaletteEnabled) {
      setPreviewImagePath(originalPreviewImagePath)
      setPreviewPalette(sourcePalette)
      setEnabledColorHexes(fullPaletteHexes)
      setCells(sourceCells)
      setRemovalMode(nextRemovalMode)
      setActivePaintColor((current) => {
        if (!current) return sourcePalette[0]?.hex ?? '#FFFFFF'
        if (current === '#FFFFFF') return current
        return fullPaletteHexes.includes(current) ? current : sourcePalette[0]?.hex ?? '#FFFFFF'
      })
      setViewMode('stitch')
      setFinalPdfPath(null)
      return
    }

    const { nextCells, nextPreviewPalette } = applyPaletteStateToCells(
      sourceCells,
      sourcePalette,
      nextEnabledColorHexes,
      nextRemovalMode
    )
    const collapsed = collapsePaletteShades(nextCells, nextPreviewPalette)

    setPreviewImagePath(originalPreviewImagePath)
    setPreviewPalette(collapsed.palette)
    setEnabledColorHexes(nextEnabledColorHexes)
    setCells(collapsed.cells)
    setRemovalMode(nextRemovalMode)
    setActivePaintColor((current) => {
      if (!current) return collapsed.palette[0]?.hex ?? '#FFFFFF'
      if (current === '#FFFFFF') return current
      return nextEnabledColorHexes.includes(current) ? current : collapsed.palette[0]?.hex ?? '#FFFFFF'
    })
    setViewMode('stitch')
    setFinalPdfPath(null)
  }

  function disableColorHex(hex: string) {
    if (!enabledColorHexes.includes(hex)) return
    pushUndoSnapshot()
    applyEnabledPalette(enabledColorHexes.filter((item) => item !== hex))
  }

  function enableColorHex(hex: string) {
    if (enabledColorHexes.includes(hex)) return
    pushUndoSnapshot()
    applyEnabledPalette(Array.from(new Set([...enabledColorHexes, hex])))
  }

  function handleEnableAllColors() {
    const nextEnabledColorHexes = allPalette.map((color) => color.hex)

    if (!nextEnabledColorHexes.length) return
    if (
      nextEnabledColorHexes.length === enabledColorHexes.length &&
      nextEnabledColorHexes.every((hex) => enabledColorHexes.includes(hex))
    ) {
      return
    }

    pushUndoSnapshot()
    applyEnabledPalette(nextEnabledColorHexes)
  }

  function handleAutoReduceColors(targetCount: number) {
    const clampedTarget = Math.max(2, Math.min(displayPalette.length, targetCount))
    if (!displayPalette.length || clampedTarget >= displayPalette.length) return

    const nextEnabledColorHexes = pickDistinctPaletteHexes(
      displayPalette,
      displayColorCounts,
      clampedTarget,
      activePaintColor
    )

    if (
      nextEnabledColorHexes.length === enabledColorHexes.length &&
      nextEnabledColorHexes.every((hex) => enabledColorHexes.includes(hex))
    ) {
      return
    }

    pushUndoSnapshot()
    applyEnabledPalette(nextEnabledColorHexes)
  }

  function handleToggleColorEnabled(hex: string, enabled: boolean) {
    if (enabled) {
      enableColorHex(hex)
      return
    }

    disableColorHex(hex)
  }

  function handlePaintCells(coords: Array<[number, number]>) {
    if (!activePaintColor) return
    if (!coords.length) return

    let nextCells: string[][] | null = null

    setCells((current) => {
      let changed = false
      const updatedCells = current.map((row) => [...row])
      coords.forEach(([row, col]) => {
        if (row < 0 || row >= updatedCells.length || col < 0 || col >= updatedCells[row].length) return
        if (updatedCells[row][col] === activePaintColor) return
        updatedCells[row][col] = activePaintColor
        changed = true
      })

      if (!changed) {
        return current
      }

      nextCells = updatedCells
      return updatedCells
    })

    if (nextCells) {
      refreshPreviewPalette(nextCells)
      setManualCellOverrides((current) => {
        const nextOverrides = { ...current }
        coords.forEach(([row, col]) => {
          if (row < 0 || row >= nextCells!.length || col < 0 || col >= nextCells![row].length) return
          nextOverrides[makeCellKey(row, col)] = activePaintColor
        })
        return nextOverrides
      })
    }

    setFinalPdfPath(null)
  }

  function handleApplyColorToSelection(targetHex: string) {
    if (!selectedRegion || !activePaintColor) return

    const bounds = getClampedSelectionBounds(selectedRegion, cells.length, cells[0]?.length ?? 0)
    if (!bounds) return

    const { top, bottom, left, right } = bounds
    let changed = 0
    const nextCells = cells.map((row, rowIndex) =>
      row.map((cell, colIndex) => {
        if (rowIndex < top || rowIndex > bottom || colIndex < left || colIndex > right) return cell
        if (cell !== activePaintColor) return cell
        if (cell === targetHex) return cell
        changed += 1
        return targetHex
      })
    )

    if (!changed) return

    pushUndoSnapshot()
    setCells(nextCells)
    refreshPreviewPalette(nextCells)
    setManualCellOverrides((current) => {
      const nextOverrides = { ...current }
      for (let row = top; row <= bottom; row += 1) {
        for (let col = left; col <= right; col += 1) {
          if (cells[row]?.[col] !== activePaintColor) continue
          nextOverrides[makeCellKey(row, col)] = targetHex
        }
      }
      return nextOverrides
    })
    setEnabledColorHexes((current) => Array.from(new Set([...current, targetHex])))
    setActivePaintColor(targetHex)
    setSelectedRegion(selectedRegion)
    setFinalPdfPath(null)
    setViewMode('stitch')
  }

  function handleClearSelection() {
    setSelectedRegion(null)
  }

  function handleUndoColorChange() {
    setUndoStack((current) => {
      const previous = current[current.length - 1]
      if (!previous) return current

      setRedoStack((redoCurrent) => [
        ...redoCurrent,
        {
          cells: cloneCells(cells),
          enabledColorHexes: [...enabledColorHexes],
          previewPalette: [...previewPalette],
          activePaintColor,
          removalMode,
          manualCellOverrides: { ...manualCellOverrides },
        },
      ])
      setCells(previous.cells)
      setEnabledColorHexes(previous.enabledColorHexes)
      setPreviewPalette(previous.previewPalette)
      setActivePaintColor(previous.activePaintColor)
      setRemovalMode(previous.removalMode)
      setManualCellOverrides(previous.manualCellOverrides)
      setFinalPdfPath(null)

      return current.slice(0, -1)
    })
  }

  function handleRedoColorChange() {
    setRedoStack((current) => {
      const next = current[current.length - 1]
      if (!next) return current

      setUndoStack((undoCurrent) => [
        ...undoCurrent,
        {
          cells: cloneCells(cells),
          enabledColorHexes: [...enabledColorHexes],
          previewPalette: [...previewPalette],
          activePaintColor,
          removalMode,
          manualCellOverrides: { ...manualCellOverrides },
        },
      ])
      setCells(next.cells)
      setEnabledColorHexes(next.enabledColorHexes)
      setPreviewPalette(next.previewPalette)
      setActivePaintColor(next.activePaintColor)
      setRemovalMode(next.removalMode)
      setManualCellOverrides(next.manualCellOverrides)
      setFinalPdfPath(null)

      return current.slice(0, -1)
    })
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isTypingTarget = Boolean(
        target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            target.isContentEditable)
      )

      if (isTypingTarget) return
      if (!event.ctrlKey && !event.metaKey) return
      if (event.key.toLowerCase() !== 'z') return

      event.preventDefault()

      if (event.shiftKey) {
        if (redoStack.length) {
          handleRedoColorChange()
        }
        return
      }

      if (undoStack.length) {
        handleUndoColorChange()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [redoStack.length, undoStack.length])

  function handleRemovalModeChange(nextRemovalMode: 'fill' | 'blank') {
    if (nextRemovalMode === removalMode) return
    if (enabledColorHexes.length === allPalette.length) {
      setRemovalMode(nextRemovalMode)
      return
    }

    pushUndoSnapshot()
    applyEnabledPalette(enabledColorHexes, nextRemovalMode)
  }

  function handleResetColorChanges() {
    if (!allPalette.length || !originalCells.length) return

    setPreviewImagePath(originalPreviewImagePath)
    setPreviewPalette(allPalette)
    setEnabledColorHexes(allPalette.map((color) => color.hex))
    setCells(cloneCells(originalCells))
    setActivePaintColor(allPalette[0]?.hex ?? '#FFFFFF')
    setRemovalMode('fill')
    setManualCellOverrides({})
    setUndoStack([])
    setRedoStack([])
    setFinalPdfPath(null)
    setViewMode('stitch')
    setSelectedRegion(null)
  }

  function mergeColorsIntoTarget(sourceHexes: string[], targetHex: string) {
    const normalizedSources = Array.from(new Set(sourceHexes.filter((hex) => hex !== targetHex)))
    if (!normalizedSources.length) return 0

    let changed = 0
    const nextCells = cells.map((row) =>
      row.map((cell) => {
        if (!normalizedSources.includes(cell)) return cell
        changed += 1
        return targetHex
      })
    )

    if (!changed) return 0

    pushUndoSnapshot()
    setCells(nextCells)
    refreshPreviewPalette(nextCells)
    setManualCellOverrides((current) => {
      const nextOverrides = { ...current }
      nextCells.forEach((row, rowIndex) => {
        row.forEach((cell, colIndex) => {
          if (!normalizedSources.includes(cells[rowIndex][colIndex])) return
          nextOverrides[makeCellKey(rowIndex, colIndex)] = targetHex
        })
      })
      return nextOverrides
    })

    setEnabledColorHexes((current) =>
      Array.from(new Set(current.filter((hex) => !normalizedSources.includes(hex)).concat(targetHex)))
    )
    setActivePaintColor((current) => (current && normalizedSources.includes(current) ? targetHex : current))
    setFinalPdfPath(null)
    setViewMode('stitch')

    return changed
  }

  function findPaletteColor(query: string) {
    const normalized = query.trim().toLowerCase()
    return [...previewPalette, ...allPalette, ...allDmcColors].find((color) => {
      return (
        color.dmc_code.toLowerCase() === normalized ||
        color.hex.toLowerCase() === normalized ||
        color.dmc_name.toLowerCase().includes(normalized)
      )
    })
  }

  function analyzePaletteSummary() {
    const ranked = [...displayPalette]
      .sort((left, right) => (displayColorCounts[right.hex] ?? 0) - (displayColorCounts[left.hex] ?? 0))
      .slice(0, 10)

    if (!ranked.length) {
      return 'There is no stitch palette to analyze yet.'
    }

    const lines = ranked.map(
      (color) => `${color.dmc_code} (${displayColorCounts[color.hex] ?? 0} stitches)`
    )
    return `Top palette colors: ${lines.join(', ')}.`
  }

  async function handleEyedropperSelection() {
    if (!selectedRegion) return

    const EyeDropperApi = (window as typeof window & { EyeDropper?: EyeDropperConstructor }).EyeDropper
    if (!EyeDropperApi) {
      setUploadError('Eyedropper is not supported in this browser.')
      return
    }

    try {
      const eyeDropper = new EyeDropperApi()
      const result = await eyeDropper.open()
      const nearestColor = allDmcColors.reduce<PaletteColor | null>((closest, candidate) => {
        if (!closest) return candidate
        return colorDistance(result.sRGBHex, candidate.hex) < colorDistance(result.sRGBHex, closest.hex)
          ? candidate
          : closest
      }, null)

      if (!nearestColor) {
        setUploadError('Could not match the sampled color to a DMC color.')
        return
      }

      handleApplyColorToSelection(nearestColor.hex)
      setActivePaintColor(nearestColor.hex)
      setUploadError(null)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return
      }
      setUploadError('Could not sample a color from the screen.')
    }
  }

  function recolorOutsideBorder(targetHex: string) {
    if (!cells.length) return 0

    const borderCoords = findOutsideBorderCoords(cells)
    if (!borderCoords.length) return 0

    let changed = 0
    const nextCells = cloneCells(cells)
    borderCoords.forEach(([row, col]) => {
      if (nextCells[row][col] === targetHex) return
      nextCells[row][col] = targetHex
      changed += 1
    })

    if (!changed) return 0

    pushUndoSnapshot()
    setCells(nextCells)
    refreshPreviewPalette(nextCells)
    setManualCellOverrides((current) => {
      const nextOverrides = { ...current }
      borderCoords.forEach(([row, col]) => {
        nextOverrides[makeCellKey(row, col)] = targetHex
      })
      return nextOverrides
    })
    setEnabledColorHexes((current) => Array.from(new Set([...current, targetHex])))
    setActivePaintColor((current) => current ?? targetHex)
    setFinalPdfPath(null)
    setViewMode('stitch')

    return changed
  }

  async function handleChatMessage(message: string): Promise<CommandResult> {
    const trimmed = message.trim()
    const lowered = normalizeCommandText(trimmed)

    if (
      lowered === 'help' ||
      lowered === 'commands' ||
      lowered === 'what can you do' ||
      lowered === 'what can i do here'
    ) {
      const response = await chatAssistant(trimmed)
      return { reply: response.message }
    }

    const helpMatch = lowered.match(/^(?:help|guide|how do i use)\s+(.+)$/)
    if (helpMatch) {
      const response = await chatAssistant(trimmed)
      return { reply: response.message }
    }

    if (
      lowered === 'use stitched photo' ||
      lowered === 'switch to stitched photo' ||
      lowered === 'set source to stitched photo'
    ) {
      setDraftSettings((current) => applySourceTypeDefaults(current, 'stitched_photo'))
      return { reply: 'Switched the source mode to stitched photo.' }
    }

    if (
      lowered === 'use graphic art' ||
      lowered === 'use screenshot art' ||
      lowered === 'switch to graphic art' ||
      lowered === 'switch to screenshot art' ||
      lowered === 'set source to graphic art'
    ) {
      setDraftSettings((current) => applySourceTypeDefaults(current, 'graphic_art'))
      return { reply: 'Switched the source mode to graphic / screenshot art.' }
    }

    if (
      lowered === 'use photo' ||
      lowered === 'switch to photo' ||
      lowered === 'set source to photo'
    ) {
      setDraftSettings((current) => applySourceTypeDefaults(current, 'photo'))
      return { reply: 'Switched the source mode to photo.' }
    }

    const urlMatch = trimmed.match(/https?:\/\/\S+/i)
    if (urlMatch && (lowered.startsWith('import ') || lowered.includes('use url') || lowered.includes('image url'))) {
      setLoading(true)
      try {
        const result = await importImageFromUrl(urlMatch[0])
        applyImportedImage(result.active_image_url)
        return { reply: 'Imported that image URL. You can generate a stitch preview when ready.' }
      } catch (error) {
        setLoading(false)
        throw error
      }
    }

    if (lowered.includes('upload')) {
      return { reply: 'Use the Upload file button in chat and I’ll import it into the project.' }
    }

    if (
      lowered.includes('search') ||
      lowered.includes('find a photo') ||
      lowered.includes('find an image') ||
      lowered.includes('search the web') ||
      lowered.includes('look for')
    ) {
      return {
        reply:
          'MNS Studio does not search for images. Find the image you want online, then upload it here or paste the direct image URL with `import https://...`.',
      }
    }

    if (lowered.includes('generate from scratch') || lowered.includes('create an image')) {
      const response = await chatAssistant(trimmed)
      return { reply: response.message }
    }

    const widthValue = extractCommandNumber(lowered, [
      /(?:set|make|change|use|update)?\s*width(?: inches| inch| in)?(?: to| =)?\s*(\d+(?:\.\d+)?)/,
      /(\d+(?:\.\d+)?)\s*(?:inch|in)\s*wide/,
    ])
    if (widthValue !== null) {
      updateSettings({ width_inches: widthValue })
      return { reply: `Updated width to ${widthValue} inches.` }
    }

    const heightValue = extractCommandNumber(lowered, [
      /(?:set|make|change|use|update)?\s*height(?: inches| inch| in)?(?: to| =)?\s*(\d+(?:\.\d+)?)/,
      /(\d+(?:\.\d+)?)\s*(?:inch|in)\s*tall/,
    ])
    if (heightValue !== null) {
      updateSettings({ height_inches: heightValue })
      return { reply: `Updated height to ${heightValue} inches.` }
    }

    const meshValue = extractCommandNumber(lowered, [
      /(?:set|use|switch to|change to)?\s*(13|18)\s*mesh/,
      /mesh(?: count| size)?(?: to| =)?\s*(13|18)/,
    ])
    if (meshValue === 13 || meshValue === 18) {
      updateSettings({ mesh_count: meshValue })
      return { reply: `Set mesh count to ${meshValue}.` }
    }

    const colorCountValue = extractCommandNumber(lowered, [
      /(?:set|use|change|limit)?\s*(?:color count|colors?)(?: to| =)?\s*(\d{1,2})/,
      /(\d{1,2})\s*colors?/,
    ])
    if (colorCountValue !== null) {
      updateSettings({ color_count: colorCountValue })
      return { reply: `Set color count to ${colorCountValue}.` }
    }

    if (
      lowered.includes('grid off') ||
      lowered.includes('hide grid') ||
      lowered.includes('turn grid off') ||
      lowered.includes('disable grid')
    ) {
      updateSettings({ show_grid: false })
      return { reply: 'Turned grid off.' }
    }

    if (
      lowered.includes('grid on') ||
      lowered.includes('show grid') ||
      lowered.includes('turn grid on') ||
      lowered.includes('enable grid')
    ) {
      updateSettings({ show_grid: true })
      return { reply: 'Turned grid on.' }
    }

    if (
      lowered.includes('clean background on') ||
      lowered.includes('enable clean background') ||
      lowered.includes('turn clean background on')
    ) {
      updateSettings({ clean_background: true })
      return { reply: 'Turned Clean background on.' }
    }

    if (
      lowered.includes('clean background off') ||
      lowered.includes('disable clean background') ||
      lowered.includes('turn clean background off')
    ) {
      updateSettings({ clean_background: false })
      return { reply: 'Turned Clean background off.' }
    }

    if (
      lowered.includes('simplify colors on') ||
      lowered.includes('enable simplify colors') ||
      lowered.includes('turn simplify colors on')
    ) {
      updateSettings({ simplify_colors: true })
      return { reply: 'Turned Simplify colors on.' }
    }

    if (
      lowered.includes('simplify colors off') ||
      lowered.includes('disable simplify colors') ||
      lowered.includes('turn simplify colors off')
    ) {
      updateSettings({ simplify_colors: false })
      return { reply: 'Turned Simplify colors off.' }
    }

    if (
      lowered.includes('strengthen dark detail on') ||
      lowered.includes('enable strengthen dark detail') ||
      lowered.includes('turn strengthen dark detail on')
    ) {
      updateSettings({ strengthen_dark_detail: true })
      return { reply: 'Turned Strengthen dark detail on.' }
    }

    if (
      lowered.includes('strengthen dark detail off') ||
      lowered.includes('disable strengthen dark detail') ||
      lowered.includes('turn strengthen dark detail off')
    ) {
      updateSettings({ strengthen_dark_detail: false })
      return { reply: 'Turned Strengthen dark detail off.' }
    }

    if (
      lowered.includes('preserve accents on') ||
      lowered.includes('enable preserve accents') ||
      lowered.includes('turn preserve accents on')
    ) {
      updateSettings({ preserve_accents: true })
      return { reply: 'Turned Preserve accents on.' }
    }

    if (
      lowered.includes('preserve accents off') ||
      lowered.includes('disable preserve accents') ||
      lowered.includes('turn preserve accents off')
    ) {
      updateSettings({ preserve_accents: false })
      return { reply: 'Turned Preserve accents off.' }
    }

    if (lowered.includes('super super high contrast') || lowered.includes('contrast super super high')) {
      updateSettings({ contrast_level: 'super_super_high' })
      return { reply: 'Set contrast to super super high.' }
    }
    if (lowered.includes('super high contrast') || lowered.includes('contrast super high')) {
      updateSettings({ contrast_level: 'super_high' })
      return { reply: 'Set contrast to super high.' }
    }
    if (lowered.includes('contrast high') || lowered.includes('high contrast')) {
      updateSettings({ contrast_level: 'high' })
      return { reply: 'Set contrast to high.' }
    }
    if (lowered.includes('contrast low') || lowered.includes('low contrast')) {
      updateSettings({ contrast_level: 'low' })
      return { reply: 'Set contrast to low.' }
    }
    if (lowered.includes('contrast normal') || lowered.includes('normal contrast')) {
      updateSettings({ contrast_level: 'normal' })
      return { reply: 'Set contrast to normal.' }
    }

    if (lowered.includes('lock aspect')) {
      setLockAspectRatio(true)
      return { reply: 'Aspect ratio is locked.' }
    }
    if (lowered.includes('unlock aspect')) {
      setLockAspectRatio(false)
      return { reply: 'Aspect ratio is unlocked.' }
    }

    if (
      lowered.includes('analyze palette') ||
      lowered.includes('palette analysis') ||
      lowered.includes('show palette counts')
    ) {
      return { reply: analyzePaletteSummary() }
    }

    if (
      lowered === 'turn all colors on' ||
      lowered === 'enable all colors' ||
      lowered === 'show all colors'
    ) {
      handleEnableAllColors()
      return { reply: 'Turned all current palette colors back on.' }
    }

    if (
      lowered === 'reset colors' ||
      lowered === 'reset preview edits' ||
      lowered === 'reset preview'
    ) {
      handleResetColorChanges()
      return { reply: 'Reset the current preview edits back to the generated base preview.' }
    }

    if (
      lowered === 'what are my settings' ||
      lowered === 'show settings' ||
      lowered === 'current settings'
    ) {
      return {
        reply: [
          `Source: ${
            draftSettings.source_type === 'stitched_photo'
              ? 'Stitched photo'
              : draftSettings.source_type === 'graphic_art'
                ? 'Graphic / screenshot art'
                : 'Photo'
          }`,
          `Size: ${draftSettings.width_inches}" x ${draftSettings.height_inches}"`,
          `Mesh: ${draftSettings.mesh_count}`,
          `Colors: ${draftSettings.color_count}`,
          `Contrast: ${draftSettings.contrast_level.replaceAll('_', ' ')}`,
          `Clean background: ${draftSettings.clean_background ? 'on' : 'off'}`,
          `Simplify colors: ${draftSettings.simplify_colors ? 'on' : 'off'}`,
          `Strengthen dark detail: ${draftSettings.strengthen_dark_detail ? 'on' : 'off'}`,
          `Preserve accents: ${draftSettings.preserve_accents ? 'on' : 'off'}`,
          `Grid: ${draftSettings.show_grid ? 'on' : 'off'}`,
        ].join('\n'),
      }
    }

    const borderMatch = trimmed.match(
      /^(?:make|change|set)\s+(?:the\s+)?(?:outside|outer)\s+border(?:\s+fully)?\s+(?:to\s+)?(.+)$/i
    )
    if (borderMatch) {
      if (!cells.length) {
        return { reply: 'Generate a stitch preview first, then I can recolor the outside border.' }
      }

      const targetQuery = borderMatch[1].trim().replace(/[.!?]+$/, '')
      const targetColor = findPaletteColor(targetQuery)

      if (!targetColor) {
        return { reply: `I couldn't match "${targetQuery}" to a palette color yet.` }
      }

      const changed = recolorOutsideBorder(targetColor.hex)
      if (!changed) {
        return { reply: `The outside border is already fully ${targetColor.dmc_code}.` }
      }

      return {
        reply: `Changed the outside border to ${targetColor.dmc_code} - ${targetColor.dmc_name} across ${changed} stitches.`,
      }
    }

    if (
      (lowered.includes('generate') || lowered.includes('create') || lowered.includes('make')) &&
      lowered.includes('preview')
    ) {
      if (!activeImagePath) {
        return { reply: 'Import or upload an image first, then I can generate the stitch preview.' }
      }
      await handleApply(draftSettings)
      return { reply: 'Generated a new stitch preview.' }
    }

    if (lowered === 'undo' || lowered === 'undo last change') {
      if (!undoStack.length) {
        return { reply: 'There is nothing to undo yet.' }
      }
      handleUndoColorChange()
      return { reply: 'Undid the last preview edit.' }
    }

    if (lowered === 'redo' || lowered === 'redo last change') {
      if (!redoStack.length) {
        return { reply: 'There is nothing to redo yet.' }
      }
      handleRedoColorChange()
      return { reply: 'Redid the last preview edit.' }
    }

    if (lowered.includes('expand preview')) {
      setIsPreviewExpanded(true)
      return { reply: 'Expanded the preview area.' }
    }

    if (lowered.includes('show chat') || lowered.includes('collapse preview')) {
      setIsPreviewExpanded(false)
      return { reply: 'Brought the chat and sizing panel back.' }
    }

    if (lowered.includes('fill with nearby')) {
      handleRemovalModeChange('fill')
      return { reply: 'Color removals will now fill with nearby colors.' }
    }

    if (lowered.includes('blank white') || lowered.includes('remove fully')) {
      handleRemovalModeChange('blank')
      return { reply: 'Color removals will now leave blank/white stitches.' }
    }

    const paintMatch = lowered.match(/(?:paint|use|select)(?: with)? (.+)/)
    if (paintMatch) {
      const query = paintMatch[1].trim()
      if (query === 'blank' || query === 'white') {
        setActivePaintColor('#FFFFFF')
        return { reply: 'Selected blank/white as the paint color.' }
      }

      const color = findPaletteColor(query)
      if (color) {
        setActivePaintColor(color.hex)
        return { reply: `Selected ${color.dmc_code} - ${color.dmc_name} for painting.` }
      }
    }

    const disableMatch = lowered.match(/(?:turn off|disable|remove) (.+)/)
    if (disableMatch) {
      const color = findPaletteColor(disableMatch[1])
      if (color) {
        disableColorHex(color.hex)
        return { reply: `Turned off ${color.dmc_code} - ${color.dmc_name}.` }
      }
      return { reply: `I couldn't match "${disableMatch[1].trim()}" to a preview color.` }
    }

    const enableMatch = lowered.match(/(?:turn on|enable|restore|add back) (.+)/)
    if (enableMatch) {
      const color = findPaletteColor(enableMatch[1])
      if (color) {
        enableColorHex(color.hex)
        return { reply: `Turned on ${color.dmc_code} - ${color.dmc_name}.` }
      }
      return { reply: `I couldn't match "${enableMatch[1].trim()}" to a preview color.` }
    }

    const mergeMatch = trimmed.match(/merge\s+(.+?)\s+into\s+(.+)/i)
    if (mergeMatch) {
      const sourceQueries = mergeMatch[1]
        .split(/,| and /i)
        .map((item) => item.trim())
        .filter(Boolean)
      const targetQuery = mergeMatch[2].trim()
      const targetColor = findPaletteColor(targetQuery)

      if (!targetColor) {
        return { reply: `I couldn't match merge target "${targetQuery}" to a palette color.` }
      }

      const sourceColors = sourceQueries
        .map((query) => findPaletteColor(query))
        .filter((color): color is PaletteColor => Boolean(color))

      if (!sourceColors.length) {
        return { reply: 'I could not match any source colors to merge.' }
      }

      const changed = mergeColorsIntoTarget(
        sourceColors.map((color) => color.hex),
        targetColor.hex
      )

      if (!changed) {
        return { reply: `Nothing needed to merge into ${targetColor.dmc_code}.` }
      }

      return {
        reply: `Merged ${sourceColors
          .map((color) => color.dmc_code)
          .join(', ')} into ${targetColor.dmc_code} across ${changed} stitches.`,
      }
    }

    try {
      const response = await chatAssistant(trimmed)
      return { reply: response.message }
    } catch {
      return {
        reply:
          'Try commands like "import https://...", "set width to 7", "use 18 mesh", "use graphic art", "clean background on", "simplify colors on", "strengthen dark detail on", "preserve accents on", "turn grid off", "generate preview", "paint 310", "turn off 310", "merge 907 and 3052 into 907", "make the outside border fully light blue", "analyze palette", "undo", or "redo".',
      }
    }
  }

  async function handleChatUpload(file: File) {
    setUploadError(null)
    setLoading(true)
    try {
      const result = await uploadImage(file)
      applyImportedImage(result.active_image_url)
      return `Imported ${file.name}. You can generate a stitch preview when ready.`
    } catch (error) {
      setLoading(false)
      throw error
    }
  }

  async function handleFinalize() {
    const settingsForFinalize = lastSettings
    if (!previewImagePath || !settingsForFinalize || !cells.length || hasPendingPreviewSettings) return

    setLoading(true)
    try {
      const result = await finalizePreview({
        preview_url: previewImagePath,
        width_inches: settingsForFinalize.width_inches,
        height_inches: settingsForFinalize.height_inches,
        mesh_count: settingsForFinalize.mesh_count,
        color_count: requestedColorCount,
        contrast_level: settingsForFinalize.contrast_level,
        show_grid: settingsForFinalize.show_grid,
        palette: currentDesignPalette,
        cells,
        previous_pdf_url: finalPdfPath,
      })

      setFinalPdfPath(result.pdf_url)
      setShowFinalizeModal(false)
    } finally {
      setLoading(false)
    }
  }

  const desktopSettingsVisible = !isMobile && !isPreviewExpanded

  const statusBlock = (
    <>
      {loading && <p style={{ margin: 0 }}>Working...</p>}
      {uploadError && <p style={{ color: '#b00020', margin: 0 }}>{uploadError}</p>}
      {hasPendingPreviewSettings && !loading && (
        <p style={{ margin: 0, color: '#8a5a00' }}>
          Settings changed. Waiting for the stitch preview to refresh before finalizing.
        </p>
      )}

      {finalPdfPath && (
        <a href={assetUrl(finalPdfPath) ?? '#'} target="_blank" rel="noreferrer">
          Download finalized PDF
        </a>
      )}
    </>
  )

  const chatPanel = (
    <ChatPanel
      onSubmitMessage={handleChatMessage}
      onUploadFile={handleChatUpload}
      onGeneratePreview={() => void handleApply(draftSettings)}
      canGeneratePreview={Boolean(activeImagePath)}
      hasPreview={Boolean(previewImagePath && cells.length)}
      sourceType={draftSettings.source_type}
      onSourceTypeChange={(sourceType) =>
        setDraftSettings((current) => applySourceTypeDefaults(current, sourceType))
      }
    />
  )

  const settingsPanel = (
    <div
      style={{
        display: 'grid',
        gap: 6,
        width: '100%',
        minWidth: 0,
        padding: 8,
        boxSizing: 'border-box',
        overflow: 'hidden',
        border: '1px solid #d9d9d9',
        borderRadius: 12,
        background: '#fbfbfb',
        boxShadow: '0 8px 24px rgba(0,0,0,0.04)',
      }}
    >
      <div style={{ display: 'grid', gap: 2 }}>
        <h2 style={{ margin: 0, fontSize: 13 }}>Size and Settings</h2>
      </div>

      <PreviewControls
        importedAspectRatio={importedAspectRatio}
        settings={draftSettings}
        actualColorCount={displayPalette.length}
        lockAspectRatio={lockAspectRatio}
        onSettingsChange={setDraftSettings}
        onLockAspectRatioChange={setLockAspectRatio}
      />
    </div>
  )

  const paletteShell = (
    <aside
      style={{
        display: 'grid',
        gap: 16,
        alignContent: 'start',
        minWidth: 0,
        width: '100%',
        maxWidth: isMobile ? '100%' : 260,
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        padding: 10,
        boxSizing: 'border-box',
        border: '1px solid #d9d9d9',
        borderRadius: 14,
        background: '#fbfbfb',
        boxShadow: '0 8px 24px rgba(0,0,0,0.04)',
      }}
    >
        <PalettePanel
          colors={displayPalette}
          colorCount={draftSettings.color_count}
          activeColor={activePaintColor}
          enabledColorHexes={displayEnabledColorHexes}
        colorCountsByHex={displayColorCounts}
        highlightSelection={highlightSelection}
        hasSelectedRegion={Boolean(selectedRegion)}
        selectedRegionCount={selectedRegionCount}
        removalMode={removalMode}
        selectionMergeSuggestions={selectionMergeSuggestions}
        selectionOtherColors={selectionOtherColors}
        onApplyColorToSelection={handleApplyColorToSelection}
        onClearSelection={handleClearSelection}
        onEyedropperSelection={() => void handleEyedropperSelection()}
        onSelect={(color) => setActivePaintColor(color.hex)}
          onHighlightSelectionChange={setHighlightSelection}
          onToggleColorEnabled={handleToggleColorEnabled}
          onEnableAll={handleEnableAllColors}
          onColorCountChange={(nextCount) => updateSettings({ color_count: nextCount })}
          onAutoReduceToCount={handleAutoReduceColors}
        onRemovalModeChange={handleRemovalModeChange}
        moreColors={allDmcColors.filter(
          (color) => !displayPalette.some((previewColor) => previewColor.hex === color.hex)
        )}
      />
    </aside>
  )

  return (
    <main
      style={{
        display: 'grid',
        gridTemplateColumns: isMobile
          ? 'minmax(0, 1fr)'
          : isPreviewExpanded
            ? 'minmax(0, 1fr) clamp(220px, 22vw, 260px)'
            : 'minmax(250px, 290px) minmax(0, 760px) clamp(220px, 22vw, 260px)',
        gridAutoRows: isMobile ? 'auto' : undefined,
        minHeight: '100vh',
        height: isMobile ? 'auto' : '100vh',
        gap: 14,
        padding: isMobile ? 12 : 16,
        fontFamily: 'Arial, sans-serif',
        alignItems: 'start',
        overflow: isMobile ? 'auto' : 'hidden',
        justifyContent: 'center',
        boxSizing: 'border-box',
        width: '100%',
      }}
    >
      <GuideDialog open={showGuideDialog} onClose={() => setShowGuideDialog(false)} />

      {!isMobile && !isPreviewExpanded && (
        <section
          style={{
            display: 'grid',
            gap: 10,
            alignContent: 'start',
            minWidth: 0,
            height: '100%',
            overflow: 'hidden',
          }}
        >
          <h1 style={{ margin: 0, fontSize: 26, lineHeight: 1.05 }}>MNS Studio</h1>

          {chatPanel}
          {statusBlock}
        </section>
      )}

      <section
        style={{
          display: 'grid',
          gridTemplateRows: isMobile
            ? 'auto minmax(320px, 62vh) auto auto auto auto'
            : isPreviewExpanded
              ? 'auto minmax(0, 1fr) auto'
              : 'auto minmax(0, 1fr) auto auto',
          gap: isMobile ? 10 : isPreviewExpanded ? 6 : 8,
          minWidth: 0,
          width: '100%',
          height: isMobile ? 'auto' : '100%',
          overflow: isMobile ? 'visible' : 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: isMobile ? 'space-between' : 'flex-end',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          {isMobile && <h1 style={{ margin: 0, fontSize: 26, lineHeight: 1.05 }}>MNS Studio</h1>}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" onClick={() => setShowGuideDialog(true)}>
              How it works
            </button>
            {isMobile ? (
              <>
                <button type="button" onClick={() => setShowMobileAssistant((current) => !current)}>
                  {showMobileAssistant ? 'Hide assistant' : 'Show assistant'}
                </button>
                <button type="button" onClick={() => setShowMobileSettings((current) => !current)}>
                  {showMobileSettings ? 'Hide settings' : 'Show settings'}
                </button>
                <button type="button" onClick={() => setShowMobilePalette((current) => !current)}>
                  {showMobilePalette ? 'Hide palette' : 'Show palette'}
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setIsPreviewExpanded((current) => !current)}>
                {isPreviewExpanded ? 'Show chat and sizing' : 'Expand preview'}
              </button>
            )}
          </div>
        </div>

        <div
          style={{
            minWidth: 0,
            minHeight: 0,
            height: '100%',
            overflow: 'hidden',
          }}
        >
          {shouldShowStitchGrid ? (
            <GridEditor
              cells={cells}
              activeColor={activePaintColor}
              highlightSelection={highlightSelection}
              meshCount={lastSettings?.mesh_count ?? 13}
              onSelectionChange={setSelectedRegion}
              onPaintStart={pushUndoSnapshot}
              onPaintCells={handlePaintCells}
            />
          ) : (
            <ImagePanel
              imageUrl={displayedImage ?? lastVisibleImageUrl}
              title={isPreviewExpanded ? '' : 'Original image'}
            />
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button onClick={() => setViewMode('original')}>Original</button>
          <button onClick={() => setViewMode('stitch')} disabled={!previewImagePath}>
            Stitch preview
          </button>
          <button onClick={handleUndoColorChange} disabled={!undoStack.length}>
            Undo
          </button>
          <button onClick={handleRedoColorChange} disabled={!redoStack.length}>
            Redo
          </button>
          <button onClick={handleResetColorChanges} disabled={!previewImagePath}>
            Reset
          </button>
          <button
            onClick={() => setShowFinalizeModal(true)}
            disabled={!previewImagePath || !cells.length || hasPendingPreviewSettings || loading}
          >
            Finalize
          </button>
        </div>

        {isMobile && showMobileAssistant && (
          <div style={{ display: 'grid', gap: 10 }}>
            {chatPanel}
            <div
              style={{
                display: 'grid',
                gap: 8,
                padding: 10,
                border: '1px solid #d9d9d9',
                borderRadius: 12,
                background: '#fbfbfb',
                boxShadow: '0 8px 24px rgba(0,0,0,0.04)',
              }}
            >
              {statusBlock}
            </div>
          </div>
        )}

        {((!isMobile && desktopSettingsVisible) || (isMobile && showMobileSettings)) && settingsPanel}

        {isMobile && showMobilePalette && (
          <div style={{ minHeight: 420, maxHeight: '70vh' }}>{paletteShell}</div>
        )}
      </section>

      {!isMobile && paletteShell}





      {showFinalizeModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.35)',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <div
            style={{
              background: 'white',
              padding: 24,
              borderRadius: 12,
              width: 360,
              display: 'grid',
              gap: 16,
            }}
          >
            <h2 style={{ margin: 0 }}>Create finalized PDF?</h2>
            <p style={{ margin: 0 }}>
              This will generate a polished three-page PDF with the stitch canvas, a stitch report, and a true-size gridded reference page.
            </p>
            <div
              style={{
                display: 'grid',
                gap: 6,
                padding: 12,
                borderRadius: 10,
                background: '#f6f6f6',
                border: '1px solid #e2e2e2',
                fontSize: 14,
              }}
            >
              <div>
                <strong>Size:</strong>{' '}
                {`${lastSettings?.width_inches ?? 0}" x ${lastSettings?.height_inches ?? 0}"`}
              </div>
              <div>
                <strong>Mesh:</strong> {lastSettings?.mesh_count ?? 0}
              </div>
              <div>
                <strong>Requested colors:</strong> {requestedColorCount}
              </div>
              <div>
                <strong>Colors used:</strong> {currentDesignPalette.length}
              </div>
              <div>
                <strong>Total stitches:</strong> {currentDesignStitchCount}
              </div>
            </div>
            {hasPendingPreviewSettings && (
              <p style={{ margin: 0, color: '#8a5a00', fontSize: 14 }}>
                There are unapplied settings changes. Wait for the preview to refresh before finalizing.
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowFinalizeModal(false)}>Cancel</button>
              <button onClick={handleFinalize} disabled={loading || !cells.length || hasPendingPreviewSettings}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
