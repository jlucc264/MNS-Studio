'use client'

import {
  type DragEvent,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import ChatPanel from '../../components/ChatPanel'
import GridEditor, { type DesignSelectionRect } from '../../components/GridEditor'
import ImagePanel from '../../components/ImagePanel'
import PalettePanel from '../../components/PalettePanel'
import { ColorBrowserModal } from '../../components/ColorBrowserModal'
import PreviewControls, { PreviewSettings } from '../../components/PreviewControls'
import { AuthPanel } from '../../components/AuthPanel'
import { ProfileModal } from '../../components/ProfileModal'
import { userDisplayName } from '../../components/UserAvatar'
import { NavAccountControls } from '../../components/NavAccountControls'
import { useAuth } from '../../components/AuthProvider'
import {
  assetUrl,
  chatAssistant,
  createPreview,
  createPrintOwnCheckout,
  fetchDmcColors,
  fetchGalleryItemByProject,
  finalizePreview,
  formatCents,
  getCanvasForDesign,
  getProject,
  importImageFromUrl,
  PaletteColor,
  publishGalleryItem,
  saveProject,
  updateGalleryItem,
  updateProject,
  uploadImage,
} from '../../lib/api'

type ColorEditSnapshot = {
  cells: string[][]
  enabledColorHexes: string[]
  previewPalette: PaletteColor[]
  activePaintColor: string | null
  removalMode: 'fill' | 'blank'
  manualCellOverrides: Record<string, string>
  finishOutlineBackups: Record<string, string>
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
const BLANK_CELL = '__BLANK__'
const FINISH_OUTLINE_CELL = '__FINISH_OUTLINE__'

function estimateSkeins(stitchCount: number, meshCount: number): number {
  const stitchesPerSkein = meshCount >= 18 ? 350 : 200
  return Math.max(1, Math.ceil(stitchCount / stitchesPerSkein))
}

function cloneCells(source: string[][]) {
  return source.map((row) => [...row])
}

function countCellsByHex(source: string[][]) {
  const counts: Record<string, number> = {}
  source.forEach((row) => {
    row.forEach((cell) => {
      if (cell === BLANK_CELL || cell === FINISH_OUTLINE_CELL) return
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
      if (cell === BLANK_CELL || cell === FINISH_OUTLINE_CELL) return cell
      if (enabledSet.has(cell)) return cell
      if (nextRemovalMode === 'blank') return BLANK_CELL
      if (!enabledHexes.length) return '#FFFFFF'

      return enabledHexes.reduce((closest, candidate) =>
        colorDistance(cell, candidate) < colorDistance(cell, closest) ? candidate : closest
      )
    })
  )

  const usedHexes = new Set(
    nextCells.flat().filter((cell) => cell !== BLANK_CELL && cell !== FINISH_OUTLINE_CELL)
  )
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
  const nextPalette = sourcePalette
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
      if (source[row][col] === BLANK_CELL) return

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

const MAX_PRINT_SHORT = 6
const MAX_PRINT_LONG = 10

function clampPrintDimensions(w: number, h: number): { width_inches: number; height_inches: number } {
  let width = Math.max(0.5, Math.min(w, MAX_PRINT_LONG))
  let height = Math.max(0.5, Math.min(h, MAX_PRINT_LONG))
  if (width > MAX_PRINT_SHORT && height > MAX_PRINT_SHORT) {
    if (height <= width) height = MAX_PRINT_SHORT
    else width = MAX_PRINT_SHORT
  }
  return { width_inches: Number(width.toFixed(2)), height_inches: Number(height.toFixed(2)) }
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

function StudioPage() {
  const { session, user, signOut } = useAuth()
  const router = useRouter()
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
  const [toolMode, setToolMode] = useState<'paint' | 'select' | 'shape' | 'merge'>('paint')
  const [shapeType, setShapeType] = useState<'box' | 'semicircle' | 'line'>('box')
  const [arcFlipped, setArcFlipped] = useState(false)
  const [arcFullCircle, setArcFullCircle] = useState(false)
  const [shapeFillColor, setShapeFillColor] = useState<string | null>(null)
  const [shapeBorderColor, setShapeBorderColor] = useState<string | null>(null)
  const [shapeBorderSize, setShapeBorderSize] = useState(1)
  const [brushDensity, setBrushDensity] = useState(1)
  const [selectedRegions, setSelectedRegions] = useState<DesignSelectionRect[]>([])
  const [manualCellOverrides, setManualCellOverrides] = useState<Record<string, string>>({})
  const [finishOutlineBackups, setFinishOutlineBackups] = useState<Record<string, string>>({})
  const [finishApplied, setFinishApplied] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showFinalizeModal, setShowFinalizeModal] = useState(false)
  const [finalizeError, setFinalizeError] = useState('')
  const [finalPdfPath, setFinalPdfPath] = useState<string | null>(null)
  const [finalPreviewImagePath, setFinalPreviewImagePath] = useState<string | null>(null)
  const [lastSettings, setLastSettings] = useState<PreviewSettings | null>(null)
  const [draftSettings, setDraftSettings] = useState<PreviewSettings>(DEFAULT_SETTINGS)
  const [paletteReductionTarget, setPaletteReductionTarget] = useState(128)
  const [finishShape, setFinishShape] = useState<'circle' | 'square'>('circle')
  const [finishSizeInches, setFinishSizeInches] = useState(4)
  const [hasGeneratedPreview, setHasGeneratedPreview] = useState(false)
  const [viewportWidth, setViewportWidth] = useState(1280)
  const [activeWorkflowStep, setActiveWorkflowStep] = useState<1 | 2 | 3>(1)
  const [showChatDrawer, _setShowChatDrawer] = useState(false)
  const [stagedUploadDragActive, setStagedUploadDragActive] = useState(false)
  const [uploadTipsOpen, setUploadTipsOpen] = useState(false)
  const [savedProjectId, setSavedProjectId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('Untitled')
  const [showDraftNameModal, setShowDraftNameModal] = useState(false)
  const [authPrompt, setAuthPrompt] = useState<'login' | 'save' | 'finalize' | 'gallery' | null>(null)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [showPostFinalizeOptions, setShowPostFinalizeOptions] = useState(false)
  const [showGalleryPublishModal, setShowGalleryPublishModal] = useState(false)
  const [showRefinalizeConfirm, setShowRefinalizeConfirm] = useState(false)
  const [galleryItemId, setGalleryItemId] = useState<string | null>(null)
  const [galleryStep, setGalleryStep] = useState<'form' | 'confirm'>('form')
  const [galleryTitle, setGalleryTitle] = useState('')
  const [galleryTags, setGalleryTags] = useState('')
  const [galleryAcknowledged, setGalleryAcknowledged] = useState(false)
  const [galleryStatus, setGalleryStatus] = useState<'idle' | 'posting' | 'posted' | 'error'>('idle')
  const [galleryError, setGalleryError] = useState('')
  const [printCheckoutLoading, setPrintCheckoutLoading] = useState(false)
  const [printCheckoutError, setPrintCheckoutError] = useState('')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error' | 'limit'>('idle')
  const [dimensionLimitHit, setDimensionLimitHit] = useState(false)
  const [draftSaveError, setDraftSaveError] = useState('')
  const [showColorBrowser, setShowColorBrowser] = useState(false)
  const [colorBrowserTarget, setColorBrowserTarget] = useState<'add' | 'swap' | 'fill' | 'border'>('add')
  const [colorBrowserSwapFrom, setColorBrowserSwapFrom] = useState<PaletteColor | null>(null)
  const [, startPaletteTransition] = useTransition()
  const deferredCells = useDeferredValue(cells)
  const latestApplyRequestIdRef = useRef(0)
  const stagedUploadInputRef = useRef<HTMLInputElement | null>(null)
  const projectLoadedRef = useRef(false)
  const toolModeRef = useRef(toolMode)
  useEffect(() => { toolModeRef.current = toolMode }, [toolMode])
  const searchParams = useSearchParams()

  const clearActiveCanvas = useCallback(() => {
    localStorage.removeItem('mns_active_design')
    latestApplyRequestIdRef.current += 1
    setActiveImagePath(null)
    setImportedAspectRatio(null)
    setLockAspectRatio(true)
    setUploadError(null)
    setPreviewImagePath(null)
    setOriginalPreviewImagePath(null)
    setLastVisibleImageUrl(null)
    setAllPalette([])
    setPreviewPalette([])
    setOriginalCells([])
    setEnabledColorHexes([])
    setCells([])
    setActivePaintColor(null)
    setRemovalMode('fill')
    setUndoStack([])
    setRedoStack([])
    setViewMode('original')
    setIsPreviewExpanded(false)
    setToolMode('paint')
    setShapeType('box')
    setShapeFillColor(null)
    setShapeBorderColor(null)
    setBrushDensity(1)
    setSelectedRegions([])
    setManualCellOverrides({})
    setFinishOutlineBackups({})
    setFinishApplied(false)
    setLoading(false)
    setShowFinalizeModal(false)
    setFinalPdfPath(null)
    setFinalPreviewImagePath(null)
    setLastSettings(null)
    setDraftSettings(DEFAULT_SETTINGS)
    setPaletteReductionTarget(128)
    setFinishShape('circle')
    setFinishSizeInches(4)
    setHasGeneratedPreview(false)
    setActiveWorkflowStep(1)
    setSavedProjectId(null)
    setDraftName('Untitled')
    setShowDraftNameModal(false)
    setShowGalleryPublishModal(false)
    setGalleryTitle('')
    setGalleryTags('')
    setGalleryStatus('idle')
    setGalleryError('')
    setSaveStatus('idle')
    setDraftSaveError('')
  }, [])

  const finishFinalizeFlow = useCallback(() => {
    clearActiveCanvas()
    router.push('/gallery')
  }, [clearActiveCanvas, router])

  const skipGalleryPublish = useCallback(() => {
    if (galleryStatus === 'posting') return
    setGalleryAcknowledged(false)
    finishFinalizeFlow()
  }, [finishFinalizeFlow, galleryStatus])

  const openGalleryPublishModal = useCallback(() => {
    setGalleryStatus('idle')
    setGalleryError('')
    setGalleryAcknowledged(false)
    setGalleryStep('form')
    setShowPostFinalizeOptions(false)
    setShowGalleryPublishModal(true)
  }, [])

  const handleLogoutAndReturnToGallery = useCallback(async () => {
    setShowLogoutConfirm(false)
    setAuthPrompt(null)
    clearActiveCanvas()
    await signOut()
    router.push('/gallery')
  }, [clearActiveCanvas, router, signOut])

  const navigateAwayFromStudio = useCallback((href: '/gallery' | '/drafts') => {
    if (previewImagePath || cells.length > 0) {
      try {
        localStorage.setItem('mns_active_design', JSON.stringify({
          activeImagePath,
          previewImagePath,
          originalPreviewImagePath,
          lastVisibleImageUrl,
          allPalette,
          previewPalette,
          enabledColorHexes,
          cells,
          originalCells,
          manualCellOverrides,
          draftSettings,
          lastSettings,
          savedProjectId,
          draftName,
          hasGeneratedPreview,
          viewMode,
          activeWorkflowStep,
          importedAspectRatio,
        }))
      } catch {}
    }
    setAuthPrompt(null)
    setShowLogoutConfirm(false)
    setShowProfileModal(false)
    setShowDraftNameModal(false)
    setShowFinalizeModal(false)
    setShowGalleryPublishModal(false)
    router.push(href)
  }, [router, activeImagePath, previewImagePath, originalPreviewImagePath, lastVisibleImageUrl, allPalette, previewPalette, enabledColorHexes, cells, originalCells, manualCellOverrides, draftSettings, lastSettings, savedProjectId, draftName, hasGeneratedPreview, viewMode, activeWorkflowStep, importedAspectRatio])

  useEffect(() => {
    router.prefetch('/gallery')
    router.prefetch('/drafts')
  }, [router])

  useEffect(() => {
    if (!hasGeneratedPreview) return
    if (toolMode === 'paint') {
      setColorBrowserTarget('add')
      setColorBrowserSwapFrom(null)
      setShowColorBrowser(true)
    } else if (toolMode === 'select' || toolMode === 'merge') {
      setShowColorBrowser(false)
    }
  }, [toolMode, hasGeneratedPreview])

  useEffect(() => {
    const updateViewportWidth = () => {
      setViewportWidth(window.innerWidth || 1280)
    }

    updateViewportWidth()
    window.addEventListener('resize', updateViewportWidth)
    return () => window.removeEventListener('resize', updateViewportWidth)
  }, [])

  useEffect(() => {
    if (session?.access_token && authPrompt !== 'login') {
      setAuthPrompt(null)
    }
  }, [authPrompt, session?.access_token])

  useEffect(() => {
    const projectId = searchParams.get('project')

    if (!projectId) {
      if (projectLoadedRef.current) return
      const saved = localStorage.getItem('mns_active_design')
      if (!saved) return
      projectLoadedRef.current = true
      try {
        const d = JSON.parse(saved)
        if (d.activeImagePath) setActiveImagePath(d.activeImagePath)
        if (d.previewImagePath) {
          setPreviewImagePath(d.previewImagePath)
          setOriginalPreviewImagePath(d.originalPreviewImagePath ?? d.previewImagePath)
          setLastVisibleImageUrl(d.lastVisibleImageUrl ?? d.previewImagePath)
        }
        if (d.allPalette?.length) {
          setAllPalette(d.allPalette)
          setPreviewPalette(d.previewPalette ?? d.allPalette)
          setEnabledColorHexes(d.enabledColorHexes ?? d.allPalette.map((c: PaletteColor) => c.hex))
          setActivePaintColor(d.allPalette[0]?.hex ?? null)
        }
        if (d.cells?.length) {
          setCells(d.cells)
          setOriginalCells(d.originalCells ?? d.cells)
        }
        if (d.manualCellOverrides) setManualCellOverrides(d.manualCellOverrides)
        if (d.draftSettings) {
          setDraftSettings(d.draftSettings)
          setImportedAspectRatio(d.importedAspectRatio ?? null)
        }
        if (d.lastSettings) setLastSettings(d.lastSettings)
        if (d.savedProjectId) setSavedProjectId(d.savedProjectId)
        if (d.draftName) setDraftName(d.draftName)
        if (d.hasGeneratedPreview) setHasGeneratedPreview(true)
        if (d.viewMode) setViewMode(d.viewMode)
        if (d.activeWorkflowStep) setActiveWorkflowStep(d.activeWorkflowStep)
      } catch {}
      return
    }

    if (!session?.access_token || projectLoadedRef.current) return
    projectLoadedRef.current = true

    getProject(projectId, session.access_token).then((project) => {
      setSavedProjectId(project.id)
      setDraftName(project.name)

      const loadedPalette = project.palette ?? []
      setAllPalette(loadedPalette)
      setPreviewPalette(loadedPalette)
      setEnabledColorHexes(loadedPalette.map((c) => c.hex))
      setActivePaintColor(loadedPalette[0]?.hex ?? null)

      const loadedCells = project.cells ?? []
      setCells(loadedCells)
      setOriginalCells(loadedCells)

      if (project.source_image_url) setActiveImagePath(project.source_image_url)
      if (project.preview_image_url) {
        setPreviewImagePath(project.preview_image_url)
        setOriginalPreviewImagePath(project.preview_image_url)
        setLastVisibleImageUrl(project.preview_image_url)
      }
      const isSupabaseUrl = (url: string) => url.includes('supabase.co')
      if (project.pdf_url && isSupabaseUrl(project.pdf_url)) setFinalPdfPath(project.pdf_url)
      if (project.finalized && project.preview_image_url && isSupabaseUrl(project.preview_image_url)) setFinalPreviewImagePath(project.preview_image_url)
      if (project.finalized) {
        fetchGalleryItemByProject(project.id).then((item) => {
          if (item) setGalleryItemId(item.id)
        }).catch(() => {})
      }

      if (loadedCells.length > 0) {
        const settings: PreviewSettings = {
          ...DEFAULT_SETTINGS,
          width_inches: project.width_inches ?? DEFAULT_SETTINGS.width_inches,
          height_inches: project.height_inches ?? DEFAULT_SETTINGS.height_inches,
          mesh_count: (project.mesh_count as PreviewSettings['mesh_count']) ?? DEFAULT_SETTINGS.mesh_count,
          color_count: project.color_count ?? DEFAULT_SETTINGS.color_count,
          contrast_level: (project.contrast_level as PreviewSettings['contrast_level']) ?? DEFAULT_SETTINGS.contrast_level,
          source_type: (project.source_type as PreviewSettings['source_type']) ?? DEFAULT_SETTINGS.source_type,
          show_grid: project.show_grid ?? DEFAULT_SETTINGS.show_grid,
          clean_background: project.clean_background ?? DEFAULT_SETTINGS.clean_background,
          simplify_colors: project.simplify_colors ?? DEFAULT_SETTINGS.simplify_colors,
          strengthen_dark_detail: project.strengthen_dark_detail ?? DEFAULT_SETTINGS.strengthen_dark_detail,
          preserve_accents: project.preserve_accents ?? DEFAULT_SETTINGS.preserve_accents,
        }
        setDraftSettings(settings)
        setLastSettings(settings)
        setImportedAspectRatio(settings.width_inches / settings.height_inches)
        setHasGeneratedPreview(true)
        setViewMode('stitch')
        setActiveWorkflowStep(project.pdf_url ? 3 : 2)
      }
    }).catch(() => {
      // project load failed silently — user starts fresh
    })
  }, [searchParams, session?.access_token])

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

  const displayPalette = previewPalette

  const paletteCountsByHex = useMemo(() => countCellsByHex(deferredCells), [deferredCells])
  const displayColorCounts = paletteCountsByHex
  const hasPendingPreviewSettings = useMemo(
    () => hasGeneratedPreview && getSettingsKey(draftSettings) !== getSettingsKey(lastSettings),
    [draftSettings, hasGeneratedPreview, lastSettings]
  )
  const isBlankCanvas = !activeImagePath && hasGeneratedPreview
  const currentDesignPalette = useMemo(() => buildPaletteForCells(deferredCells), [allDmcColors, allPalette, deferredCells, previewPalette])
  const currentDesignColorCounts = useMemo(() => countCellsByHex(cells), [cells])
  const currentDesignStitchCount = useMemo(
    () => Object.values(currentDesignColorCounts).reduce((total, count) => total + count, 0),
    [currentDesignColorCounts]
  )
  const hasManualBlankCells = useMemo(
    () => {
      if (Object.values(manualCellOverrides).some((hex) => hex === BLANK_CELL)) return true

      return cells.some((row, rowIndex) =>
        row.some((cell, colIndex) => {
          if (cell !== BLANK_CELL) return false
          return originalCells[rowIndex]?.[colIndex] !== BLANK_CELL
        })
      )
    },
    [cells, manualCellOverrides, originalCells]
  )
  const selectedRegionBounds = useMemo(() => {
    if (!cells.length || !selectedRegions.length) return []
    return selectedRegions
      .map((region) => getClampedSelectionBounds(region, cells.length, cells[0]?.length ?? 0))
      .filter((bounds): bounds is { top: number; bottom: number; left: number; right: number } =>
        Boolean(bounds)
      )
  }, [cells, selectedRegions])
  const selectedRegionCount = useMemo(() => {
    if (!activePaintColor || !cells.length) return 0

    const boundsList = selectedRegionBounds.length
      ? selectedRegionBounds
      : [{
          top: 0,
          bottom: cells.length - 1,
          left: 0,
          right: (cells[0]?.length ?? 1) - 1,
        }]

    const counted = new Set<string>()
    let count = 0
    boundsList.forEach(({ top, bottom, left, right }) => {
      for (let row = top; row <= bottom; row += 1) {
        for (let col = left; col <= right; col += 1) {
          const key = makeCellKey(row, col)
          if (counted.has(key)) continue
          counted.add(key)
          if (cells[row]?.[col] === activePaintColor) {
          count += 1
          }
        }
      }
    })

    return count
  }, [activePaintColor, cells, selectedRegionBounds])
  const selectionMergeSuggestions = useMemo(() => {
    if (!activePaintColor || !selectedRegionBounds.length || !cells.length) return []

    const neighborCounts = new Map<string, number>()
    const directions: Array<[number, number]> = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]
    selectedRegionBounds.forEach(({ top, bottom, left, right }) => {
      for (let row = top; row <= bottom; row += 1) {
        for (let col = left; col <= right; col += 1) {
          if (cells[row]?.[col] !== activePaintColor) continue

          directions.forEach(([rowOffset, colOffset]) => {
            const nextRow = row + rowOffset
            const nextCol = col + colOffset
            if (nextRow < 0 || nextRow >= cells.length || nextCol < 0 || nextCol >= cells[nextRow].length) return

            const neighborHex = cells[nextRow][nextCol]
            if (neighborHex === activePaintColor) return
            if (neighborHex === BLANK_CELL) return

            neighborCounts.set(neighborHex, (neighborCounts.get(neighborHex) ?? 0) + 1)
          })
        }
      }
    })

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
  }, [activePaintColor, allDmcColors, cells, displayPalette, selectedRegionBounds])
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
    setFinishOutlineBackups({})
    setUndoStack([])
    setRedoStack([])
    setFinalPdfPath(null)
    setFinalPreviewImagePath(null)
    setLastSettings(null)
    setDraftSettings(DEFAULT_SETTINGS)
    setLockAspectRatio(true)
    setHasGeneratedPreview(false)
    setViewMode('original')
    setActiveWorkflowStep(2)

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

  function handleStartFresh() {
    const w = Math.max(1, Math.round(DEFAULT_SETTINGS.width_inches * DEFAULT_SETTINGS.mesh_count))
    const h = Math.max(1, Math.round(DEFAULT_SETTINGS.height_inches * DEFAULT_SETTINGS.mesh_count))
    const blankGrid = Array.from({ length: h }, () => Array(w).fill(BLANK_CELL))
    setActiveImagePath(null)
    setImportedAspectRatio(DEFAULT_SETTINGS.width_inches / DEFAULT_SETTINGS.height_inches)
    setPreviewImagePath(null)
    setOriginalPreviewImagePath(null)
    setLastVisibleImageUrl(null)
    setAllPalette([])
    setPreviewPalette([])
    setOriginalCells(blankGrid)
    setEnabledColorHexes([])
    setCells(blankGrid)
    setActivePaintColor(null)
    setManualCellOverrides({})
    setFinishOutlineBackups({})
    setUndoStack([])
    setRedoStack([])
    setFinalPdfPath(null)
    setFinalPreviewImagePath(null)
    setLastSettings(DEFAULT_SETTINGS)
    setDraftSettings(DEFAULT_SETTINGS)
    setLockAspectRatio(true)
    setHasGeneratedPreview(true)
    setViewMode('stitch')
    setActiveWorkflowStep(2)
  }

  function buildPaletteForCells(nextCells: string[][]) {
    const usedHexes = new Set(
      nextCells.flat().filter((cell) => cell !== BLANK_CELL && cell !== FINISH_OUTLINE_CELL)
    )
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
        finishOutlineBackups: { ...finishOutlineBackups },
      },
    ])
    setRedoStack([])
  }

  async function handleApply(settings: PreviewSettings) {
    if (!activeImagePath) return
    const requestId = latestApplyRequestIdRef.current + 1
    latestApplyRequestIdRef.current = requestId
    const previewSettings = {
      ...settings,
      color_count: 128,
    }

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
      previewSettings.color_count === lastSettings.color_count &&
      previousHadFilteredPalette

    const stitchWidth = Math.max(1, Math.round(previewSettings.width_inches * previewSettings.mesh_count))
    const stitchHeight = Math.max(1, Math.round(previewSettings.height_inches * previewSettings.mesh_count))
    const sameGeometryAsLastSettings = Boolean(
      lastSettings &&
        previewSettings.width_inches === lastSettings.width_inches &&
        previewSettings.height_inches === lastSettings.height_inches &&
        previewSettings.mesh_count === lastSettings.mesh_count
    )

    setLoading(true)
    try {
      const result = await createPreview({
        image_url: activeImagePath,
        stitch_width: stitchWidth,
        stitch_height: stitchHeight,
        color_count: previewSettings.color_count,
        show_grid: previewSettings.show_grid,
        clean_background: previewSettings.clean_background,
        simplify_colors: previewSettings.simplify_colors,
        strengthen_dark_detail: previewSettings.strengthen_dark_detail,
        preserve_accents: previewSettings.preserve_accents,
        mesh_count: previewSettings.mesh_count,
        contrast_level: previewSettings.contrast_level,
        source_type: previewSettings.source_type,
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
        previousActivePaintColor && previousActivePaintColor !== '#FFFFFF' && previousActivePaintColor !== BLANK_CELL
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
      setActivePaintColor(toolModeRef.current === 'select' ? null : nextActivePaintColor)
      setRemovalMode(shouldReapplyPaletteState ? previousRemovalMode : 'fill')
      setManualCellOverrides(shouldReapplyManualOverrides ? previousManualCellOverrides : {})
      setFinishOutlineBackups({})
      setFinishApplied(false)
      setUndoStack([])
      setRedoStack([])
      setLastSettings(previewSettings)
      setDraftSettings(previewSettings)
      setPaletteReductionTarget(nextFullPaletteHexes.length || 128)
      setFinalPdfPath(null)
      setFinalPreviewImagePath(null)
      setHasGeneratedPreview(true)
      setViewMode(hasGeneratedPreview ? previousViewMode : 'stitch')
      if (!hasGeneratedPreview) { setToolMode('select'); setActivePaintColor(null) }
      setActiveWorkflowStep(2)
      setSelectedRegions([])
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

  useEffect(() => {
    if (!hasGeneratedPreview || activeImagePath || !lastSettings) return

    const newW = Math.max(1, Math.round(draftSettings.width_inches * draftSettings.mesh_count))
    const newH = Math.max(1, Math.round(draftSettings.height_inches * draftSettings.mesh_count))
    const lastW = Math.max(1, Math.round(lastSettings.width_inches * lastSettings.mesh_count))
    const lastH = Math.max(1, Math.round(lastSettings.height_inches * lastSettings.mesh_count))
    if (newW === lastW && newH === lastH) return

    const timeoutId = window.setTimeout(() => {
      const blankGrid = Array.from({ length: newH }, () => Array(newW).fill(BLANK_CELL))
      setOriginalCells(blankGrid)
      setCells(blankGrid)
      setManualCellOverrides({})
      setUndoStack([])
      setRedoStack([])
      setLastSettings(draftSettings)
      setImportedAspectRatio(draftSettings.width_inches / draftSettings.height_inches)
    }, 250)

    return () => window.clearTimeout(timeoutId)
  }, [activeImagePath, draftSettings, hasGeneratedPreview, lastSettings])

  function updateSettings(patch: Partial<PreviewSettings>) {
    setDraftSettings((current) => {
      const next = { ...current, ...patch }
      const { width_inches, height_inches } = clampPrintDimensions(next.width_inches, next.height_inches)
      return { ...next, width_inches, height_inches }
    })
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
        if (!current) return toolModeRef.current === 'select' ? null : sourcePalette[0]?.hex ?? '#FFFFFF'
        if (current === BLANK_CELL) return current
        if (current === '#FFFFFF') return current
        return fullPaletteHexes.includes(current) ? current : sourcePalette[0]?.hex ?? '#FFFFFF'
      })
      setViewMode('stitch')
      setFinalPdfPath(null)
      setFinalPreviewImagePath(null)
      return
    }

    const { nextCells, nextPreviewPalette } = applyPaletteStateToCells(
      sourceCells,
      sourcePalette,
      nextEnabledColorHexes,
      nextRemovalMode
    )
    const collapsed = collapsePaletteShades(nextCells, nextPreviewPalette)
    const resolvedEnabledColorHexes = nextEnabledColorHexes.filter((hex) =>
      collapsed.palette.some((color) => color.hex === hex)
    )

    setPreviewImagePath(originalPreviewImagePath)
    setPreviewPalette(collapsed.palette)
    setEnabledColorHexes(resolvedEnabledColorHexes)
    setCells(collapsed.cells)
    setRemovalMode(nextRemovalMode)
    setActivePaintColor((current) => {
      if (!current) return toolModeRef.current === 'select' ? null : collapsed.palette[0]?.hex ?? '#FFFFFF'
      if (current === BLANK_CELL) return current
      if (current === '#FFFFFF') return current
      return resolvedEnabledColorHexes.includes(current) ? current : collapsed.palette[0]?.hex ?? '#FFFFFF'
    })
    setViewMode('stitch')
    setFinalPdfPath(null)
    setFinalPreviewImagePath(null)
  }

  function disableColorHex(hex: string) {
    if (!enabledColorHexes.includes(hex)) return
    if ((paletteCountsByHex[hex] ?? 0) === 0) {
      setEnabledColorHexes(enabledColorHexes.filter((item) => item !== hex))
      return
    }

    pushUndoSnapshot()
    applyEnabledPalette(enabledColorHexes.filter((item) => item !== hex))
  }

  function enableColorHex(hex: string) {
    if (enabledColorHexes.includes(hex)) return
    if ((paletteCountsByHex[hex] ?? 0) === 0) {
      setEnabledColorHexes(Array.from(new Set([...enabledColorHexes, hex])))
      return
    }

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
    const sourceState = buildEffectiveSourceState()
    const lockedBlankHexes = new Set(
      Object.entries(manualCellOverrides)
        .filter(([, value]) => value === BLANK_CELL)
        .map(([key]) => {
          const [rowText, colText] = key.split(':')
          const row = Number(rowText)
          const col = Number(colText)
          return originalCells[row]?.[col]
        })
        .filter((hex): hex is string => Boolean(hex) && hex !== BLANK_CELL && hex !== FINISH_OUTLINE_CELL)
    )
    const sourcePalette = sourceState.sourcePalette.filter((color) => !lockedBlankHexes.has(color.hex))
    const sourceCounts = countCellsByHex(sourceState.sourceCells)
    const clampedTarget = Math.max(2, Math.min(sourcePalette.length, targetCount))
    setPaletteReductionTarget(clampedTarget)

    if (!sourcePalette.length) return
    const nextEnabledColorHexes =
      clampedTarget >= sourcePalette.length
        ? sourcePalette.map((color) => color.hex)
        : pickDistinctPaletteHexes(sourcePalette, sourceCounts, clampedTarget, activePaintColor)

    if (
      nextEnabledColorHexes.length === enabledColorHexes.length &&
      nextEnabledColorHexes.every((hex) => enabledColorHexes.includes(hex))
    ) {
      return
    }

    pushUndoSnapshot()
    applyEnabledPalette(nextEnabledColorHexes)
  }

  function handleApplyShapeCells(shapeCells: Array<{row: number, col: number, color: string}>) {
    if (!shapeCells.length) return
    pushUndoSnapshot()
    let nextCells: string[][] | null = null
    setCells((current) => {
      const updated = current.map((row) => [...row])
      shapeCells.forEach(({row, col, color}) => {
        if (row < 0 || row >= updated.length || col < 0 || col >= updated[row].length) return
        updated[row][col] = color
      })
      nextCells = updated
      return updated
    })
    if (nextCells) {
      refreshPreviewPalette(nextCells)
      setManualCellOverrides((current) => {
        const next = { ...current }
        shapeCells.forEach(({row, col, color}) => {
          next[makeCellKey(row, col)] = color
        })
        return next
      })
    }
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
    setFinalPreviewImagePath(null)
  }

  function handleMergeCells(coords: Array<[number, number]>) {
    if (!coords.length) return
    const palette = displayPalette

    let nextCells: string[][] | null = null
    setCells((current) => {
      let changed = false
      const updatedCells = current.map((row) => [...row])
      coords.forEach(([row, col]) => {
        if (row < 0 || row >= updatedCells.length || col < 0 || col >= updatedCells[row].length) return
        const currentColor = updatedCells[row][col]
        if (!currentColor || currentColor === BLANK_CELL || currentColor === FINISH_OUTLINE_CELL) return
        const nearest = palette
          .filter((c) => c.hex !== currentColor)
          .sort((a, b) => {
            const dr1 = parseInt(currentColor.slice(1,3),16)-parseInt(a.hex.slice(1,3),16)
            const dg1 = parseInt(currentColor.slice(3,5),16)-parseInt(a.hex.slice(3,5),16)
            const db1 = parseInt(currentColor.slice(5,7),16)-parseInt(a.hex.slice(5,7),16)
            const dr2 = parseInt(currentColor.slice(1,3),16)-parseInt(b.hex.slice(1,3),16)
            const dg2 = parseInt(currentColor.slice(3,5),16)-parseInt(b.hex.slice(3,5),16)
            const db2 = parseInt(currentColor.slice(5,7),16)-parseInt(b.hex.slice(5,7),16)
            return (dr1**2+dg1**2+db1**2) - (dr2**2+dg2**2+db2**2)
          })[0]
        if (!nearest || nearest.hex === currentColor) return
        updatedCells[row][col] = nearest.hex
        changed = true
      })
      if (!changed) return current
      nextCells = updatedCells
      return updatedCells
    })

    if (nextCells) {
      refreshPreviewPalette(nextCells)
      setFinalPdfPath(null)
      setFinalPreviewImagePath(null)
    }
  }

  function handleApplyColorToSelection(targetHex: string) {
    if (!activePaintColor || !cells.length) return

    const boundsList = selectedRegionBounds.length
      ? selectedRegionBounds
      : [{
          top: 0,
          bottom: cells.length - 1,
          left: 0,
          right: (cells[0]?.length ?? 1) - 1,
        }]
    if (!boundsList.length) return

    const shouldApplyToCell = (rowIndex: number, colIndex: number) =>
      boundsList.some(
        ({ top, bottom, left, right }) =>
          rowIndex >= top && rowIndex <= bottom && colIndex >= left && colIndex <= right
      )
    let changed = 0
    const nextCells = cells.map((row, rowIndex) =>
      row.map((cell, colIndex) => {
        if (!shouldApplyToCell(rowIndex, colIndex)) return cell
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
      boundsList.forEach(({ top, bottom, left, right }) => {
        for (let row = top; row <= bottom; row += 1) {
          for (let col = left; col <= right; col += 1) {
            if (cells[row]?.[col] !== activePaintColor) continue
            nextOverrides[makeCellKey(row, col)] = targetHex
          }
        }
      })
      return nextOverrides
    })
    if (targetHex !== BLANK_CELL) {
      setEnabledColorHexes((current) => Array.from(new Set([...current, targetHex])))
      setActivePaintColor(targetHex)
    } else {
      const nextPalette = buildPaletteForCells(nextCells)
      setActivePaintColor(nextPalette[0]?.hex ?? null)
      setSelectedRegions([])
    }
    setFinalPdfPath(null)
    setFinalPreviewImagePath(null)
    setViewMode('stitch')
  }

  function handleClearSelection() {
    setSelectedRegions([])
  }

  function isInsideFinishShape(
    rowIndex: number,
    colIndex: number,
    rowCount: number,
    colCount: number,
    targetStitches: number,
    shape: 'circle' | 'square'
  ) {
    const halfSize = Math.min(targetStitches, rowCount, colCount) / 2
    const centerRow = rowCount / 2
    const centerCol = colCount / 2
    const rowOffset = rowIndex + 0.5 - centerRow
    const colOffset = colIndex + 0.5 - centerCol

    return shape === 'circle'
      ? rowOffset * rowOffset + colOffset * colOffset <= halfSize * halfSize
      : Math.abs(rowOffset) <= halfSize && Math.abs(colOffset) <= halfSize
  }

  function updateCellsWithManualOverrides(nextCells: string[][]) {
    setCells(nextCells)
    refreshPreviewPalette(nextCells)
    setManualCellOverrides((current) => {
      const nextOverrides = { ...current }
      nextCells.forEach((row, rowIndex) => {
        row.forEach((cell, colIndex) => {
          if (cells[rowIndex]?.[colIndex] === cell) return
          nextOverrides[makeCellKey(rowIndex, colIndex)] = cell
        })
      })
      return nextOverrides
    })
    setActivePaintColor(buildPaletteForCells(nextCells)[0]?.hex ?? null)
    setSelectedRegions([])
    setFinalPdfPath(null)
    setFinalPreviewImagePath(null)
    setViewMode('stitch')
  }

  function applyCenteredFinishMask(shape: 'circle' | 'square', sizeInches: number) {
    if (!cells.length) return
    const settings = lastSettings ?? draftSettings
    const targetStitches = Math.max(1, Math.round(sizeInches * settings.mesh_count))
    const rowCount = cells.length
    const colCount = cells[0]?.length ?? 0
    if (!colCount) return

    let changed = 0
    const nextCells = cells.map((row, rowIndex) =>
      row.map((cell, colIndex) => {
        const inside = isInsideFinishShape(rowIndex, colIndex, rowCount, colCount, targetStitches, shape)

        if (inside || cell === BLANK_CELL) return cell
        changed += 1
        return BLANK_CELL
      })
    )

    if (!changed) return

    pushUndoSnapshot()
    setFinishOutlineBackups({})
    setFinishApplied(true)
    updateCellsWithManualOverrides(nextCells)
  }

  function applyCenteredFinishOutline(shape: 'circle' | 'square', sizeInches: number) {
    if (!cells.length) return
    const settings = lastSettings ?? draftSettings
    const targetStitches = Math.max(1, Math.round(sizeInches * settings.mesh_count))
    const rowCount = cells.length
    const colCount = cells[0]?.length ?? 0
    if (!colCount) return

    const baseCells = cloneCells(cells)
    Object.entries(finishOutlineBackups).forEach(([key, previousCell]) => {
      const [rowText, colText] = key.split(':')
      const row = Number(rowText)
      const col = Number(colText)
      if (!Number.isInteger(row) || !Number.isInteger(col)) return
      if (baseCells[row]?.[col] === FINISH_OUTLINE_CELL) {
        baseCells[row][col] = previousCell
      }
    })

    let changed = false
    const nextOutlineBackups: Record<string, string> = {}
    const nextCells = baseCells.map((row, rowIndex) =>
      row.map((cell, colIndex) => {
        const inside = isInsideFinishShape(rowIndex, colIndex, rowCount, colCount, targetStitches, shape)
        if (!inside) return cell

        const isInterior = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].every(([rowOffset, colOffset]) =>
          isInsideFinishShape(rowIndex + rowOffset, colIndex + colOffset, rowCount, colCount, targetStitches, shape)
        )

        if (isInterior || cell === FINISH_OUTLINE_CELL) return cell
        const key = makeCellKey(rowIndex, colIndex)
        nextOutlineBackups[key] = cell
        changed = true
        return FINISH_OUTLINE_CELL
      })
    )

    if (
      !changed &&
      Object.keys(finishOutlineBackups).length === Object.keys(nextOutlineBackups).length
    ) {
      return
    }

    pushUndoSnapshot()
    setFinishOutlineBackups(nextOutlineBackups)
    setFinishApplied(true)
    updateCellsWithManualOverrides(nextCells)
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
          finishOutlineBackups: { ...finishOutlineBackups },
        },
      ])
      setCells(previous.cells)
      setEnabledColorHexes(previous.enabledColorHexes)
      setPreviewPalette(previous.previewPalette)
      setActivePaintColor(previous.activePaintColor)
      setRemovalMode(previous.removalMode)
      setManualCellOverrides(previous.manualCellOverrides)
      setFinishOutlineBackups(previous.finishOutlineBackups)
      setFinalPdfPath(null)
      setFinalPreviewImagePath(null)

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
          finishOutlineBackups: { ...finishOutlineBackups },
        },
      ])
      setCells(next.cells)
      setEnabledColorHexes(next.enabledColorHexes)
      setPreviewPalette(next.previewPalette)
      setActivePaintColor(next.activePaintColor)
      setRemovalMode(next.removalMode)
      setManualCellOverrides(next.manualCellOverrides)
      setFinishOutlineBackups(next.finishOutlineBackups)
      setFinalPdfPath(null)
      setFinalPreviewImagePath(null)

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
    if (!originalCells.length) return

    setShapeFillColor(null)
    setShapeBorderColor(null)
    setShapeBorderSize(1)
    setPreviewImagePath(originalPreviewImagePath)
    setPreviewPalette(allPalette)
    setEnabledColorHexes(allPalette.map((color) => color.hex))
    setCells(cloneCells(originalCells))
    setActivePaintColor(allPalette[0]?.hex ?? null)
    setRemovalMode('fill')
    setManualCellOverrides({})
    setFinishOutlineBackups({})
    setUndoStack([])
    setRedoStack([])
    setFinalPdfPath(null)
    setFinalPreviewImagePath(null)
    setViewMode('stitch')
    setSelectedRegions([])
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
        row.forEach((_cell, colIndex) => {
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
    setFinalPreviewImagePath(null)
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
    setFinalPreviewImagePath(null)
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
      if (displayPalette.length) {
        handleAutoReduceColors(colorCountValue)
        return { reply: `Reduced the current palette toward ${colorCountValue} colors.` }
      }
      return { reply: 'New previews generate at 128 colors. Generate a preview first, then reduce the current palette.' }
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
      return { reply: 'Turned Exclude blank canvas on.' }
    }

    if (
      lowered.includes('clean background off') ||
      lowered.includes('disable clean background') ||
      lowered.includes('turn clean background off')
    ) {
      updateSettings({ clean_background: false })
      return { reply: 'Turned Exclude blank canvas off.' }
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
          `New preview color budget: 128`,
          `Contrast: ${draftSettings.contrast_level.replaceAll('_', ' ')}`,
          `Exclude blank canvas: ${draftSettings.clean_background ? 'on' : 'off'}`,
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
      return { reply: 'Color removals will now leave blank canvas cells.' }
    }

    const paintMatch = lowered.match(/(?:paint|use|select)(?: with)? (.+)/)
    if (paintMatch) {
      const query = paintMatch[1].trim()
      if (query === 'blank' || query === 'white') {
        setActivePaintColor(query === 'blank' ? BLANK_CELL : '#FFFFFF')
        return { reply: `Selected ${query === 'blank' ? 'blank canvas' : 'white stitch'} as the paint color.` }
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

  async function handleStagedUploadDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setStagedUploadDragActive(false)
    if (loading) return

    const file = event.dataTransfer.files?.[0]
    if (!file || !file.type.startsWith('image/')) return

    await handleChatUpload(file)
  }

  async function handleFinalize(previousPdfUrl: string | null = null) {
    if (!session?.access_token) {
      setAuthPrompt('finalize')
      setShowFinalizeModal(false)
      return
    }

    const settingsForFinalize = lastSettings
    if (!settingsForFinalize || !cells.length || hasPendingPreviewSettings) {
      return
    }

    setLoading(true)
    setFinalizeError('')
    try {
      const finalWidth = contentBounds?.width_inches ?? settingsForFinalize.width_inches
      const finalHeight = contentBounds?.height_inches ?? settingsForFinalize.height_inches
      const result = await finalizePreview({
        preview_url: previewImagePath,
        width_inches: finalWidth,
        height_inches: finalHeight,
        mesh_count: settingsForFinalize.mesh_count,
        color_count: currentDesignPalette.length,
        contrast_level: settingsForFinalize.contrast_level,
        show_grid: settingsForFinalize.show_grid,
        palette: currentDesignPalette,
        cells,
        previous_pdf_url: previousPdfUrl,
      })

      const existingId = activeDraftProjectId
      const finalizedPayload = {
        name: draftName.trim() || 'Untitled',
        width_inches: finalWidth,
        height_inches: finalHeight,
        mesh_count: settingsForFinalize.mesh_count,
        color_count: currentDesignPalette.length,
        contrast_level: settingsForFinalize.contrast_level,
        source_type: settingsForFinalize.source_type,
        show_grid: settingsForFinalize.show_grid,
        clean_background: settingsForFinalize.clean_background,
        simplify_colors: settingsForFinalize.simplify_colors,
        strengthen_dark_detail: settingsForFinalize.strengthen_dark_detail,
        preserve_accents: settingsForFinalize.preserve_accents,
        palette: currentDesignPalette,
        cells,
        source_image_url: activeImagePath,
        preview_image_url: result.preview_image_url,
        pdf_url: result.pdf_url,
        finalized: true,
      }
      if (existingId) {
        await updateProject(existingId, finalizedPayload, session.access_token)
        if (!savedProjectId) setSavedProjectId(existingId)
      } else {
        const project = await saveProject(finalizedPayload, session.access_token)
        setSavedProjectId(project.id)
      }

      if (galleryItemId) {
        await updateGalleryItem(
          galleryItemId,
          {
            preview_image_url: result.preview_image_url,
            pdf_url: result.pdf_url,
            color_count: currentDesignPalette.length,
            palette: currentDesignPalette.map((c) => ({ hex: c.hex, dmc_code: c.dmc_code, dmc_name: c.dmc_name })),
            has_outline: Object.keys(finishOutlineBackups).length > 0,
          },
          session.access_token,
        ).catch(() => {})
      }

      setFinalPdfPath(result.pdf_url)
      setFinalPreviewImagePath(result.preview_image_url)
      setPreviewImagePath(result.preview_image_url)
      setOriginalPreviewImagePath(result.preview_image_url)
      setLastVisibleImageUrl(result.preview_image_url)
      setActiveWorkflowStep(3)
      setGalleryTitle(draftName.trim() === 'Untitled' ? '' : draftName.trim())
      setGalleryStatus('idle')
      setGalleryError('')
      setGalleryStep('form')
      setPrintCheckoutError('')
      setShowFinalizeModal(false)
      setShowRefinalizeConfirm(false)
      setShowPostFinalizeOptions(true)
    } catch (err) {
      setFinalizeError(err instanceof Error ? err.message : 'Something went wrong generating the PDF.')
    } finally {
      setLoading(false)
    }
  }

  async function handlePublishGalleryItem() {
    if (!session?.access_token) {
      setAuthPrompt('gallery')
      setShowGalleryPublishModal(false)
      return
    }
    if (!finalPdfPath) return

    const title = galleryTitle.trim()
    if (!title) {
      setGalleryStatus('error')
      setGalleryError('Add a piece name and try again.')
      return
    }
    if (!galleryAcknowledged) {
      setGalleryStatus('error')
      setGalleryError('Acknowledge the disclaimer before sharing.')
      return
    }

    setGalleryStatus('posting')
    setGalleryError('')
    try {
      const publishedItem = await publishGalleryItem(
        {
          title,
          tags: galleryTags
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean),
          submitter_name: userDisplayName(user),
          preview_image_url: finalPreviewImagePath ?? previewImagePath,
          pdf_url: finalPdfPath,
          width_inches: lastSettings?.width_inches ?? null,
          height_inches: lastSettings?.height_inches ?? null,
          mesh_count: lastSettings?.mesh_count ?? null,
          color_count: currentDesignPalette.length,
          palette: currentDesignPalette.map((c) => ({ hex: c.hex, dmc_code: c.dmc_code, dmc_name: c.dmc_name })),
          has_outline: Object.keys(finishOutlineBackups).length > 0,
          project_id: savedProjectId ?? null,
        },
        session.access_token,
      )
      setGalleryItemId(publishedItem.id)
      setGalleryStatus('posted')
      finishFinalizeFlow()
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      setGalleryError(message || 'Gallery post failed. Please try again.')
      setGalleryStatus('error')
    }
  }

  async function handlePrintOwnCheckout() {
    if (!session?.access_token) {
      setAuthPrompt('finalize')
      return
    }
    if (!finalPdfPath || !lastSettings) return
    setPrintCheckoutLoading(true)
    setPrintCheckoutError('')
    try {
      const { checkout_url } = await createPrintOwnCheckout(
        {
          pdf_url: finalPdfPath,
          width_inches: lastSettings.width_inches,
          height_inches: lastSettings.height_inches,
        },
        session.access_token,
      )
      window.location.href = checkout_url
    } catch (err) {
      setPrintCheckoutError(err instanceof Error ? err.message : 'Could not start checkout.')
      setPrintCheckoutLoading(false)
    }
  }

  const statusBlock = (
    <>
      {loading && !hasGeneratedPreview && <p style={{ margin: 0 }}>Working...</p>}
      {uploadError && <p style={{ color: '#b00020', margin: 0 }}>{uploadError}</p>}
      {dimensionLimitHit && (
        <p style={{ margin: 0, color: '#b00020' }}>Max Print Area is 10&quot; x 6&quot;.</p>
      )}
      {hasPendingPreviewSettings && !loading && (
        <p style={{ margin: 0, color: '#8a5a00' }}>
          Settings changed. Waiting for the stitch preview to refresh before finalizing.
        </p>
      )}

      {finalPdfPath && !loading && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <a
            href={assetUrl(finalPdfPath) ?? '#'}
            target="_blank"
            rel="noreferrer"
            style={{
              padding: '7px 14px',
              border: '1px solid #d7d0c8',
              borderRadius: 8,
              fontFamily: 'inherit',
              fontSize: 13,
              fontWeight: 600,
              background: '#fff',
              color: '#3f382f',
              textDecoration: 'none',
            }}
          >
            Download PDF report
          </a>
        </div>
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
    />
  )

  const settingsPanel = (
    <div
      style={{
        display: 'grid',
        gap: 9,
        width: '100%',
        minWidth: 0,
        minHeight: 286,
        alignContent: 'start',
        padding: '14px 12px 16px',
        boxSizing: 'border-box',
        overflow: 'visible',
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
        lockAspectRatio={lockAspectRatio}
        isBlankCanvas={isBlankCanvas}
        onSettingsChange={setDraftSettings}
        onLockAspectRatioChange={setLockAspectRatio}
        onDimensionClamped={() => {
          setDimensionLimitHit(true)
          setTimeout(() => setDimensionLimitHit(false), 3000)
        }}
      />
      <label
        style={{
          display: 'flex',
          gap: 7,
          alignItems: 'center',
          paddingTop: 2,
          fontSize: 12,
          lineHeight: 1.1,
          color: '#3f382f',
          opacity: isBlankCanvas ? 0.4 : 1,
          pointerEvents: isBlankCanvas ? 'none' : undefined,
        }}
      >
        <input
          type="checkbox"
          checked={draftSettings.clean_background}
          onChange={(event) => updateSettings({ clean_background: event.target.checked })}
        />
        Exclude blank canvas
      </label>
    </div>
  )

  const paletteReductionPanel = hasGeneratedPreview && allPalette.length > 2 && (
    <div
      style={{
        display: 'grid',
        gap: 8,
        width: '100%',
        minWidth: 0,
        padding: 12,
        boxSizing: 'border-box',
        border: hasManualBlankCells ? '1px solid #c94f42' : '1px solid #d9d9d9',
        borderRadius: 12,
        background: hasManualBlankCells ? '#fff7f5' : '#fbfbfb',
        boxShadow: '0 8px 24px rgba(0,0,0,0.04)',
      }}
    >
      <label style={{ display: 'grid', gap: 6, fontSize: 13, color: '#3f382f' }}>
        <span style={{ fontWeight: 600, color: hasManualBlankCells ? '#b23428' : '#3f382f' }}>
          Reduce current palette to: {currentDesignPalette.length}
        </span>
        <input
          type="range"
          min={2}
          max={allPalette.length}
          step={1}
          value={Math.max(2, Math.min(allPalette.length, paletteReductionTarget))}
          onChange={(event) => handleAutoReduceColors(Number(event.target.value))}
          style={{ width: '100%' }}
        />
      </label>
      <div style={{ fontSize: 12, color: '#8a8177' }}>
        {hasManualBlankCells
          ? 'Null/X removals are reflected in the current color count.'
          : 'Drag left to reduce colors. Drag back right to restore the generated palette.'}
      </div>
    </div>
  )

  const designWidthInches = lastSettings?.width_inches ?? draftSettings.width_inches
  const designHeightInches = lastSettings?.height_inches ?? draftSettings.height_inches
  const designMeshCount = lastSettings?.mesh_count ?? draftSettings.mesh_count
  const finishSizeLimit = Math.max(1, Number(Math.min(designWidthInches, designHeightInches).toFixed(2)))
  const resolvedFinishSize = Math.max(1, Math.min(finishSizeLimit, finishSizeInches))
  const canvasPaddingInches = 2
  const requiredCanvasWidth =
    finishShape === 'circle' ? resolvedFinishSize + canvasPaddingInches : Math.min(resolvedFinishSize, designWidthInches) + canvasPaddingInches
  const requiredCanvasHeight =
    finishShape === 'circle' ? resolvedFinishSize + canvasPaddingInches : Math.min(resolvedFinishSize, designHeightInches) + canvasPaddingInches
  const availableCanvasSizes = [
    { label: '5 x 6', width: 5, height: 6 },
    { label: '8 x 6', width: 8, height: 6 },
    { label: '8 x 12', width: 8, height: 12 },
  ]
  const canvasFits = (canvas: { width: number; height: number }) =>
    (requiredCanvasWidth <= canvas.width && requiredCanvasHeight <= canvas.height) ||
    (requiredCanvasWidth <= canvas.height && requiredCanvasHeight <= canvas.width)
  const selectedCanvasSize = availableCanvasSizes.find(canvasFits) ?? availableCanvasSizes[availableCanvasSizes.length - 1]
  const selectedCanvasFits = canvasFits(selectedCanvasSize)
  const workflowSteps = [
    { id: 1 as const, label: 'Upload Image', complete: Boolean(activeImagePath) },
    { id: 2 as const, label: 'Design', complete: Boolean(hasGeneratedPreview) },
    { id: 3 as const, label: 'Finalize', complete: Boolean(finalPdfPath) },
  ]
  const activeDraftProjectId = savedProjectId ?? searchParams.get('project')

  async function handleSaveDraft() {
    if (saveStatus === 'saving') return
    if (!session?.access_token) {
      setAuthPrompt('save')
      return
    }
    setDraftSaveError('')
    setSaveStatus('saving')
    try {
      const normalizedDraftName = draftName.trim() || 'Untitled'
      const payload = {
        name: normalizedDraftName,
        width_inches: draftSettings.width_inches,
        height_inches: draftSettings.height_inches,
        mesh_count: draftSettings.mesh_count,
        color_count: draftSettings.color_count,
        contrast_level: draftSettings.contrast_level,
        source_type: draftSettings.source_type,
        show_grid: draftSettings.show_grid,
        clean_background: draftSettings.clean_background,
        simplify_colors: draftSettings.simplify_colors,
        strengthen_dark_detail: draftSettings.strengthen_dark_detail,
        preserve_accents: draftSettings.preserve_accents,
        palette: previewPalette,
        cells: cells.length ? cells : undefined,
        source_image_url: activeImagePath,
        preview_image_url: previewImagePath,
        pdf_url: finalPdfPath,
        finalized: Boolean(finalPdfPath),
      }
      const existingId = activeDraftProjectId
      let isNewProject = false
      if (existingId) {
        await updateProject(existingId, payload, session.access_token)
        if (!savedProjectId) setSavedProjectId(existingId)
      } else {
        const project = await saveProject(payload, session.access_token)
        setSavedProjectId(project.id)
        isNewProject = true
      }
      setDraftName(normalizedDraftName)
      if (isNewProject) {
        setShowDraftNameModal(true)
      } else {
        setShowDraftNameModal(false)
      }
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2500)
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      setDraftSaveError(
        msg.toLowerCase().includes('limit')
          ? 'Draft limit reached. Delete a saved design before saving a new one.'
          : 'File not saved. Please check your connection and try again.'
      )
      setSaveStatus(msg.toLowerCase().includes('limit') ? 'limit' : 'error')
      setTimeout(() => setSaveStatus('idle'), 4000)
    }
  }

  const btnPrimary = {
    padding: '9px 18px',
    borderRadius: 8,
    border: '1px solid #5c7856',
    background: '#6e8d67',
    color: '#fff',
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    lineHeight: 1.3,
  } as const

  const btnSecondary = {
    padding: '8px 14px',
    borderRadius: 8,
    border: '1px solid #d7d0c8',
    background: '#fff',
    color: '#3f382f',
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    lineHeight: 1.3,
  } as const
  const previewStatsSettings = hasGeneratedPreview ? lastSettings : null

  const contentBounds = useMemo(() => {
    if (!cells.length || !lastSettings) return null
    const gridH = cells.length
    const gridW = cells[0].length
    let minRow = gridH, maxRow = -1, minCol = gridW, maxCol = -1
    let hasBlank = false
    for (let r = 0; r < gridH; r++) {
      for (let c = 0; c < gridW; c++) {
        if (cells[r][c] === BLANK_CELL) {
          hasBlank = true
        } else if (cells[r][c] !== FINISH_OUTLINE_CELL) {
          if (r < minRow) minRow = r
          if (r > maxRow) maxRow = r
          if (c < minCol) minCol = c
          if (c > maxCol) maxCol = c
        }
      }
    }
    if (!hasBlank || maxRow === -1) return null
    return {
      width_inches: Math.round((maxCol - minCol + 1) / gridW * lastSettings.width_inches * 100) / 100,
      height_inches: Math.round((maxRow - minRow + 1) / gridH * lastSettings.height_inches * 100) / 100,
    }
  }, [cells, lastSettings])

  const previewDesignLabel = previewStatsSettings
    ? contentBounds
      ? `${contentBounds.width_inches}" × ${contentBounds.height_inches}"`
      : `${previewStatsSettings.width_inches.toFixed(1)}" × ${previewStatsSettings.height_inches.toFixed(1)}"`
    : 'N/A'
  const previewStitchesLabel = hasGeneratedPreview
    ? currentDesignStitchCount.toLocaleString()
    : 'N/A'
  const previewMeshLabel = previewStatsSettings ? `${previewStatsSettings.mesh_count}ct` : 'N/A'
  const isFinalized = Boolean(finalPdfPath)
  const isFinalizeReview = activeWorkflowStep === 3
  const shouldAllowCanvasEditing = !isFinalizeReview && activeWorkflowStep === 2

  const previewToolbar = (
    <div
      style={{
        display: 'flex',
        gap: 18,
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 14px',
        borderBottom: '1px solid #e8e4db',
        background: '#fffdf8',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: 1.5, color: '#8b8377', fontWeight: 700 }}>DESIGN</div>
          <strong style={{ fontSize: 13 }}>{previewDesignLabel}</strong>
        </div>
        <div>
          <div style={{ fontSize: 10, letterSpacing: 1.5, color: '#8b8377', fontWeight: 700 }}>SUGGESTED CANVAS</div>
          <strong style={{ fontSize: 13 }}>
            {previewStatsSettings
              ? (() => {
                  const w = contentBounds?.width_inches ?? previewStatsSettings.width_inches
                  const h = contentBounds?.height_inches ?? previewStatsSettings.height_inches
                  const rw = w + 2
                  const rh = h + 2
                  const fit = availableCanvasSizes.find(
                    (c) =>
                      (rw <= c.width && rh <= c.height) ||
                      (rw <= c.height && rh <= c.width)
                  ) ?? availableCanvasSizes[availableCanvasSizes.length - 1]
                  return fit.label + '"'
                })()
              : 'N/A'}
          </strong>
        </div>
        <div>
          <div style={{ fontSize: 10, letterSpacing: 1.5, color: '#8b8377', fontWeight: 700 }}>STITCHES</div>
          <strong style={{ fontSize: 13 }}>{previewStitchesLabel}</strong>
        </div>
        <div>
          <div style={{ fontSize: 10, letterSpacing: 1.5, color: '#6d8568', fontWeight: 700 }}>MESH</div>
          <strong style={{ fontSize: 13, color: '#5f7f5a' }}>{previewMeshLabel}</strong>
        </div>
      </div>

      <button type="button" onClick={() => setIsPreviewExpanded((current) => !current)} style={btnSecondary}>
        {isPreviewExpanded ? 'Collapse preview' : 'Expand preview'}
      </button>
    </div>
  )

  const leftPanelContent = (() => {
    if (activeWorkflowStep === 1) {
      return (
        <>
          <div>
            <h2 style={{ margin: 0, fontSize: 28, lineHeight: 1.05, fontWeight: 700 }}>
              Upload Image
            </h2>
            <p style={{ margin: '8px 0 0', color: '#8a8177', fontSize: 15 }}>
              Start with a photo, screenshot, or artwork file.
            </p>
          </div>

          <div
            style={{
              borderRadius: 10,
              border: '1px solid #e4ddd5',
              background: '#faf7f3',
              fontSize: 12,
              color: '#6f665b',
            }}
          >
            <button
              type="button"
              onClick={() => setUploadTipsOpen((o) => !o)}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                width: '100%',
                padding: '10px 14px',
                background: 'none',
                border: 'none',
                fontFamily: 'inherit',
                fontSize: 12,
                fontWeight: 600,
                color: '#3f382f',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              Tips for best results
              <span style={{ fontSize: 10, color: '#9a9287' }}>{uploadTipsOpen ? '▲' : '▼'}</span>
            </button>
            {uploadTipsOpen && (
              <ul style={{ margin: 0, paddingLeft: 16, paddingRight: 14, paddingBottom: 10, display: 'grid', gap: 2, lineHeight: 1.6 }}>
                <li>Crop tight to your subject before uploading</li>
                <li>Simpler images with clear shapes work better than busy scenes</li>
                <li>High contrast and bold outlines translate well to stitch</li>
                <li>Too much fine detail or similar background colors can muddy the result</li>
                <li style={{ color: '#8a8177' }}>Supported formats: JPEG, PNG, WebP, GIF, BMP — AVIF, HEIC, SVG, RAW files are not supported</li>
              </ul>
            )}
          </div>

          <div
            onDragEnter={(event) => {
              event.preventDefault()
              if (!loading) setStagedUploadDragActive(true)
            }}
            onDragOver={(event) => {
              event.preventDefault()
              if (!loading) setStagedUploadDragActive(true)
            }}
            onDragLeave={(event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
              setStagedUploadDragActive(false)
            }}
            onDrop={(event) => void handleStagedUploadDrop(event)}
            style={{
              display: 'grid',
              gap: 12,
              padding: 18,
              border: stagedUploadDragActive ? '1px solid #6e8d67' : '1px dashed #d5ccbf',
              borderRadius: 14,
              background: stagedUploadDragActive ? '#f0f6ee' : '#fff',
              boxShadow: '0 10px 24px rgba(44, 37, 30, 0.06)',
            }}
          >
            <input
              ref={stagedUploadInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void handleChatUpload(file)
                event.target.value = ''
              }}
            />
            <div
              role="button"
              tabIndex={0}
              onClick={() => stagedUploadInputRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  stagedUploadInputRef.current?.click()
                }
              }}
              style={{
                display: 'grid',
                placeItems: 'center',
                gap: 8,
                minHeight: 150,
                padding: 18,
                borderRadius: 12,
                background: '#f8f5ef',
                color: '#6f665b',
                textAlign: 'center',
                cursor: loading ? 'default' : 'pointer',
              }}
            >
              <strong style={{ color: '#3f382f', fontSize: 18 }}>Drop image file here</strong>
              <span>or click to choose a file</span>
            </div>
            <button type="button" disabled style={{ ...btnSecondary, opacity: 0.5, cursor: 'default' }}>
              Import URL in chat (Coming Soon)
            </button>
            {activeImagePath && <p style={{ margin: 0, color: '#5f7f5a' }}>Image loaded.</p>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, height: 1, background: '#e7e1d8' }} />
            <span style={{ fontSize: 12, color: '#a09890' }}>or</span>
            <div style={{ flex: 1, height: 1, background: '#e7e1d8' }} />
          </div>
          <button
            type="button"
            onClick={handleStartFresh}
            disabled={loading}
            style={btnSecondary}
          >
            Start with a blank canvas
          </button>
          {statusBlock}
          {activeImagePath && (
            <button
              type="button"
              onClick={() => setActiveWorkflowStep(2)}
              style={btnPrimary}
            >
              Continue to Design →
            </button>
          )}
        </>
      )
    }

    if (activeWorkflowStep === 2) {
      return (
        <>
          <div>
            <h2 style={{ margin: 0, fontSize: 28, lineHeight: 1.05, fontWeight: 700 }}>
              Design
            </h2>
          <p style={{ margin: '8px 0 0', color: '#8a8177', fontSize: 15 }}>
              Set Size, Mesh, Source Type, and Create!
            </p>
          </div>
          {paletteReductionPanel}
          {settingsPanel}
          {activeImagePath && (
            <button
              type="button"
              onClick={() => void handleApply(draftSettings)}
              disabled={loading}
              style={btnPrimary}
            >
              {hasGeneratedPreview ? 'Regenerate preview' : 'Generate stitch preview'}
            </button>
          )}
          {statusBlock}
          {hasGeneratedPreview && !finalPdfPath && (
            <button
              type="button"
              onClick={() => setActiveWorkflowStep(3)}
              disabled={!activeImagePath && undoStack.length === 0}
              style={{ ...btnSecondary, opacity: !activeImagePath && undoStack.length === 0 ? 0.4 : 1 }}
            >
              Continue to Finalize →
            </button>
          )}
        </>
      )
    }

    if (isFinalized) {
      return (
        <>
          <div>
            <h2 style={{ margin: 0, fontSize: 28, lineHeight: 1.05, fontWeight: 700 }}>
              Finalized
            </h2>
            <p style={{ margin: '8px 0 0', color: '#8a8177', fontSize: 15 }}>
              This design is locked. Use the buttons below to download the PDF or finish sharing it.
            </p>
          </div>
          <div
            style={{
              display: 'grid',
              gap: 10,
              padding: 16,
              border: '1px solid #e8e2d7',
              borderRadius: 14,
              background: '#fff',
              fontSize: 14,
            }}
          >
            <strong>Canvas summary</strong>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
              <div><strong>Design:</strong> {designWidthInches.toFixed(1)}&quot; x {designHeightInches.toFixed(1)}&quot;</div>
              <div><strong>Mesh:</strong> {designMeshCount}</div>
              <div><strong>Colors:</strong> {currentDesignPalette.length}</div>
              <div><strong>Stitches:</strong> {currentDesignStitchCount.toLocaleString()}</div>
              <div><strong>Est. skeins:</strong> {currentDesignPalette.reduce((sum, c) => sum + estimateSkeins(currentDesignColorCounts[c.hex] ?? 0, designMeshCount), 0)}</div>
            </div>
          </div>
          <a
            href={assetUrl(finalPdfPath) ?? '#'}
            target="_blank"
            rel="noreferrer"
            style={{ ...btnPrimary, textAlign: 'center', textDecoration: 'none' }}
          >
            Download PDF report
          </a>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 8 }}>
            <button
              type="button"
              onClick={() => void handlePrintOwnCheckout()}
              disabled={!lastSettings || printCheckoutLoading}
              style={{ ...btnSecondary, opacity: !lastSettings ? 0.55 : 1, cursor: !lastSettings ? 'not-allowed' : 'pointer' }}
            >
              {printCheckoutLoading ? 'Redirecting...' : 'Order print'}
            </button>
            <button type="button" onClick={openGalleryPublishModal} style={btnSecondary}>
              Share to gallery
            </button>
          </div>
          {printCheckoutError && <p style={{ margin: 0, fontSize: 13, color: '#b0453a' }}>{printCheckoutError}</p>}
          <button type="button" onClick={finishFinalizeFlow} style={btnSecondary}>
            Go to Gallery
          </button>
          {statusBlock}
        </>
      )
    }

    return (
      <>
        <div>
          <h2 style={{ margin: 0, fontSize: 28, lineHeight: 1.05, fontWeight: 700 }}>
            Finalize
          </h2>
          <p style={{ margin: '8px 0 0', color: '#8a8177', fontSize: 15 }}>
            Generate the final two-page PDF report when the canvas looks right.
          </p>
        </div>
        <div
          style={{
            display: 'grid',
            gap: 10,
            padding: 16,
            border: '1px solid #e8e2d7',
            borderRadius: 14,
            background: '#fff',
            fontSize: 14,
          }}
        >
          <strong>Canvas summary</strong>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
            <div><strong>Design:</strong> {(contentBounds?.width_inches ?? designWidthInches).toFixed(1)}&quot; x {(contentBounds?.height_inches ?? designHeightInches).toFixed(1)}&quot;</div>
            <div><strong>Mesh:</strong> {designMeshCount}</div>
            <div><strong>Colors:</strong> {currentDesignPalette.length}</div>
            <div><strong>Stitches:</strong> {currentDesignStitchCount.toLocaleString()}</div>
            <div><strong>Est. skeins:</strong> {currentDesignPalette.reduce((sum, c) => sum + estimateSkeins(currentDesignColorCounts[c.hex] ?? 0, designMeshCount), 0)}</div>
            <div>
              <strong>Finishing:</strong>{' '}
              {finishApplied
                ? finishShape === 'circle'
                  ? `${resolvedFinishSize.toFixed(1)}" round`
                  : `${resolvedFinishSize.toFixed(1)}" square`
                : 'N/A'}
            </div>
            <div><strong>Canvas:</strong> {selectedCanvasSize.label}</div>
          </div>
          <div style={{ color: '#8a8177', lineHeight: 1.35 }}>
            {selectedCanvasFits
              ? `Chosen from 5 x 6, 8 x 6, and 8 x 12 with about 1" working canvas on each side.`
              : `This design needs about ${requiredCanvasWidth.toFixed(1)}" x ${requiredCanvasHeight.toFixed(1)}", which is larger than the available sizes.`}
          </div>
        </div>
        <div
          style={{
            display: 'grid',
            gap: 10,
            padding: 16,
            border: '1px solid #e8e2d7',
            borderRadius: 14,
            background: '#fff',
            fontSize: 14,
          }}
        >
          <strong>Finishing shape</strong>
          <div style={{ color: '#8a8177', lineHeight: 1.35 }}>
            Crop out unwanted background and add a perimeter circle for ornaments.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button
              type="button"
              onClick={() => setFinishShape('circle')}
              style={finishShape === 'circle' ? btnPrimary : btnSecondary}
            >
              Round
            </button>
            <button
              type="button"
              onClick={() => setFinishShape('square')}
              style={finishShape === 'square' ? btnPrimary : btnSecondary}
            >
              Square
            </button>
          </div>
          <label style={{ display: 'grid', gap: 6 }}>
            <span>
              {finishShape === 'circle' ? 'Diameter' : 'Width'}: {resolvedFinishSize.toFixed(1)}&quot;
            </span>
            <input
              type="range"
              min={1}
              max={finishSizeLimit}
              step={0.25}
              value={resolvedFinishSize}
              onChange={(event) => setFinishSizeInches(Number(event.target.value))}
            />
          </label>
          <button
            type="button"
            onClick={() => applyCenteredFinishMask(finishShape, resolvedFinishSize)}
            disabled={!cells.length}
            style={btnSecondary}
          >
            Crop outside shape
          </button>
          <button
            type="button"
            onClick={() => applyCenteredFinishOutline(finishShape, resolvedFinishSize)}
            disabled={!cells.length}
            style={btnSecondary}
          >
            Draw 1-stitch black outline
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            if (!session?.access_token) {
              setAuthPrompt('finalize')
              return
            }
            setFinalizeError('')
            if (finalPdfPath) {
              setShowRefinalizeConfirm(true)
            } else {
              setShowFinalizeModal(true)
            }
          }}
          disabled={!cells.length || (!!activeImagePath && !previewImagePath) || hasPendingPreviewSettings || loading}
          style={btnPrimary}
        >
          {finalPdfPath ? 'Regenerate PDF' : 'Finalize & Export PDF'}
        </button>
        {statusBlock}
      </>
    )
  })()

  return (
    <main
      style={{
        display: 'grid',
        gridTemplateRows: isMobile ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) auto',
        minHeight: '100dvh',
        height: '100dvh',
        paddingTop: 72,
        overflow: 'hidden',
        boxSizing: 'border-box',
        width: '100%',
        background: '#f5f1ea',
        color: '#3f382f',
        isolation: 'isolate',
      }}
    >
      <nav
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 18,
          padding: isMobile ? '0 14px' : '0 28px',
          borderBottom: '1px solid #e7e1d8',
          background: '#fffdf8',
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: 72,
          boxSizing: 'border-box',
          zIndex: 10000,
          pointerEvents: 'auto',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 12, minWidth: 0, flexShrink: 1, overflow: 'hidden' }}>
          <button
            type="button"
            onClick={() => navigateAwayFromStudio('/gallery')}
            style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flexShrink: 0, border: 0, background: 'transparent', padding: 0, cursor: 'pointer', font: 'inherit' }}
          >
            <div
              aria-hidden="true"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 9px)',
                gap: 3,
                padding: 2,
                flexShrink: 0,
              }}
            >
              {Array.from({ length: 9 }, (_, index) => (
                <span
                  key={index}
                  style={{
                    width: 9,
                    height: 9,
                    border: '2px solid #111',
                    borderRadius: 2,
                    boxSizing: 'border-box',
                  }}
                />
              ))}
            </div>
            <strong style={{ fontSize: 22, color: '#111', whiteSpace: 'nowrap' }}>MNS Studio</strong>
          </button>
          {!isMobile && (
            <>
              <span style={{ color: '#d8d0c4', margin: '0 6px' }}>|</span>
              <div style={{ display: 'flex', gap: 24, color: '#7f776d', fontWeight: 600, whiteSpace: 'nowrap' }}>
                <button
                  type="button"
                  onClick={() => navigateAwayFromStudio('/gallery')}
                  style={{ border: 0, background: 'transparent', font: 'inherit', color: '#7f776d', padding: 0, cursor: 'pointer', fontWeight: 600 }}
                >
                  Gallery
                </button>
                <button
                  type="button"
                  onClick={() => navigateAwayFromStudio('/drafts')}
                  style={{ border: 0, background: 'transparent', font: 'inherit', color: '#7f776d', padding: 0, cursor: 'pointer', fontWeight: 600 }}
                >
                  Your Studio
                </button>
                <span style={{ color: '#3f382f', fontWeight: 700 }}>Active Canvas</span>
              </div>
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: isMobile ? 8 : 12, alignItems: 'center', flexShrink: 0 }}>
          {session ? (
            <NavAccountControls
              user={user}
              isMobile={isMobile}
              onProfile={() => setShowProfileModal(true)}
              onLogout={() => setShowLogoutConfirm(true)}
            />
          ) : (
            <button type="button" onClick={() => setAuthPrompt('login')} style={{ border: 0, background: 'transparent', font: 'inherit', color: '#7f776d', cursor: 'pointer' }}>
              Log in
            </button>
          )}
        </div>
      </nav>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isMobile
            ? 'minmax(0, 1fr)'
            : isPreviewExpanded && activeWorkflowStep === 2
              ? 'minmax(0, 1fr) minmax(240px, 280px)'
              : isPreviewExpanded
                ? 'minmax(0, 1fr)'
                : activeWorkflowStep === 2
                  ? 'minmax(280px, 340px) minmax(0, 1fr) minmax(240px, 280px)'
                  : 'minmax(300px, 380px) minmax(0, 1fr)',
          gridTemplateRows: isMobile ? 'auto minmax(0, 1fr)' : undefined,
          minHeight: 0,
          overflow: 'hidden',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {!isPreviewExpanded && (
          <aside
          style={{
            display: 'grid',
            gridTemplateRows: 'auto minmax(0, 1fr) auto',
            borderRight: isMobile ? 'none' : '1px solid #e0d9cf',
            borderBottom: isMobile ? '1px solid #e0d9cf' : 'none',
            background: '#fffdf8',
            minWidth: 0,
            minHeight: 0,
            maxHeight: isMobile ? '44vh' : undefined,
            position: 'relative',
            zIndex: 30,
            pointerEvents: 'auto',
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', alignItems: 'center', borderBottom: '1px solid #eee8df' }}>
            {workflowSteps.map((step) => {
              const active = activeWorkflowStep === step.id
              const locked = Boolean(finalPdfPath) && step.id < 3
              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => { if (!locked) setActiveWorkflowStep(step.id) }}
                  disabled={locked}
                  style={{
                    display: 'grid',
                    gap: isMobile ? 4 : 8,
                    justifyItems: 'center',
                    border: 0,
                    background: 'transparent',
                    color: active ? '#3f382f' : '#8a8177',
                    fontWeight: active ? 700 : 600,
                    fontSize: 12,
                    cursor: locked ? 'default' : 'pointer',
                    opacity: locked ? 0.45 : 1,
                    padding: isMobile ? '8px 4px' : undefined,
                  }}
                >
                  <span
                    style={{
                      width: isMobile ? 26 : 34,
                      height: isMobile ? 26 : 34,
                      borderRadius: '50%',
                      display: 'grid',
                      placeItems: 'center',
                      background: step.complete ? '#dfe8dd' : active ? '#6e8d67' : '#ede9e2',
                      color: step.complete ? '#6e8d67' : active ? '#fff' : '#8a8177',
                      fontWeight: 800,
                      fontSize: isMobile ? 11 : undefined,
                    }}
                  >
                    {step.complete ? '✓' : step.id}
                  </span>
                  <span>{step.label}</span>
                </button>
              )
            })}
          </div>

          <div
            style={{
              display: 'grid',
              gap: activeWorkflowStep === 2 ? (isMobile ? 10 : 14) : isMobile ? 14 : 22,
              alignContent: 'start',
              padding: activeWorkflowStep === 2 ? (isMobile ? 12 : 18) : isMobile ? 14 : 24,
              minHeight: 0,
              overflow: 'auto',
            }}
          >
            {leftPanelContent}
          </div>
          <div style={{ padding: isMobile ? '10px 14px' : '12px 24px', borderTop: '1px solid #eee8df' }}>
            <button
              type="button"
              onClick={() => {
                if (!session?.access_token) {
                  setAuthPrompt('save')
                  return
                }
                void handleSaveDraft()
              }}
              disabled={(!activeImagePath && !isBlankCanvas) || saveStatus === 'saving'}
              style={{
                ...btnSecondary,
                width: '100%',
                opacity: (!activeImagePath && !isBlankCanvas) ? 0.5 : 1,
                fontSize: isMobile ? 12 : undefined,
              }}
            >
              {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved ✓' : saveStatus === 'limit' ? 'Limit reached' : saveStatus === 'error' ? 'Error saving' : 'Save Draft'}
            </button>
          </div>
        </aside>
        )}

        <section
          style={{
            display: 'grid',
            gridTemplateRows: 'auto minmax(0, 1fr) auto',
            minHeight: 0,
            minWidth: 0,
            overflow: 'hidden',
            background: '#ebe6dd',
            position: 'relative',
            zIndex: 0,
          }}
        >
          {previewToolbar}

          <div style={{ display: 'flex', minHeight: 0, overflow: 'hidden' }}>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              height: '100%',
              overflow: 'hidden',
              position: 'relative',
              padding: 12,
              boxSizing: 'border-box',
              zIndex: 0,
            }}
          >
            {cells.length > 0 && (
              <div
                style={{
                  position: shouldShowStitchGrid ? 'relative' : 'absolute',
                  inset: shouldShowStitchGrid ? undefined : 12,
                  width: '100%',
                  height: '100%',
                  visibility: shouldShowStitchGrid ? 'visible' : 'hidden',
                  pointerEvents: shouldShowStitchGrid ? 'auto' : 'none',
                }}
              >
                <GridEditor
                  cells={cells}
                  activeColor={shouldAllowCanvasEditing ? activePaintColor : null}
                  toolMode={toolMode}
                  meshCount={lastSettings?.mesh_count ?? 13}
                  brushDensity={brushDensity}
                  shapeType={shapeType}
                  arcFlipped={arcFlipped}
                  arcFullCircle={arcFullCircle}
                  shapeFillColor={shapeFillColor}
                  shapeBorderColor={shapeBorderColor}
                  shapeBorderSize={shapeBorderSize}
                  onSelectionChange={(selection) => {
                    const rects = selection ?? []
                    setSelectedRegions(rects)
                    if (rects.length > 0) {
                      const counts: Record<string, number> = {}
                      for (const rect of rects) {
                        const minRow = Math.max(0, Math.min(rect.startRow, rect.endRow))
                        const maxRow = Math.min(cells.length - 1, Math.max(rect.startRow, rect.endRow))
                        const minCol = Math.max(0, Math.min(rect.startCol, rect.endCol))
                        const maxCol = Math.min((cells[0]?.length ?? 1) - 1, Math.max(rect.startCol, rect.endCol))
                        for (let r = minRow; r <= maxRow; r++) {
                          for (let c = minCol; c <= maxCol; c++) {
                            const hex = cells[r]?.[c]
                            if (hex && hex !== BLANK_CELL) counts[hex] = (counts[hex] ?? 0) + 1
                          }
                        }
                      }
                      const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
                      if (dominant) setActivePaintColor(dominant)
                    }
                  }}
                  onDesignAreaMiss={() => { setActivePaintColor(null); setSelectedRegions([]) }}
                  onPaintStart={pushUndoSnapshot}
                  onPaintCells={toolMode === 'merge' ? handleMergeCells : handlePaintCells}
                  onApplyShapeCells={handleApplyShapeCells}
                />
              </div>
            )}

            <div
              style={{
                position: shouldShowStitchGrid ? 'absolute' : 'relative',
                inset: shouldShowStitchGrid ? 12 : undefined,
                width: '100%',
                height: '100%',
                visibility: shouldShowStitchGrid ? 'hidden' : 'visible',
                pointerEvents: shouldShowStitchGrid ? 'none' : 'auto',
              }}
            >
              <ImagePanel
                imageUrl={displayedImage ?? lastVisibleImageUrl}
                title={isPreviewExpanded ? '' : 'Original image'}
              />
            </div>

            {loading && hasGeneratedPreview && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(255, 253, 248, 0.6)',
                  zIndex: 10,
                  pointerEvents: 'none',
                  borderRadius: 8,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 8,
                    padding: '12px 20px',
                    background: 'rgba(255, 253, 248, 0.92)',
                    borderRadius: 10,
                    border: '1px solid #d9d0c5',
                    boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
                  }}
                >
                  <svg width="20" height="20" viewBox="0 0 20 20" style={{ animation: 'spin 1s linear infinite' }}>
                    <circle cx="10" cy="10" r="8" fill="none" stroke="#d9d0c5" strokeWidth="2.5" />
                    <path d="M10 2 A8 8 0 0 1 18 10" fill="none" stroke="#7a6e63" strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                  <span style={{ fontSize: 12, color: '#7a6e63', fontWeight: 500 }}>Regenerating…</span>
                </div>
              </div>
            )}
          </div>
          <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>

          {showColorBrowser && !isFinalizeReview && (
            <ColorBrowserModal
              mode={colorBrowserTarget === 'swap' ? 'swap' : 'add'}
              allColors={allDmcColors}
              paletteHexes={new Set(displayPalette.map((c) => c.hex))}
              swapFromColor={colorBrowserSwapFrom ?? undefined}
              onSelect={(color) => {
                if (colorBrowserTarget === 'swap' && colorBrowserSwapFrom) {
                  if (toolMode === 'select') {
                    handleApplyColorToSelection(color.hex)
                  } else {
                    setAllPalette((prev) =>
                      prev.some((c) => c.hex === color.hex)
                        ? prev.filter((c) => c.hex !== colorBrowserSwapFrom.hex)
                        : prev.map((c) => (c.hex === colorBrowserSwapFrom.hex ? color : c))
                    )
                    mergeColorsIntoTarget([colorBrowserSwapFrom.hex], color.hex)
                  }
                  setColorBrowserSwapFrom(null)
                  setShowColorBrowser(false)
                } else {
                  setActivePaintColor(color.hex)
                  setPreviewPalette((prev) =>
                    prev.some((c) => c.hex === color.hex) ? prev : [...prev, color]
                  )
                  if (colorBrowserTarget === 'fill') {
                    setShapeFillColor(color.hex)
                    setColorBrowserTarget('border')
                  } else if (colorBrowserTarget === 'border') {
                    setShapeBorderColor(color.hex)
                    setShowColorBrowser(false)
                  } else if (colorBrowserTarget !== 'add') {
                    setShowColorBrowser(false)
                  }
                }
              }}
              onClose={() => setShowColorBrowser(false)}
            />
          )}
          </div>

          {!isFinalizeReview && (
            <div
              style={{
                display: 'flex',
                gap: 8,
                flexWrap: 'wrap',
                justifyContent: 'center',
                padding: '10px 14px',
                borderTop: '1px solid #ded8cf',
                background: '#fffdf8',
                position: 'relative',
                zIndex: 35,
                pointerEvents: 'auto',
              }}
            >
              <button type="button" onClick={() => setViewMode('original')} style={btnSecondary}>Original</button>
              <button type="button" onClick={() => setViewMode('stitch')} disabled={!previewImagePath} style={btnSecondary}>
                Stitch preview
              </button>
              <button type="button" onClick={handleUndoColorChange} disabled={!undoStack.length} style={btnSecondary}>
                Undo
              </button>
              <button type="button" onClick={handleRedoColorChange} disabled={!redoStack.length} style={btnSecondary}>
                Redo
              </button>
              <button type="button" onClick={handleResetColorChanges} disabled={!originalCells.length} style={btnSecondary}>
                Reset
              </button>
            </div>
          )}
        </section>

        {!isMobile && activeWorkflowStep === 2 && !isFinalizeReview && (
          <aside
            style={{
              display: 'grid',
              gridTemplateRows: 'minmax(0, 1fr)',
              borderLeft: '1px solid #e0d9cf',
              background: '#fffdf8',
              minWidth: 0,
              minHeight: 0,
              overflow: 'hidden',
              padding: '14px 12px',
              boxSizing: 'border-box',
              position: 'relative',
              zIndex: 30,
              pointerEvents: 'auto',
            }}
          >
            <PalettePanel
              colors={displayPalette}
              activeDesignColors={currentDesignPalette}
              activeColor={activePaintColor}
              colorCountsByHex={displayColorCounts}
              toolMode={toolMode}
              onToolModeChange={(mode) => {
                setToolMode(mode)
                if (mode !== 'select') setSelectedRegions([])
                if (mode === 'select') setActivePaintColor(null)
              }}
              shapeType={shapeType}
              onShapeTypeChange={setShapeType}
              arcFlipped={arcFlipped}
              onArcFlippedChange={setArcFlipped}
              arcFullCircle={arcFullCircle}
              onArcFullCircleChange={setArcFullCircle}
              shapeFillColor={shapeFillColor}
              onShapeFillColorChange={setShapeFillColor}
              shapeBorderColor={shapeBorderColor}
              onShapeBorderColorChange={setShapeBorderColor}
              shapeBorderSize={shapeBorderSize}
              onShapeBorderSizeChange={setShapeBorderSize}
              brushDensity={brushDensity}
              onBrushDensityChange={setBrushDensity}
              hasSelectedRegion={selectedRegions.length > 0}
              selectedRegionCount={selectedRegionCount}
              selectionMergeSuggestions={selectionMergeSuggestions}

              onApplyColorToSelection={handleApplyColorToSelection}
              onClearSelection={handleClearSelection}
              onSelect={(color) => {
                setActivePaintColor(color.hex)
                if (toolMode !== 'select') {
                  setPreviewPalette((prev) =>
                    prev.some((c) => c.hex === color.hex) ? prev : [...prev, color]
                  )
                }
              }}
              onSelectBlankCanvas={() => setActivePaintColor(BLANK_CELL)}
              moreColors={allDmcColors.filter(
                (color) => !displayPalette.some((previewColor) => previewColor.hex === color.hex)
              )}
              onOpenAddBrowser={() => { setColorBrowserTarget('add'); setColorBrowserSwapFrom(null); setShowColorBrowser(true) }}
              onOpenSwapBrowser={(color) => { setColorBrowserTarget('swap'); setColorBrowserSwapFrom(color); setShowColorBrowser(true) }}
              onOpenFillBrowser={() => { setColorBrowserTarget('fill'); setColorBrowserSwapFrom(null); setShowColorBrowser(true) }}
              onOpenBorderBrowser={() => { setColorBrowserTarget('border'); setColorBrowserSwapFrom(null); setShowColorBrowser(true) }}
              onResetPalette={() => {
                const originalPalette = buildPaletteForCells(originalCells)
                setAllPalette(originalPalette)
                setPreviewPalette(originalPalette)
                setActivePaintColor(originalPalette[0]?.hex ?? null)
              }}
              onMergeColor={(color) => {
                const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)]
                const dist = (a: string, b: string) => { const [r1,g1,b1]=rgb(a),[r2,g2,b2]=rgb(b); return (r1-r2)**2+(g1-g2)**2+(b1-b2)**2 }
                const nearest = displayPalette
                  .filter((c) => c.hex !== color.hex)
                  .sort((a, b) => dist(color.hex, a.hex) - dist(color.hex, b.hex))[0]
                if (nearest) {
                  mergeColorsIntoTarget([color.hex], nearest.hex)
                  setAllPalette((prev) => prev.filter((c) => c.hex !== color.hex))
                  setActivePaintColor((current) => current === color.hex ? nearest.hex : current)
                }
              }}
              onMergeColorInSelection={(color) => {
                if (!selectedRegionBounds.length) return
                const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)]
                const dist = (a: string, b: string) => { const [r1,g1,b1]=rgb(a),[r2,g2,b2]=rgb(b); return (r1-r2)**2+(g1-g2)**2+(b1-b2)**2 }
                const nearest = displayPalette
                  .filter((c) => c.hex !== color.hex)
                  .sort((a, b) => dist(color.hex, a.hex) - dist(color.hex, b.hex))[0]
                if (!nearest) return
                pushUndoSnapshot()
                setCells((current) => {
                  const updated = current.map((row) => [...row])
                  selectedRegionBounds.forEach(({ top, bottom, left, right }) => {
                    for (let r = top; r <= bottom; r++) {
                      for (let c = left; c <= right; c++) {
                        if (updated[r]?.[c] === color.hex) updated[r][c] = nearest.hex
                      }
                    }
                  })
                  refreshPreviewPalette(updated)
                  return updated
                })
              }}
            />
          </aside>
        )}
      </div>

      {!isMobile && <section
        style={{
          borderTop: '1px solid #e0d9cf',
          background: '#fffdf8',
          height: showChatDrawer ? 440 : 64,
          display: 'grid',
          gridTemplateRows: '64px minmax(0, 1fr)',
          minHeight: 0,
          overflow: 'hidden',
          transition: 'height 160ms ease',
          position: 'relative',
          zIndex: 40,
          pointerEvents: 'auto',
        }}
      >
        <button
          type="button"
          disabled
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 24px',
            border: 0,
            background: 'transparent',
            textAlign: 'left',
            cursor: 'default',
            opacity: 0.5,
          }}
        >
          <span style={{ width: 36, height: 36, borderRadius: '50%', background: '#e5eee2', display: 'grid', placeItems: 'center', color: '#6e8d67', fontWeight: 800, fontSize: 22, lineHeight: 1 }}>
            ^
          </span>
          <span style={{ display: 'grid', gap: 2 }}>
            <strong style={{ letterSpacing: 1, color: '#8a8177', fontSize: 12 }}>HELP</strong>
            <span style={{ fontSize: 17 }}>Click to Expand Chat <span style={{ fontSize: 13, fontWeight: 400 }}>(Coming Soon)</span></span>
          </span>
        </button>

        {showChatDrawer && (
          <div style={{ minHeight: 0, overflow: 'hidden', padding: isMobile ? '0 12px 12px' : '0 20px 14px' }}>
            {chatPanel}
          </div>
        )}
      </section>}

      {authPrompt && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.35)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 80,
            padding: 18,
          }}
          onClick={() => setAuthPrompt(null)}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              display: 'grid',
              gap: 12,
              width: 'min(460px, 100%)',
            }}
          >
            <AuthPanel
              title={
                authPrompt === 'save'
                  ? 'Log in to save drafts'
                  : authPrompt === 'gallery'
                    ? 'Log in to post to gallery'
                    : authPrompt === 'finalize'
                      ? 'Log in to finalize'
                      : 'Log in to MNS Studio'
              }
              onSuccess={() => setAuthPrompt(null)}
            />
            <button
              type="button"
              onClick={() => setAuthPrompt(null)}
              style={{
                justifySelf: 'center',
                border: 0,
                background: 'transparent',
                color: '#fff',
                font: 'inherit',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {showLogoutConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.35)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 31,
            padding: 18,
          }}
          onClick={() => setShowLogoutConfirm(false)}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              background: '#fffdf8',
              padding: 24,
              borderRadius: 12,
              width: 360,
              maxWidth: '100%',
              display: 'grid',
              gap: 14,
              boxSizing: 'border-box',
            }}
          >
            <div style={{ display: 'grid', gap: 6 }}>
              <h2 style={{ margin: 0 }}>Log out?</h2>
              <p style={{ margin: 0, color: '#8a8177', fontSize: 14 }}>
                You will need to log back in to save drafts, finalize designs, or post to the gallery.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setShowLogoutConfirm(false)} style={btnSecondary}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleLogoutAndReturnToGallery()
                }}
                style={btnPrimary}
              >
                Log out
              </button>
            </div>
          </div>
        </div>
      )}

      {showPostFinalizeOptions && (() => {
        const designW = contentBounds?.width_inches ?? lastSettings?.width_inches ?? 0
        const designH = contentBounds?.height_inches ?? lastSettings?.height_inches ?? 0
        const canvas = lastSettings ? getCanvasForDesign(designW, designH) : null
        const printTotal = canvas ? 1500 + canvas.priceCents : null
        return (
          <div
            role="dialog"
            aria-modal="true"
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'grid', placeItems: 'center', zIndex: 25, padding: 18 }}
          >
            <div
              style={{ background: '#fffdf8', borderRadius: 12, width: 480, maxWidth: '100%', display: 'grid', gap: 0, boxSizing: 'border-box', overflow: 'hidden', border: '1px solid #e7e1d8' }}
            >
              <div style={{ padding: '22px 24px 16px', borderBottom: '1px solid #e7e1d8' }}>
                <h2 style={{ margin: 0, fontSize: 20 }}>Your design is ready</h2>
                <p style={{ margin: '6px 0 0', color: '#8a8177', fontSize: 14 }}>Choose what to do next — you can do both.</p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
                <div style={{ padding: '20px 20px 20px', borderRight: '1px solid #e7e1d8', display: 'grid', gap: 12, alignContent: 'start' }}>
                  <div>
                    <strong style={{ fontSize: 15 }}>Order a print</strong>
                    <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6f675f', lineHeight: 1.4 }}>
                      We'll print your canvas and ship it to you.
                    </p>
                  </div>
                  {canvas && printTotal !== null ? (
                    <div style={{ fontSize: 13, color: '#5f574f' }}>
                      <div>{canvas.label} canvas</div>
                      <div style={{ fontWeight: 700, fontSize: 16, marginTop: 4 }}>{formatCents(printTotal)}</div>
                    </div>
                  ) : (
                    <p style={{ margin: 0, fontSize: 12, color: '#b0453a' }}>No printable canvas size available.</p>
                  )}
                  {printCheckoutError && <p style={{ margin: 0, fontSize: 12, color: '#b0453a' }}>{printCheckoutError}</p>}
                  <button
                    type="button"
                    onClick={() => void handlePrintOwnCheckout()}
                    disabled={!canvas || printCheckoutLoading}
                    style={{ ...btnPrimary, opacity: !canvas ? 0.5 : 1, cursor: !canvas ? 'not-allowed' : 'pointer' }}
                  >
                    {printCheckoutLoading ? 'Redirecting...' : 'Order print'}
                  </button>
                </div>

                <div style={{ padding: '20px 20px 20px', display: 'grid', gap: 12, alignContent: 'start' }}>
                  <div>
                    <strong style={{ fontSize: 15 }}>Share to gallery</strong>
                    <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6f675f', lineHeight: 1.4 }}>
                      Let the MNS community see your work. If someone buys your design, earn $4.50 in canvas credit!
                    </p>
                  </div>
                  <div style={{ fontSize: 13, color: '#5f574f' }}>
                    <div>Visible to everyone</div>
                    <div style={{ fontWeight: 700, fontSize: 16, marginTop: 4 }}>Free</div>
                  </div>
                  <button
                    type="button"
                    onClick={openGalleryPublishModal}
                    style={btnSecondary}
                  >
                    Share to gallery
                  </button>
                </div>
              </div>

              <div style={{ padding: '14px 24px', borderTop: '1px solid #e7e1d8', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                {finalPdfPath && (
                  <a href={assetUrl(finalPdfPath) ?? '#'} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: '#8a8177', textDecoration: 'underline' }}>
                    Download PDF
                  </a>
                )}
                <button type="button" onClick={finishFinalizeFlow} style={{ ...btnSecondary, marginLeft: 'auto' }}>
                  Done
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {showGalleryPublishModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 25, padding: 18 }}
          onClick={skipGalleryPublish}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{ background: '#fffdf8', padding: 24, borderRadius: 12, width: 420, maxWidth: '100%', display: 'grid', gap: 14, boxSizing: 'border-box' }}
          >
            {galleryStep === 'form' ? (
              <>
                <div style={{ display: 'grid', gap: 6 }}>
                  <h2 style={{ margin: 0 }}>Share to gallery</h2>
                  <p style={{ margin: 0, color: '#8a8177', fontSize: 14 }}>Add a name and tags so others can find your design.</p>
                </div>
                <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 700 }}>
                  Piece name
                  <input
                    value={galleryTitle}
                    onChange={(event) => { setGalleryTitle(event.target.value); setGalleryStatus('idle'); setGalleryError('') }}
                    placeholder="Canvas name"
                    autoFocus
                    style={{ border: '1px solid #d7d0c8', borderRadius: 8, padding: '10px 12px', font: 'inherit', fontWeight: 400 }}
                  />
                </label>
                <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 700 }}>
                  Tags
                  <input
                    value={galleryTags}
                    onChange={(event) => { setGalleryTags(event.target.value); setGalleryError('') }}
                    placeholder="ornament, floral, beginner"
                    style={{ border: '1px solid #d7d0c8', borderRadius: 8, padding: '10px 12px', font: 'inherit', fontWeight: 400 }}
                  />
                </label>
                {galleryStatus === 'error' && <p style={{ margin: 0, color: '#b0453a', fontSize: 13 }}>{galleryError}</p>}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button type="button" onClick={skipGalleryPublish} style={btnSecondary}>Cancel</button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!galleryTitle.trim()) { setGalleryStatus('error'); setGalleryError('Add a piece name and try again.'); return }
                      setGalleryAcknowledged(false)
                      setGalleryStep('confirm')
                    }}
                    style={btnPrimary}
                  >
                    Review &amp; confirm
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'grid', gap: 6 }}>
                  <h2 style={{ margin: 0 }}>Content Responsibility</h2>
                  <p style={{ margin: 0, color: '#6f675f', fontSize: 14, lineHeight: 1.45 }}>
                    This studio is intended to be used as a way to create what you want. Users are entirely responsible for their own content; unauthorized use of copyrighted material will result in your design being taken down and further action being taken against your account. See terms and conditions for more information.
                  </p>
                </div>
                <div style={{ border: '1px solid #e7e1d8', borderRadius: 10, padding: 14, display: 'grid', gap: 6, background: '#f8f4ec' }}>
                  <strong style={{ fontSize: 16 }}>{galleryTitle}</strong>
                  {galleryTags && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {galleryTags.split(',').map((t) => t.trim()).filter(Boolean).map((tag) => (
                        <span key={tag} style={{ border: '1px solid #e1d9ce', borderRadius: 999, padding: '2px 8px', fontSize: 12, color: '#6f675f' }}>#{tag}</span>
                      ))}
                    </div>
                  )}
                  {lastSettings && (
                    <span style={{ fontSize: 12, color: '#8a8177' }}>
                      {(contentBounds?.width_inches ?? lastSettings.width_inches).toFixed(1)}" × {(contentBounds?.height_inches ?? lastSettings.height_inches).toFixed(1)}" · {lastSettings.mesh_count} mesh · {currentDesignPalette.length} colors{Object.keys(finishOutlineBackups).length > 0 ? ' · outline' : ''}
                    </span>
                  )}
                </div>
                <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: '#3f382f', lineHeight: 1.35 }}>
                  <input
                    type="checkbox"
                    checked={galleryAcknowledged}
                    onChange={(event) => {
                      setGalleryAcknowledged(event.target.checked)
                      setGalleryStatus('idle')
                      setGalleryError('')
                    }}
                  />
                  I acknowledge the above
                </label>
                {galleryStatus === 'error' && <p style={{ margin: 0, color: '#b0453a', fontSize: 13 }}>{galleryError}</p>}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button type="button" onClick={() => { setGalleryAcknowledged(false); setGalleryStep('form') }} disabled={galleryStatus === 'posting'} style={btnSecondary}>Edit</button>
                  <button
                    type="button"
                    onClick={() => void handlePublishGalleryItem()}
                    disabled={galleryStatus === 'posting' || !galleryAcknowledged}
                    style={{
                      ...btnPrimary,
                      opacity: galleryStatus === 'posting' || !galleryAcknowledged ? 0.55 : 1,
                      cursor: galleryStatus === 'posting' || !galleryAcknowledged ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {galleryStatus === 'posting' ? 'Posting...' : 'Confirm & share'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showDraftNameModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.35)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 20,
          }}
        >
          <div
            style={{
              background: '#fffdf8',
              padding: 24,
              borderRadius: 12,
              width: 380,
              maxWidth: 'calc(100vw - 32px)',
              display: 'grid',
              gap: 14,
              boxSizing: 'border-box',
            }}
          >
            <div style={{ display: 'grid', gap: 6 }}>
              <h2 style={{ margin: 0 }}>Draft saved</h2>
              <p style={{ margin: 0, color: '#8a8177', fontSize: 14 }}>
                Name your design
              </p>
            </div>
            <input
              value={draftName}
              onChange={(event) => {
                setDraftName(event.target.value)
                setDraftSaveError('')
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleSaveDraft()
              }}
              placeholder="Draft name"
              autoFocus
              style={{
                width: '100%',
                boxSizing: 'border-box',
                border: '1px solid #d7d0c8',
                borderRadius: 8,
                padding: '11px 12px',
                fontFamily: 'inherit',
                fontSize: 15,
                color: '#3f382f',
              }}
            />
            {draftSaveError && (
              <p style={{ margin: 0, color: '#b0453a', fontSize: 13, lineHeight: 1.35 }}>
                {draftSaveError}
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setShowDraftNameModal(false)} style={btnSecondary}>
                Skip
              </button>
              <button type="button" onClick={() => void handleSaveDraft()} disabled={saveStatus === 'saving'} style={btnPrimary}>
                {saveStatus === 'saving' ? 'Saving...' : 'Save name'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showFinalizeModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.35)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 100,
          }}
        >
          <div
            style={{
              background: '#fffdf8',
              padding: 24,
              borderRadius: 12,
              width: 360,
              display: 'grid',
              gap: 16,
            }}
          >
            <h2 style={{ margin: 0 }}>Finalize & Export PDF</h2>
            <p style={{ margin: 0 }}>
              This will generate your finalized two-page PDF report.
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
                {`${(contentBounds?.width_inches ?? lastSettings?.width_inches ?? 0).toFixed(1)}" x ${(contentBounds?.height_inches ?? lastSettings?.height_inches ?? 0).toFixed(1)}"`}
              </div>
              <div>
                <strong>Mesh:</strong> {lastSettings?.mesh_count ?? 0}
              </div>
              <div>
                <strong>Colors used:</strong> {currentDesignPalette.length}
              </div>
              <div>
                <strong>Total stitches:</strong> {currentDesignStitchCount.toLocaleString()}
              </div>
              <div>
                <strong>Est. total skeins:</strong>{' '}
                {currentDesignPalette.reduce(
                  (sum, color) => sum + estimateSkeins(currentDesignColorCounts[color.hex] ?? 0, lastSettings?.mesh_count ?? draftSettings.mesh_count),
                  0
                )}
                <span style={{ fontSize: 12, color: '#888', marginLeft: 6 }}>
                  ({lastSettings?.mesh_count ?? draftSettings.mesh_count}-mesh estimate)
                </span>
              </div>
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#4a4540' }}>Design name</label>
              <input
                type="text"
                value={draftName === 'Untitled' ? '' : draftName}
                placeholder="e.g. Autumn Garden"
                onChange={e => setDraftName(e.target.value || 'Untitled')}
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: '1px solid #d7d0c8',
                  fontSize: 14,
                  outline: 'none',
                  width: '100%',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            {hasPendingPreviewSettings && (
              <p style={{ margin: 0, color: '#8a5a00', fontSize: 14 }}>
                There are unapplied settings changes. Wait for the preview to refresh before finalizing.
              </p>
            )}
            {finalizeError && (
              <p style={{ margin: 0, color: '#b00020', fontSize: 14 }}>
                {finalizeError}
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowFinalizeModal(false)} style={btnSecondary}>Cancel</button>
              <button onClick={() => void handleFinalize(null)} disabled={loading || !cells.length || hasPendingPreviewSettings} style={btnPrimary}>
                Confirm and generate PDF
              </button>
            </div>
          </div>
        </div>
      )}
      {showRefinalizeConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'grid', placeItems: 'center', zIndex: 100, padding: 18 }}
        >
          <div style={{ background: '#fffdf8', borderRadius: 12, width: 420, maxWidth: '100%', display: 'grid', gap: 16, padding: '24px', boxSizing: 'border-box', border: '1px solid #e7e1d8' }}>
            <div style={{ display: 'grid', gap: 6 }}>
              <h2 style={{ margin: 0, fontSize: 20 }}>Regenerate PDF?</h2>
              <p style={{ margin: 0, color: '#6f675f', fontSize: 14, lineHeight: 1.5 }}>
                This will replace your existing PDF report with an updated version.
                {galleryItemId && ' Your gallery post will also be updated to reflect the new design.'}
              </p>
            </div>
            {finalizeError && <p style={{ margin: 0, color: '#b00020', fontSize: 13 }}>{finalizeError}</p>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => { setShowRefinalizeConfirm(false); setFinalizeError('') }}
                style={btnSecondary}
                disabled={loading}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleFinalize(finalPdfPath)}
                disabled={loading || !cells.length || hasPendingPreviewSettings}
                style={btnPrimary}
              >
                {loading ? 'Generating...' : 'Regenerate PDF'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showProfileModal && <ProfileModal onClose={() => setShowProfileModal(false)} />}
    </main>
  )
}

export default function HomePage() {
  return (
    <Suspense>
      <StudioPage />
    </Suspense>
  )
}
