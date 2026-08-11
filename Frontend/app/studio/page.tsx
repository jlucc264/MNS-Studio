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
import { SignaturePad } from '../../components/SignaturePad'
import { SignatureGridEditor } from '../../components/SignatureGridEditor'
import GridEditor, { computeShapeCells, type DesignSelectionRect } from '../../components/GridEditor'
import { getTextCells, ensureFontLoaded, type FontFamily, type TextOrientation } from '../../lib/bitmapFonts'
import ImagePanel from '../../components/ImagePanel'
import PalettePanel from '../../components/PalettePanel'
import { ColorBrowserModal } from '../../components/ColorBrowserModal'
import CheckoutModal from '../../components/CheckoutModal'
import CartDrawer from '../../components/CartDrawer'
import OrderConfirmationModal from '../../components/OrderConfirmationModal'
import MobileSheet from '../../components/MobileSheet'
import PreviewControls, { PreviewSettings } from '../../components/PreviewControls'
import BeltControls from '../../components/BeltControls'
import { AuthPanel } from '../../components/AuthPanel'
import { userDisplayName } from '../../components/UserAvatar'
import { NavAccountControls } from '../../components/NavAccountControls'
import { StudioTutorial, useTutorial } from '../../components/StudioTutorial'
import { useAuth } from '../../components/AuthProvider'
import { cartAdd, cartClear, useCart } from '../../lib/cart'
import { useCanvasCredit } from '../../lib/useCanvasCredit'
import { BREAKPOINTS, useIsMobile, useIsTouch, useIsPhoneDevice, useIsLandscape } from '../../lib/useViewport'
import {
  assetUrl,
  CanvasContext,
  ChatActionItem,
  chatAssistant,
  createPreview,
  createPrintOwnCheckout,
  fetchDmcColors,
  fetchGalleryItemByProject,
  finalizePreview,
  formatCents,
  getCanvasForDesign,
  printOwnTotalCents,
  printGalleryTotalCents,
  getMyCreatorProfile,
  getMySignature,
  getProjectSku,
  saveProjectSku,
  getProject,
  listProjects,
  type Project,
  gridRender,
  isDesignPrintable,
  isStandardOrder,
  LARGE_PRINT_MESSAGE,
  samplePixel,
  PaletteColor,
  publishGalleryItem,
  saveProject,
  updateGalleryItem,
  updateProject,
  uploadImage,
  importPatternImage,
  importStitchlyFile,
  ImportPatternError,
  type ImportPatternResponse,
  MAX_PRINTABLE_LONG_SIDE,
  MAX_PRINTABLE_SHORT_SIDE,
  BELT_HEIGHT_INCHES,
  BELT_MESH_COUNT,
  BELT_MIN_LENGTH_IN,
  BELT_MAX_LENGTH_IN,
  BELT_PANT_SIZES,
  beltLengthForPantSize,
  isBeltDesign,
} from '../../lib/api'

type ColorEditSnapshot = {
  cells: string[][]
  enabledColorHexes: string[]
  previewPalette: PaletteColor[]
  activePaintColor: string | null
  removalMode: 'fill' | 'blank'
  manualCellOverrides: Record<string, string>
  finishOutlineBackups: Record<string, string>
  finishApplied: boolean
  paletteReductionTarget: number
  manuallyDisabledHexes: string[]
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
const BLANK_CELL = '__BLANK__'
const FINISH_OUTLINE_CELL = '__FINISH_OUTLINE__'

// Mirrors the backend's crop_to_content (pdf_generator.py) — a saved
// project's stored grid can include blank margin around the design, which
// would otherwise turn into a big blank bounding box when imported as a
// stamp.
function cropCellsToContent(cells: string[][]): string[][] {
  if (!cells.length || !cells[0]?.length) return cells
  let minR = cells.length
  let maxR = -1
  let minC = cells[0].length
  let maxC = -1
  cells.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (cell === BLANK_CELL) return
      if (r < minR) minR = r
      if (r > maxR) maxR = r
      if (c < minC) minC = c
      if (c > maxC) maxC = c
    })
  })
  if (maxR < 0) return cells
  return cells.slice(minR, maxR + 1).map((row) => row.slice(minC, maxC + 1))
}

function estimateSkeins(stitchCount: number, meshCount: number): number {
  const stitchesPerSkein = meshCount >= 18 ? 1750 : 1250
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

function derivePaletteFromCells(
  cells: string[][],
  knownColors: PaletteColor[],
): PaletteColor[] {
  const usedHexes = new Set(
    cells.flat().filter((cell) => cell !== BLANK_CELL && cell !== FINISH_OUTLINE_CELL)
  )
  const byHex = new Map<string, PaletteColor>()
  knownColors.forEach((color) => byHex.set(color.hex, color))
  return Array.from(usedHexes)
    .map((hex) => byHex.get(hex))
    .filter((color): color is PaletteColor => Boolean(color))
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

// Belt canvases are a long, fixed-height strip — clamp only the length and
// pin height/mesh, instead of the free-form photo/blank-canvas box above.
function clampBeltDimensions(w: number, h: number): { width_inches: number; height_inches: number } {
  const length = Math.max(w, h)
  const clamped = Math.max(BELT_MIN_LENGTH_IN, Math.min(length, BELT_MAX_LENGTH_IN))
  return { width_inches: Number(clamped.toFixed(2)), height_inches: BELT_HEIGHT_INCHES }
}

const DEFAULT_BELT_PANT_SIZE = 34

const DEFAULT_SETTINGS: PreviewSettings = {
  width_inches: 4,
  height_inches: 4,
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

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizePreviewSettings(
  settings: PreviewSettings,
  fallback: PreviewSettings = DEFAULT_SETTINGS,
): PreviewSettings {
  const fallbackWidth = toFiniteNumber(fallback.width_inches)
  const fallbackHeight = toFiniteNumber(fallback.height_inches)
  const requestedWidth = toFiniteNumber(settings.width_inches)
  const requestedHeight = toFiniteNumber(settings.height_inches)
  const width = requestedWidth !== null && requestedWidth > 0
    ? requestedWidth
    : (fallbackWidth !== null && fallbackWidth > 0 ? fallbackWidth : DEFAULT_SETTINGS.width_inches)
  const height = requestedHeight !== null && requestedHeight > 0
    ? requestedHeight
    : (fallbackHeight !== null && fallbackHeight > 0 ? fallbackHeight : DEFAULT_SETTINGS.height_inches)
  // A belt-shaped fallback (the design being edited) means this patch is
  // still editing a belt — use the belt clamp/mesh instead of the generic
  // photo/blank-canvas box. Keyed off the fallback, not the requested value,
  // so an odd thin photo-import height never gets misread as a belt.
  const wasBelt = isBeltDesign(
    fallbackWidth !== null && fallbackWidth > 0 ? fallbackWidth : DEFAULT_SETTINGS.width_inches,
    fallbackHeight !== null && fallbackHeight > 0 ? fallbackHeight : DEFAULT_SETTINGS.height_inches,
  )
  const dimensions = wasBelt ? clampBeltDimensions(width, height) : clampPrintDimensions(width, height)

  const requestedMesh = toFiniteNumber(settings.mesh_count)
  const fallbackMesh = toFiniteNumber(fallback.mesh_count)
  const meshCount = wasBelt
    ? BELT_MESH_COUNT
    : requestedMesh === 13 || requestedMesh === 18
      ? requestedMesh
      : (fallbackMesh === 13 || fallbackMesh === 18 ? fallbackMesh : DEFAULT_SETTINGS.mesh_count)

  const requestedColorCount = toFiniteNumber(settings.color_count)
  const fallbackColorCount = toFiniteNumber(fallback.color_count)
  const colorCount = Math.max(
    2,
    Math.min(128, Math.round(requestedColorCount ?? fallbackColorCount ?? DEFAULT_SETTINGS.color_count)),
  )

  return {
    ...settings,
    ...dimensions,
    mesh_count: meshCount,
    color_count: colorCount,
  }
}

const ACTIVE_DESIGN_STORAGE_KEY = 'mns_active_design'
const ACTIVE_DESIGN_VERSION = 2

type ActiveDesignSnapshot = {
  version?: number
  savedAt?: string
  ownerId?: string | null
  activeImagePath?: string | null
  previewImagePath?: string | null
  originalPreviewImagePath?: string | null
  lastVisibleImageUrl?: string | null
  allPalette?: PaletteColor[]
  previewPalette?: PaletteColor[]
  enabledColorHexes?: string[]
  cells?: string[][]
  originalCells?: string[][]
  manualCellOverrides?: Record<string, string>
  finishOutlineBackups?: Record<string, string>
  draftSettings?: PreviewSettings
  lastSettings?: PreviewSettings | null
  savedProjectId?: string | null
  draftName?: string
  hasGeneratedPreview?: boolean
  viewMode?: 'original' | 'stitch'
  activeWorkflowStep?: 1 | 2 | 3
  importedAspectRatio?: number | null
  finalPdfPath?: string | null
  finalPreviewImagePath?: string | null
  parentGalleryItemId?: string | null
  paletteReductionTarget?: number
  manuallyDisabledHexes?: string[]
  removalMode?: 'fill' | 'blank'
  finishApplied?: boolean
  finishShape?: 'circle' | 'square'
  finishSizeInches?: number
  lockAspectRatio?: boolean
  isBeltCanvas?: boolean
}

type PendingStudioNavigation =
  | { kind: 'route'; href: string }
  | { kind: 'history-back' }

function readActiveDesignSnapshot(): ActiveDesignSnapshot | null {
  try {
    const raw = window.localStorage.getItem(ACTIVE_DESIGN_STORAGE_KEY)
    if (!raw) return null

    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null

    const snapshot = parsed as ActiveDesignSnapshot
    const hasCells = Array.isArray(snapshot.cells) && snapshot.cells.length > 0
    if (!snapshot.activeImagePath && !snapshot.previewImagePath && !hasCells) return null
    return snapshot
  } catch {
    return null
  }
}

function removeActiveDesignSnapshot() {
  try {
    window.localStorage.removeItem(ACTIVE_DESIGN_STORAGE_KEY)
  } catch {}
}

// Separate from ACTIVE_DESIGN_STORAGE_KEY, which is reserved for recovering
// work an interrupted session left behind. A gallery template the user just
// chose to open is not "unsaved work to recover" — it must load silently,
// without the recovery-prompt modal.
const PENDING_TEMPLATE_STORAGE_KEY = 'mns_pending_template'

function readPendingTemplateSnapshot(): ActiveDesignSnapshot | null {
  try {
    const raw = window.localStorage.getItem(PENDING_TEMPLATE_STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as ActiveDesignSnapshot
  } catch {
    return null
  }
}

function removePendingTemplateSnapshot() {
  try {
    window.localStorage.removeItem(PENDING_TEMPLATE_STORAGE_KEY)
  } catch {}
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
  const tutorial = useTutorial()
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null)
  // SKU spot: same mechanics as the signature above (dual image/grid asset,
  // same editor components), but per-project instead of per-creator — a SKU
  // identifies a specific print job, not a person.
  const [skuUrl, setSkuUrl] = useState<string | null>(null)
  const [savingSku, setSavingSku] = useState(false)
  const [skuError, setSkuError] = useState('')
  const [redrawingSku, setRedrawingSku] = useState(false)
  const [skuMode, setSkuMode] = useState<'draw' | 'pixel'>('draw')
  const [activeImagePath, setActiveImagePath] = useState<string | null>(null)
  const [importedAspectRatio, setImportedAspectRatio] = useState<number | null>(null)
  const [lockAspectRatio, setLockAspectRatio] = useState(true)
  // Explicit rather than derived from geometry: PreviewControls allows a
  // legitimate photo-import height down to 1", which would otherwise pass
  // isBeltDesign's own short-side check and misfire the belt settings panel.
  const [isBeltCanvas, setIsBeltCanvas] = useState(false)
  // Step-1 sub-screen: "Design a belt" no longer creates a canvas directly —
  // it swaps the Upload step into a belt-scoped version of the same
  // blank-vs-import choice, so a photo can become a belt too.
  const [beltEntryMode, setBeltEntryMode] = useState(false)
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
  const [gridKey, setGridKey] = useState(0)
  const [toolMode, setToolMode] = useState<'paint' | 'select' | 'shape' | 'merge' | 'text' | 'eyedropper' | 'fill'>('paint')
  const [textFontSize, setTextFontSize] = useState<'small' | 'medium' | 'large'>('medium')
  const [textFontFamily, setTextFontFamily] = useState<FontFamily>('sans')
  const [textOrientation, setTextOrientation] = useState<TextOrientation>('horizontal')
  // Raster families must finish loading before they're active — an unloaded
  // font renders nothing (never a substituted fallback), so switch after.
  const handleTextFontFamilyChange = useCallback((family: FontFamily) => {
    void ensureFontLoaded(family)
      .catch(() => {}) // offline/failed load: switch anyway; preview is empty rather than wrong-font
      .then(() => setTextFontFamily(family))
  }, [])
  const [textBold, setTextBold] = useState(false)
  const [textItalic, setTextItalic] = useState(false)
  const [textOutline, setTextOutline] = useState(false)
  const [shapeType, setShapeType] = useState<'box' | 'semicircle' | 'line'>('box')
  const [arcFlipped, setArcFlipped] = useState(false)
  const [arcFullCircle, setArcFullCircle] = useState(false)
  const [shapeFillColor, setShapeFillColor] = useState<string | null>(null)
  const [shapeBorderColor, setShapeBorderColor] = useState<string | null>(null)
  const [shapeBorderSize, setShapeBorderSize] = useState(1)
  const [brushDensity, setBrushDensity] = useState(1)
  const [selectedRegions, setSelectedRegions] = useState<DesignSelectionRect[]>([])
  const [clearSelectionSignal, setClearSelectionSignal] = useState(0)
  const [placeTextSignal, setPlaceTextSignal] = useState(0)
  const [cancelTextSignal, setCancelTextSignal] = useState(0)
  const [hasActiveTextBox, setHasActiveTextBox] = useState(false)
  const [settingsGuardAccepted, setSettingsGuardAccepted] = useState(false)
  const [showSettingsGuardModal, setShowSettingsGuardModal] = useState(false)
  const [stampClipboard, setStampClipboard] = useState<(string | null)[][] | null>(null)
  const [showImportProjectPicker, setShowImportProjectPicker] = useState(false)
  const [importableProjects, setImportableProjects] = useState<Project[] | null>(null)
  const [importProjectsLoading, setImportProjectsLoading] = useState(false)
  const [importProjectsError, setImportProjectsError] = useState('')
  const [floatingStamp, setFloatingStamp] = useState<{
    cells: (string | null)[][]
    anchorRow: number
    anchorCol: number
  } | null>(null)
  // Cut blanks the source cells immediately so the stamp can be dragged
  // around; cancelling it needs to undo that deletion, not just drop the
  // stamp, or the source region stays blank. Copy/paste never touch cells,
  // so cancelling those is already a no-op.
  const stampCameFromCutRef = useRef(false)
  const [manualCellOverrides, setManualCellOverrides] = useState<Record<string, string>>({})
  const [finishOutlineBackups, setFinishOutlineBackups] = useState<Record<string, string>>({})
  const [finishApplied, setFinishApplied] = useState(false)
  const [loading, setLoading] = useState(false)
  const [isGridRendering, setIsGridRendering] = useState(false)
  const [showFinalizeModal, setShowFinalizeModal] = useState(false)
  const [finalizeError, setFinalizeError] = useState('')
  const [finalPdfPath, setFinalPdfPath] = useState<string | null>(null)
  const [internalPdfSupabasePath, setInternalPdfSupabasePath] = useState<string | null>(null)
  const [finalPreviewImagePath, setFinalPreviewImagePath] = useState<string | null>(null)
  const [lastSettings, setLastSettings] = useState<PreviewSettings | null>(null)
  const [draftSettings, setDraftSettings] = useState<PreviewSettings>(DEFAULT_SETTINGS)
  const draftSettingsRef = useRef<PreviewSettings>(DEFAULT_SETTINGS)
  draftSettingsRef.current = draftSettings
  const [paletteReductionTarget, setPaletteReductionTarget] = useState(128)
  const [manuallyDisabledHexes, setManuallyDisabledHexes] = useState<string[]>([])
  const [finishShape, setFinishShape] = useState<'circle' | 'square'>('circle')
  const [finishSizeInches, setFinishSizeInches] = useState(4)
  const [hasGeneratedPreview, setHasGeneratedPreview] = useState(false)
  const isMobile = useIsMobile(BREAKPOINTS.studio)
  const isTouchDevice = useIsTouch()
  const isPhoneDevice = useIsPhoneDevice()
  const isLandscapeOrientation = useIsLandscape()
  const [activeWorkflowStep, setActiveWorkflowStep] = useState<1 | 2 | 3>(1)
  const isPhoneCanvasLandscape = isPhoneDevice && isLandscapeOrientation && activeWorkflowStep === 2
  const [showChatPanel, setShowChatPanel] = useState(false)
  const [stagedUploadDragActive, setStagedUploadDragActive] = useState(false)
  const [uploadTipsOpen, setUploadTipsOpen] = useState(false)
  const [savedProjectId, setSavedProjectId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('Untitled')
  const [showDraftNameModal, setShowDraftNameModal] = useState(false)
  const [authPrompt, setAuthPrompt] = useState<'login' | 'save' | 'finalize' | 'gallery' | null>(null)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [recoveryCandidate, setRecoveryCandidate] = useState<ActiveDesignSnapshot | null>(null)
  const [showLeaveStudioConfirm, setShowLeaveStudioConfirm] = useState(false)
  const [isDesignReady, setIsDesignReady] = useState(false)
  const [cleanDesignFingerprint, setCleanDesignFingerprint] = useState<string | null>(null)
  const [cleanCheckpoint, setCleanCheckpoint] = useState(0)
  const [showMobilePanel, setShowMobilePanel] = useState(true)
  const [mobileSheetTab, setMobileSheetTab] = useState<'tools' | 'design'>('tools')
  const [showPostFinalizeOptions, setShowPostFinalizeOptions] = useState(false)
  const [showPriceBreakdownModal, setShowPriceBreakdownModal] = useState(false)
  const [showCartDrawer, setShowCartDrawer] = useState(false)
  const [showOrderConfirmation, setShowOrderConfirmation] = useState(false)
  const [showGalleryPublishModal, setShowGalleryPublishModal] = useState(false)
  const { count: cartCount } = useCart()
  const pendingCents = useCanvasCredit(session?.access_token)
  const [showRefinalizeConfirm, setShowRefinalizeConfirm] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [galleryItemId, setGalleryItemId] = useState<string | null>(null)
  const [parentGalleryItemId, setParentGalleryItemId] = useState<string | null>(null)
  const [galleryStep, setGalleryStep] = useState<'form' | 'confirm'>('form')
  const [galleryTitle, setGalleryTitle] = useState('')
  const [galleryTags, setGalleryTags] = useState('')
  const [galleryAcknowledged, setGalleryAcknowledged] = useState(false)
  const [galleryStatus, setGalleryStatus] = useState<'idle' | 'posting' | 'posted' | 'error'>('idle')
  const [galleryError, setGalleryError] = useState('')
  const [traceOpacity, setTraceOpacity] = useState(0)
  const [printCheckoutLoading, setPrintCheckoutLoading] = useState(false)
  const [printCheckoutError, setPrintCheckoutError] = useState('')
  const [checkoutClientSecret, setCheckoutClientSecret] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error' | 'limit'>('idle')
  const [dimensionLimitHit, setDimensionLimitHit] = useState(false)
  const [draftSaveError, setDraftSaveError] = useState('')
  const [showColorBrowser, setShowColorBrowser] = useState(false)
  const [colorBrowserTarget, setColorBrowserTarget] = useState<'add' | 'swap' | 'fill' | 'border'>('add')

  // On mobile the color browser overlay renders inside the canvas section,
  // behind the fixed-position, higher-z-index Tools & Colors sheet — so it's
  // invisible unless the sheet is closed first. Route every open/close through
  // these so the sheet and browser never fight for the screen.
  function openColorBrowser() {
    if (isMobile) setShowMobilePanel(false)
    setShowColorBrowser(true)
  }
  function closeColorBrowser() {
    setShowColorBrowser(false)
    if (isMobile) setShowMobilePanel(true)
  }
  const [, startPaletteTransition] = useTransition()
  const deferredCells = useDeferredValue(cells)
  const latestApplyRequestIdRef = useRef(0)
  const stagedUploadInputRef = useRef<HTMLInputElement | null>(null)
  const patternImportInputRef = useRef<HTMLInputElement | null>(null)
  const recoveryCheckedRef = useRef(false)
  const loadedProjectIdRef = useRef<string | null>(null)
  const toolModeRef = useRef(toolMode)
  const pendingStudioNavigationRef = useRef<PendingStudioNavigation | null>(null)
  const allowStudioNavigationRef = useRef(false)
  const hasUnsavedChangesRef = useRef(false)
  const latestRecoverySnapshotRef = useRef<ActiveDesignSnapshot | null>(null)
  const persistRecoverySnapshotRef = useRef<() => void>(() => {})
  useEffect(() => { toolModeRef.current = toolMode }, [toolMode])
  const searchParams = useSearchParams()

  const clearActiveCanvas = useCallback(() => {
    removeActiveDesignSnapshot()
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
    setIsBeltCanvas(false)
    setPaletteReductionTarget(128)
    setFinishShape('circle')
    setFinishSizeInches(4)
    setHasGeneratedPreview(false)
    setActiveWorkflowStep(1)
    setBeltEntryMode(false)
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
    setRecoveryCandidate(null)
    setShowLeaveStudioConfirm(false)
    setCleanDesignFingerprint(null)
    setIsDesignReady(true)
  }, [])

  const finishFinalizeFlow = useCallback(() => {
    allowStudioNavigationRef.current = true
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
    allowStudioNavigationRef.current = true
    clearActiveCanvas()
    await signOut()
    router.push('/gallery')
  }, [clearActiveCanvas, router, signOut])

  const closeStudioNavigationModals = useCallback(() => {
    setAuthPrompt(null)
    setShowLogoutConfirm(false)
    setShowDraftNameModal(false)
    setShowFinalizeModal(false)
    setShowGalleryPublishModal(false)
    setShowCartDrawer(false)
  }, [])

  const performStudioNavigation = useCallback((href: string) => {
    const destination = new URL(href, window.location.href)
    if (destination.origin !== window.location.origin || (destination.pathname === '/studio' && destination.search)) {
      window.location.assign(destination.href)
      return
    }
    router.push(`${destination.pathname}${destination.search}${destination.hash}`)
  }, [router])

  const navigateAwayFromStudio = useCallback((href: string) => {
    if (hasUnsavedChangesRef.current) {
      persistRecoverySnapshotRef.current()
      pendingStudioNavigationRef.current = { kind: 'route', href }
      setShowLeaveStudioConfirm(true)
      return
    }

    allowStudioNavigationRef.current = true
    closeStudioNavigationModals()
    performStudioNavigation(href)
  }, [closeStudioNavigationModals, performStudioNavigation])

  const stayOnActiveCanvas = useCallback(() => {
    pendingStudioNavigationRef.current = null
    setShowLeaveStudioConfirm(false)
  }, [])

  const leaveActiveCanvas = useCallback(() => {
    const pendingNavigation = pendingStudioNavigationRef.current
    pendingStudioNavigationRef.current = null
    setShowLeaveStudioConfirm(false)
    if (!pendingNavigation) return

    removeActiveDesignSnapshot()
    allowStudioNavigationRef.current = true
    closeStudioNavigationModals()

    if (pendingNavigation.kind === 'history-back') {
      window.history.go(-2)
      return
    }

    performStudioNavigation(pendingNavigation.href)
  }, [closeStudioNavigationModals, performStudioNavigation])

  async function handleViewProfile() {
    if (!session?.access_token) return
    try {
      const profile = await getMyCreatorProfile(session.access_token)
      navigateAwayFromStudio(profile.slug ? `/gallery/${profile.slug}` : '/gallery')
    } catch {
      navigateAwayFromStudio('/gallery')
    }
  }

  useEffect(() => {
    const handleLinkClick = (event: MouseEvent) => {
      if (!hasUnsavedChangesRef.current || event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      if (!(event.target instanceof Element)) return

      const link = event.target.closest('a[href]')
      if (!(link instanceof HTMLAnchorElement)) return
      if (link.target && link.target !== '_self') return
      if (link.hasAttribute('download') || link.getAttribute('href')?.startsWith('#')) return

      const destination = new URL(link.href, window.location.href)
      if (destination.href === window.location.href) return

      event.preventDefault()
      event.stopPropagation()
      navigateAwayFromStudio(destination.href)
    }

    document.addEventListener('click', handleLinkClick, true)
    return () => document.removeEventListener('click', handleLinkClick, true)
  }, [navigateAwayFromStudio])

  useEffect(() => {
    router.prefetch('/gallery')
    router.prefetch('/drafts')
  }, [router])

  useEffect(() => {
    if (!session?.access_token) { setSignatureUrl(null); return }
    getMySignature(session.access_token)
      .then((res) => setSignatureUrl(res.image_url))
      .catch(() => { /* non-critical */ })
  }, [session?.access_token])

  useEffect(() => {
    const projectId = savedProjectId ?? searchParams.get('project')
    // Clear immediately on every change (not just when there's no project) —
    // otherwise switching from a project with a SKU to one without (or a
    // different one) briefly shows the previous project's SKU. `cancelled`
    // additionally guards against an earlier fetch resolving after a later
    // one if project switches happen faster than the request round-trip.
    setSkuUrl(null)
    if (!session?.access_token || !projectId) return
    let cancelled = false
    getProjectSku(projectId, session.access_token)
      .then((res) => { if (!cancelled) setSkuUrl(res.image_url) })
      .catch(() => { /* non-critical */ })
    return () => { cancelled = true }
  }, [session?.access_token, savedProjectId, searchParams])

  async function handleSaveSku(blob: Blob, grid?: string[][]) {
    const projectId = savedProjectId ?? searchParams.get('project')
    if (!session?.access_token || !projectId) return
    setSavingSku(true)
    setSkuError('')
    try {
      const res = await saveProjectSku(projectId, blob, session.access_token, grid)
      setSkuUrl(res.image_url)
      setRedrawingSku(false)
    } catch (err) {
      setSkuError(err instanceof Error ? err.message : 'Could not save SKU.')
    } finally {
      setSavingSku(false)
    }
  }

  useEffect(() => {
    if (!hasGeneratedPreview) return
    if (toolMode === 'paint') {
      setColorBrowserTarget('add')
      openColorBrowser()
    } else if (toolMode === 'select' || toolMode === 'merge') {
      closeColorBrowser()
    }
  }, [toolMode, hasGeneratedPreview])

  const [showPortraitWarning, setShowPortraitWarning] = useState(false)
  useEffect(() => {
    const check = () => {
      const portrait = window.matchMedia('(orientation: portrait)').matches
      const narrow = window.innerWidth < 600
      const touch = navigator.maxTouchPoints > 0
      setShowPortraitWarning(portrait && narrow && touch)
    }
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  useEffect(() => {
    const scrollY = window.scrollY
    const body = document.body
    const root = document.documentElement
    const previousBody = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      height: body.style.height,
      overscrollBehavior: body.style.overscrollBehavior,
    }
    const previousRoot = {
      height: root.style.height,
      overscrollBehavior: root.style.overscrollBehavior,
    }

    root.style.height = '100%'
    root.style.overscrollBehavior = 'none'
    body.style.height = '100%'
    body.style.overflow = 'hidden'
    body.style.overscrollBehavior = 'none'
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.width = '100%'

    return () => {
      root.style.height = previousRoot.height
      root.style.overscrollBehavior = previousRoot.overscrollBehavior
      body.style.overflow = previousBody.overflow
      body.style.position = previousBody.position
      body.style.top = previousBody.top
      body.style.width = previousBody.width
      body.style.height = previousBody.height
      body.style.overscrollBehavior = previousBody.overscrollBehavior
      window.scrollTo(0, scrollY)
    }
  }, [])

  const hasActiveCanvas = Boolean(activeImagePath || previewImagePath || cells.length || hasGeneratedPreview)
  const designFingerprint = useMemo(() => JSON.stringify({
    activeImagePath,
    previewImagePath,
    previewPalette,
    cells,
    draftSettings,
    draftName,
    finalPdfPath,
    parentGalleryItemId,
  }), [
    activeImagePath,
    cells,
    draftName,
    draftSettings,
    finalPdfPath,
    parentGalleryItemId,
    previewImagePath,
    previewPalette,
  ])
  const latestDesignFingerprintRef = useRef(designFingerprint)
  latestDesignFingerprintRef.current = designFingerprint

  const hasUnsavedChanges = isDesignReady
    && hasActiveCanvas
    && (cleanDesignFingerprint === null || designFingerprint !== cleanDesignFingerprint)
  hasUnsavedChangesRef.current = hasUnsavedChanges

  const recoverySnapshot = useMemo<ActiveDesignSnapshot>(() => ({
    version: ACTIVE_DESIGN_VERSION,
    savedAt: new Date().toISOString(),
    ownerId: user?.id ?? null,
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
    finishOutlineBackups,
    draftSettings,
    lastSettings,
    savedProjectId,
    draftName,
    hasGeneratedPreview,
    viewMode,
    activeWorkflowStep,
    importedAspectRatio,
    finalPdfPath,
    finalPreviewImagePath,
    parentGalleryItemId,
    paletteReductionTarget,
    manuallyDisabledHexes,
    removalMode,
    finishApplied,
    finishShape,
    finishSizeInches,
    lockAspectRatio,
    isBeltCanvas,
  }), [
    activeImagePath,
    activeWorkflowStep,
    allPalette,
    cells,
    draftName,
    draftSettings,
    enabledColorHexes,
    finalPdfPath,
    finalPreviewImagePath,
    finishApplied,
    finishOutlineBackups,
    finishShape,
    finishSizeInches,
    hasGeneratedPreview,
    importedAspectRatio,
    isBeltCanvas,
    lastSettings,
    lastVisibleImageUrl,
    lockAspectRatio,
    manualCellOverrides,
    manuallyDisabledHexes,
    originalCells,
    originalPreviewImagePath,
    paletteReductionTarget,
    parentGalleryItemId,
    previewImagePath,
    previewPalette,
    removalMode,
    savedProjectId,
    user?.id,
    viewMode,
  ])
  latestRecoverySnapshotRef.current = recoverySnapshot

  const markCurrentDesignClean = useCallback(() => {
    setCleanCheckpoint((current) => current + 1)
  }, [])

  useEffect(() => {
    if (cleanCheckpoint === 0) return
    setCleanDesignFingerprint(latestDesignFingerprintRef.current)
    setIsDesignReady(true)
  }, [cleanCheckpoint])

  const persistRecoverySnapshot = useCallback(() => {
    if (allowStudioNavigationRef.current || !hasUnsavedChangesRef.current || !latestRecoverySnapshotRef.current) return
    try {
      window.localStorage.setItem(
        ACTIVE_DESIGN_STORAGE_KEY,
        JSON.stringify(latestRecoverySnapshotRef.current),
      )
    } catch {}
  }, [])
  persistRecoverySnapshotRef.current = persistRecoverySnapshot

  useEffect(() => {
    if (!isDesignReady) return
    if (!hasUnsavedChanges) {
      removeActiveDesignSnapshot()
      return
    }

    const timeoutId = window.setTimeout(persistRecoverySnapshot, 350)
    return () => window.clearTimeout(timeoutId)
  }, [hasUnsavedChanges, isDesignReady, persistRecoverySnapshot, recoverySnapshot])

  useEffect(() => {
    const handlePageHide = () => persistRecoverySnapshot()
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') persistRecoverySnapshot()
    }
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChangesRef.current || allowStudioNavigationRef.current) return
      persistRecoverySnapshot()
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('pagehide', handlePageHide)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('pagehide', handlePageHide)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [persistRecoverySnapshot])

  useEffect(() => {
    const guardState = window.history.state && typeof window.history.state === 'object'
      ? window.history.state as Record<string, unknown>
      : {}
    if (!guardState.mnsStudioGuard) {
      window.history.pushState(
        { ...guardState, mnsStudioGuard: true },
        '',
        window.location.href,
      )
    }

    const handleHistoryNavigation = () => {
      if (allowStudioNavigationRef.current) return
      if (!hasUnsavedChangesRef.current) {
        allowStudioNavigationRef.current = true
        window.history.back()
        return
      }

      persistRecoverySnapshot()
      const currentState = window.history.state && typeof window.history.state === 'object'
        ? window.history.state as Record<string, unknown>
        : {}
      window.history.pushState(
        { ...currentState, mnsStudioGuard: true },
        '',
        window.location.href,
      )
      pendingStudioNavigationRef.current = { kind: 'history-back' }
      setShowLeaveStudioConfirm(true)
    }

    window.addEventListener('popstate', handleHistoryNavigation)
    return () => window.removeEventListener('popstate', handleHistoryNavigation)
  }, [persistRecoverySnapshot])

  const applyDesignSnapshot = useCallback((snapshot: ActiveDesignSnapshot) => {
    const recoveredCells = Array.isArray(snapshot.cells) ? snapshot.cells : []
    const recoveredAllPalette = snapshot.allPalette?.length
      ? snapshot.allPalette
      : (snapshot.previewPalette ?? [])
    const knownColors = [...(snapshot.previewPalette ?? []), ...recoveredAllPalette]
    const activePalette = recoveredCells.length
      ? derivePaletteFromCells(recoveredCells, knownColors)
      : (snapshot.previewPalette ?? recoveredAllPalette)
    const resolvedPalette = activePalette.length
      ? activePalette
      : (snapshot.previewPalette ?? recoveredAllPalette)

    setActiveImagePath(snapshot.activeImagePath ?? null)
    setPreviewImagePath(snapshot.previewImagePath ?? null)
    setOriginalPreviewImagePath(snapshot.originalPreviewImagePath ?? snapshot.previewImagePath ?? null)
    setLastVisibleImageUrl(snapshot.lastVisibleImageUrl ?? snapshot.previewImagePath ?? null)
    setAllPalette(recoveredAllPalette)
    setPreviewPalette(resolvedPalette)
    setEnabledColorHexes(snapshot.enabledColorHexes ?? resolvedPalette.map((color) => color.hex))
    setCells(recoveredCells)
    setOriginalCells(snapshot.originalCells ?? recoveredCells)
    setActivePaintColor(resolvedPalette[0]?.hex ?? null)
    setManualCellOverrides(snapshot.manualCellOverrides ?? {})
    setFinishOutlineBackups(snapshot.finishOutlineBackups ?? {})
    setDraftSettings(snapshot.draftSettings ?? DEFAULT_SETTINGS)
    setLastSettings(snapshot.lastSettings ?? null)
    setSavedProjectId(snapshot.savedProjectId ?? null)
    setDraftName(snapshot.draftName || 'Untitled')
    setHasGeneratedPreview(Boolean(snapshot.hasGeneratedPreview || recoveredCells.length))
    setViewMode(snapshot.viewMode ?? (recoveredCells.length ? 'stitch' : 'original'))
    setActiveWorkflowStep(snapshot.activeWorkflowStep ?? (recoveredCells.length ? 2 : 1))
    setImportedAspectRatio(snapshot.importedAspectRatio ?? null)
    setFinalPdfPath(snapshot.finalPdfPath ?? null)
    setFinalPreviewImagePath(snapshot.finalPreviewImagePath ?? null)
    setParentGalleryItemId(snapshot.parentGalleryItemId ?? null)
    setPaletteReductionTarget(snapshot.paletteReductionTarget ?? 128)
    setManuallyDisabledHexes(snapshot.manuallyDisabledHexes ?? [])
    setRemovalMode(snapshot.removalMode ?? 'fill')
    setFinishApplied(snapshot.finishApplied ?? false)
    setFinishShape(snapshot.finishShape ?? 'circle')
    setFinishSizeInches(snapshot.finishSizeInches ?? 4)
    setLockAspectRatio(snapshot.lockAspectRatio ?? true)
    setIsBeltCanvas(snapshot.isBeltCanvas ?? false)
    setRecoveryCandidate(null)
    setCleanDesignFingerprint(null)
    setIsDesignReady(true)
    if (recoveredCells.length) {
      window.requestAnimationFrame(() => setGridKey((current) => current + 1))
    }
  }, [])

  const restoreRecoveredDesign = useCallback(() => {
    if (!recoveryCandidate) return
    applyDesignSnapshot(recoveryCandidate)
  }, [recoveryCandidate, applyDesignSnapshot])

  const discardRecoveredDesign = useCallback(() => {
    removeActiveDesignSnapshot()
    setRecoveryCandidate(null)
    markCurrentDesignClean()
  }, [markCurrentDesignClean])

  useEffect(() => {
    if (session?.access_token && authPrompt !== 'login') {
      setAuthPrompt(null)
    }
  }, [authPrompt, session?.access_token])

  useEffect(() => {
    const projectId = searchParams.get('project')

    if (!projectId) {
      if (recoveryCheckedRef.current) return
      recoveryCheckedRef.current = true

      const pendingTemplate = readPendingTemplateSnapshot()
      if (pendingTemplate) {
        removePendingTemplateSnapshot()
        applyDesignSnapshot(pendingTemplate)
        markCurrentDesignClean()
        return
      }

      const recoveredDesign = readActiveDesignSnapshot()
      if (recoveredDesign) {
        setRecoveryCandidate(recoveredDesign)
        return
      }
      markCurrentDesignClean()
      return
    }

    if (!session?.access_token || loadedProjectIdRef.current === projectId) return
    loadedProjectIdRef.current = projectId

    getProject(projectId, session.access_token).then((project) => {
      setSavedProjectId(project.id)
      setDraftName(project.name)

      const loadedPalette = project.palette ?? []
      const loadedCells = project.cells ?? []
      // Reset the working palette to the colors actually stitched into the
      // saved cells — not the original generated palette
      const activePalette = loadedCells.length
        ? derivePaletteFromCells(loadedCells, loadedPalette)
        : loadedPalette
      const resolvedPalette = activePalette.length ? activePalette : loadedPalette
      setAllPalette(loadedPalette)
      setPreviewPalette(resolvedPalette)
      setEnabledColorHexes(resolvedPalette.map((c) => c.hex))
      setActivePaintColor(resolvedPalette[0]?.hex ?? null)

      setCells(loadedCells)
      setOriginalCells(loadedCells)

      if (project.parent_gallery_item_id) setParentGalleryItemId(project.parent_gallery_item_id)
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
        setIsBeltCanvas(isBeltDesign(settings.width_inches, settings.height_inches))
        setImportedAspectRatio(settings.width_inches / settings.height_inches)
        setHasGeneratedPreview(true)
        setViewMode('stitch')
        setActiveWorkflowStep(project.pdf_url ? 3 : 2)
        window.requestAnimationFrame(() => setGridKey((k) => k + 1))
      }
      markCurrentDesignClean()
    }).catch(() => {
      // project load failed silently — user starts fresh
      markCurrentDesignClean()
    })
  }, [applyDesignSnapshot, markCurrentDesignClean, searchParams, session?.access_token])

  useEffect(() => {
    if (searchParams.get('order') === 'success') {
      cartClear()
      setShowOrderConfirmation(true)
      router.replace('/studio', { scroll: false })
    }
  }, [searchParams, router])


  useEffect(() => {
    if (isMobile) setShowMobilePanel(activeWorkflowStep !== 2)
  }, [isMobile, activeWorkflowStep])

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
  // A Stitchly/pattern import also has no activeImagePath (imported cells
  // are the source of truth, see applyImportedPattern) but already carries
  // real content, unlike a genuinely blank canvas with nothing stitched
  // into it yet. undoStack.length alone cannot tell these apart since an
  // import never goes through an undo-tracked edit on its own.
  const hasStitchedContent = useMemo(
    () => cells.some((row) => row.some((cell) => cell !== BLANK_CELL)),
    [cells]
  )
  // Resizing (width/height/orientation) rebuilds cells as a brand-new blank
  // grid (see the draftSettings effect below) — safe for a from-scratch
  // canvas with nothing painted yet, but would silently wipe an imported
  // pattern or already-painted design, both of which also satisfy the
  // broader isBlankCanvas check above. Only offer resize before any content
  // exists.
  const canResizeBlankCanvas = isBlankCanvas && !hasStitchedContent
  const isUnauthenticatedWithCanvas = !session && hasActiveCanvas
  const currentDesignPalette = useMemo(() => buildPaletteForCells(deferredCells), [allDmcColors, allPalette, deferredCells, previewPalette])
  // Tracks whichever swatch is currently active, not just whichever one the
  // "+" button was clicked on — so if you switch to a different color while
  // the drawer is still open, "Nearby colors" follows along instead of
  // staying pinned to the first color you opened it from.
  const colorBrowserSwapFrom = useMemo(() => {
    if (colorBrowserTarget !== 'swap' || !activePaintColor) return null
    if (activePaintColor === BLANK_CELL) {
      return { hex: BLANK_CELL, dmc_code: '—', dmc_name: 'Blank' }
    }
    return (
      displayPalette.find((c) => c.hex === activePaintColor) ??
      allDmcColors.find((c) => c.hex === activePaintColor) ??
      null
    )
  }, [colorBrowserTarget, activePaintColor, displayPalette, allDmcColors])
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
  const selectedRegionColors = useMemo(() => {
    if (!cells.length || !selectedRegionBounds.length) return []

    const counts = new Map<string, number>()
    let blankCount = 0
    selectedRegionBounds.forEach(({ top, bottom, left, right }) => {
      for (let row = top; row <= bottom; row += 1) {
        for (let col = left; col <= right; col += 1) {
          const hex = cells[row]?.[col]
          if (!hex) continue
          if (hex === BLANK_CELL) {
            blankCount += 1
            continue
          }
          counts.set(hex, (counts.get(hex) ?? 0) + 1)
        }
      }
    })

    const byHex = new Map<string, PaletteColor>()
    ;[...displayPalette, ...allDmcColors].forEach((color) => {
      if (!byHex.has(color.hex)) {
        byHex.set(color.hex, color)
      }
    })

    const colors = Array.from(counts.entries())
      .sort((left, right) => right[1] - left[1])
      .map(([hex]) => byHex.get(hex))
      .filter((color): color is PaletteColor => Boolean(color))

    // Blank isn't a real thread color, but "fill the empty area in my
    // selection" is a common need — surface a pseudo-swatch so the existing
    // select → replace-with flow also works for blank cells, even when
    // they're scattered across multiple non-contiguous selected regions
    // (the paint-tool eraser only fills one connected blob at a time).
    if (blankCount > 0) {
      colors.unshift({ hex: BLANK_CELL, dmc_code: '—', dmc_name: 'Blank' })
    }

    return colors
  }, [allDmcColors, cells, displayPalette, selectedRegionBounds])
  const applyImportedImage = useCallback((url: string, belt: boolean = false, sourceType?: 'photo' | 'stitched_photo' | 'graphic_art') => {
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
    setDraftSettings(belt
      ? { ...DEFAULT_SETTINGS, mesh_count: BELT_MESH_COUNT, height_inches: BELT_HEIGHT_INCHES, width_inches: beltLengthForPantSize(DEFAULT_BELT_PANT_SIZE) }
      : sourceType
        ? applySourceTypeDefaults(DEFAULT_SETTINGS, sourceType)
        : DEFAULT_SETTINGS)
    setLockAspectRatio(!belt)
    setIsBeltCanvas(belt)
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
      setImportedAspectRatio(belt ? beltLengthForPantSize(DEFAULT_BELT_PANT_SIZE) / BELT_HEIGHT_INCHES : img.width / img.height)
      setLoading(false)
    }
    img.onerror = () => {
      setUploadError('Image import succeeded, but the image could not be loaded.')
      setLoading(false)
    }
    img.src = resolvedUrl
  }, [])

  function handleStartFresh() {
    const BLANK_W = 10
    const BLANK_H = 6
    const mesh = DEFAULT_SETTINGS.mesh_count
    const w = BLANK_W * mesh
    const h = BLANK_H * mesh
    const blankGrid = Array.from({ length: h }, () => Array(w).fill(BLANK_CELL))
    const blankSettings = { ...DEFAULT_SETTINGS, width_inches: BLANK_W, height_inches: BLANK_H }
    setActiveImagePath(null)
    setImportedAspectRatio(BLANK_W / BLANK_H)
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
    setLastSettings(blankSettings)
    setDraftSettings(blankSettings)
    setLockAspectRatio(false)
    setIsBeltCanvas(false)
    setHasGeneratedPreview(true)
    setViewMode('stitch')
    setGridKey((k) => k + 1)
    setActiveWorkflowStep(2)
    markCurrentDesignClean()
  }

  function handleStartBelt() {
    const beltLength = beltLengthForPantSize(DEFAULT_BELT_PANT_SIZE)
    const w = Math.round(beltLength * BELT_MESH_COUNT)
    const h = Math.round(BELT_HEIGHT_INCHES * BELT_MESH_COUNT)
    const blankGrid = Array.from({ length: h }, () => Array(w).fill(BLANK_CELL))
    const beltSettings: PreviewSettings = {
      ...DEFAULT_SETTINGS,
      width_inches: beltLength,
      height_inches: BELT_HEIGHT_INCHES,
      mesh_count: BELT_MESH_COUNT,
    }
    setActiveImagePath(null)
    setImportedAspectRatio(beltLength / BELT_HEIGHT_INCHES)
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
    setLastSettings(beltSettings)
    setDraftSettings(beltSettings)
    setLockAspectRatio(false)
    setIsBeltCanvas(true)
    setHasGeneratedPreview(true)
    setViewMode('stitch')
    setGridKey((k) => k + 1)
    setActiveWorkflowStep(2)
    markCurrentDesignClean()
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
        finishApplied,
        paletteReductionTarget,
        manuallyDisabledHexes: [...manuallyDisabledHexes],
      },
    ])
    setRedoStack([])
    // Any edit invalidates a live finish crop, so the reported (finish) dimensions
    // no longer apply. The finish functions re-assert this flag right after their
    // own pushUndoSnapshot() call, so applying a finish is unaffected.
    setFinishApplied(false)
  }

  async function handleApply(settings: PreviewSettings) {
    if (!activeImagePath) return
    const requestId = latestApplyRequestIdRef.current + 1
    latestApplyRequestIdRef.current = requestId
    const previewSettings = normalizePreviewSettings(settings, draftSettingsRef.current)
    if (getSettingsKey(previewSettings) !== getSettingsKey(settings)) {
      draftSettingsRef.current = previewSettings
      setDraftSettings(previewSettings)
    }

    const capturedReductionTarget = paletteReductionTarget
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
    // Only preserve palette selection for blank mode — fill-mode slider reductions re-derive
    // from the count each time to prevent cascading shrinkage across settings toggles.
    const canAttemptToPreservePaletteState =
      hasGeneratedPreview &&
      lastSettings !== null &&
      previewSettings.color_count === lastSettings.color_count &&
      previousHadFilteredPalette &&
      previousRemovalMode !== 'fill'

    const stitchWidth = Math.max(1, Math.round(previewSettings.width_inches * previewSettings.mesh_count))
    const stitchHeight = Math.max(1, Math.round(previewSettings.height_inches * previewSettings.mesh_count))
    const sameGeometryAsLastSettings = Boolean(
      lastSettings &&
        previewSettings.width_inches === lastSettings.width_inches &&
        previewSettings.height_inches === lastSettings.height_inches &&
        previewSettings.mesh_count === lastSettings.mesh_count
    )

    setUploadError(null)
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
      const fillModeReductionTarget =
        previousRemovalMode === 'fill' && capturedReductionTarget < nextAllPalette.length
          ? capturedReductionTarget
          : null
      const nextEnabledColorHexes = canAttemptToPreservePaletteState
        ? nextFullPaletteHexes.filter((hex) => previousEnabledColorHexes.includes(hex))
        : fillModeReductionTarget !== null
          ? pickDistinctPaletteHexes(nextAllPalette, countCellsByHex(nextOriginalCells), fillModeReductionTarget, previousActivePaintColor)
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
        : fillModeReductionTarget !== null
          ? nextEnabledColorHexes
          : nextFullPaletteHexes
      const shouldReapplyPaletteState =
        fillModeReductionTarget !== null ||
        shouldPreservePaletteState
      const rebuiltFromPaletteState = shouldReapplyPaletteState
        ? applyPaletteStateToCells(
            nextOriginalCells,
            nextAllPalette,
            resolvedEnabledColorHexes,
            fillModeReductionTarget !== null ? 'fill' : previousRemovalMode
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
      setPaletteReductionTarget(fillModeReductionTarget !== null ? fillModeReductionTarget : (nextFullPaletteHexes.length || 128))
      setFinalPdfPath(null)
      setFinalPreviewImagePath(null)
      setHasGeneratedPreview(true)
      setViewMode(hasGeneratedPreview ? previousViewMode : 'stitch')
      // First generation for this design (not a settings-tweak regenerate):
      // nothing has been edited yet, so this shouldn't count as unsaved work.
      if (!hasGeneratedPreview) { setToolMode('select'); setActivePaintColor(null); markCurrentDesignClean() }
      setActiveWorkflowStep(2)
      setSelectedRegions([])
    } finally {
      if (requestId === latestApplyRequestIdRef.current) {
        setLoading(false)
      }
    }
  }

  // Serialize background previews. The 250ms debounce below is far shorter
  // than a real /visualize (5-11s on prod), so dragging a slider used to fire
  // several overlapping requests — each one doing the full quantization
  // server-side, and each holding a few hundred MB while it ran. That is what
  // OOM-killed the 4GB backend on 2026-07-30: one drag session produced ~45
  // requests, several landing in the same second. The stale-result check in
  // handleApply only discarded the *answer*; the work had already happened.
  // Now at most one is in flight and the newest settings seen while it runs
  // are coalesced into a single follow-up.
  const previewInFlightRef = useRef(false)
  const pendingPreviewSettingsRef = useRef<PreviewSettings | null>(null)

  function applyPreviewInBackground(settings: PreviewSettings) {
    if (previewInFlightRef.current) {
      pendingPreviewSettingsRef.current = settings
      return
    }
    previewInFlightRef.current = true
    void handleApply(settings)
      .catch((error) => {
        setUploadError(error instanceof Error ? error.message : 'Preview generation failed.')
      })
      .finally(() => {
        previewInFlightRef.current = false
        const pending = pendingPreviewSettingsRef.current
        pendingPreviewSettingsRef.current = null
        // Skip when the queued settings are what we just rendered (e.g. the
        // user dragged away and back) — otherwise run the newest state now
        // rather than waiting for another debounce tick.
        if (pending && getSettingsKey(pending) !== getSettingsKey(settings)) {
          applyPreviewInBackground(pending)
        }
      })
  }

  useEffect(() => {
    if (!hasGeneratedPreview || !activeImagePath || !lastSettings) return

    const draftKey = getSettingsKey(draftSettings)
    const lastKey = getSettingsKey(lastSettings)
    if (draftKey === lastKey) return

    const timeoutId = window.setTimeout(() => {
      applyPreviewInBackground(draftSettings)
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

    // Mesh toggle on a canvas that has stitched content (imported pattern or
    // hand-painted design): the stitch grid is the ground truth, so keep it
    // and recompute the physical inches at the new mesh instead of wiping.
    const meshChanged = draftSettings.mesh_count !== lastSettings.mesh_count
    const hasContent = cells.some((row) => row.some((cell) => cell !== BLANK_CELL))
    if (meshChanged && hasContent) {
      const rows = cells.length
      const cols = cells[0]?.length ?? 0
      if (rows > 0 && cols > 0) {
        const adjusted: PreviewSettings = {
          ...draftSettings,
          width_inches: Math.round((cols / draftSettings.mesh_count) * 100) / 100,
          height_inches: Math.round((rows / draftSettings.mesh_count) * 100) / 100,
        }
        setDraftSettings(adjusted)
        setLastSettings(adjusted)
        setImportedAspectRatio(adjusted.width_inches / adjusted.height_inches)
        return
      }
    }

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
  }, [activeImagePath, cells, draftSettings, hasGeneratedPreview, lastSettings])

  function updateSettings(patch: Partial<PreviewSettings>) {
    setDraftSettings((current) => {
      const next = { ...current, ...patch }
      const { width_inches, height_inches } = isBeltDesign(current.width_inches, current.height_inches)
        ? clampBeltDimensions(next.width_inches, next.height_inches)
        : clampPrintDimensions(next.width_inches, next.height_inches)
      return { ...next, width_inches, height_inches }
    })
  }

  function applyEnabledPalette(nextEnabledColorHexes: string[], nextRemovalMode = removalMode, overrideState = manualCellOverrides) {
    const { sourceCells, sourcePalette } = buildEffectiveSourceState(overrideState)
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
    setManuallyDisabledHexes((current) => [...current.filter((h) => h !== hex), hex])

    const { sourceCells, sourcePalette } = buildEffectiveSourceState()
    const nextEnabledHexes = enabledColorHexes.filter((item) => item !== hex)
    const addedOverrides: Record<string, string> = {}

    if (removalMode === 'blank') {
      sourceCells.forEach((row, rowIndex) => {
        row.forEach((cell, colIndex) => {
          if (cell === hex) addedOverrides[makeCellKey(rowIndex, colIndex)] = BLANK_CELL
        })
      })
    } else {
      const enabledSet = new Set(nextEnabledHexes)
      const enabledHexList = sourcePalette.filter((c) => enabledSet.has(c.hex)).map((c) => c.hex)
      if (enabledHexList.length > 0) {
        sourceCells.forEach((row, rowIndex) => {
          row.forEach((cell, colIndex) => {
            if (cell !== hex) return
            const remapped = enabledHexList.reduce((closest, candidate) =>
              colorDistance(cell, candidate) < colorDistance(cell, closest) ? candidate : closest
            )
            addedOverrides[makeCellKey(rowIndex, colIndex)] = remapped
          })
        })
      }
    }

    if (Object.keys(addedOverrides).length > 0) {
      const nextOverrides = { ...manualCellOverrides, ...addedOverrides }
      setManualCellOverrides(nextOverrides)
      applyEnabledPalette(nextEnabledHexes, removalMode, nextOverrides)
      return
    }

    applyEnabledPalette(nextEnabledHexes)
  }

  function enableColorHex(hex: string) {
    if (enabledColorHexes.includes(hex)) return
    if ((paletteCountsByHex[hex] ?? 0) === 0) {
      setEnabledColorHexes(Array.from(new Set([...enabledColorHexes, hex])))
      return
    }

    pushUndoSnapshot()
    setManuallyDisabledHexes((current) => current.filter((h) => h !== hex))

    const nextOverrides = Object.fromEntries(
      Object.entries(manualCellOverrides).filter(([key, value]) => {
        if (value === BLANK_CELL && removalMode !== 'blank') return true
        const [rowText, colText] = key.split(':')
        return originalCells[Number(rowText)]?.[Number(colText)] !== hex
      })
    )
    setManualCellOverrides(nextOverrides)
    applyEnabledPalette(Array.from(new Set([...enabledColorHexes, hex])), removalMode, nextOverrides)
  }


  function handleAutoReduceColors(targetCount: number) {
    // Sync any blank cells visible in `cells` that aren't yet in manualCellOverrides.
    // These arise when applyEnabledPalette runs in blank mode (e.g. via handleRemovalModeChange)
    // and writes blanks to `cells` without recording them in manualCellOverrides.
    const syncedOverrides = { ...manualCellOverrides }
    let didSync = false
    cells.forEach((row, rowIndex) => {
      row.forEach((cell, colIndex) => {
        if (cell !== BLANK_CELL) return
        if (originalCells[rowIndex]?.[colIndex] === BLANK_CELL) return
        const key = makeCellKey(rowIndex, colIndex)
        if (syncedOverrides[key] === BLANK_CELL) return
        syncedOverrides[key] = BLANK_CELL
        didSync = true
      })
    })
    if (didSync) setManualCellOverrides(syncedOverrides)

    const sourceState = buildEffectiveSourceState(syncedOverrides)
    const disabledSet = new Set(manuallyDisabledHexes)
    const sourcePalette = sourceState.sourcePalette.filter((color) => !disabledSet.has(color.hex))
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

    if (removalMode === 'blank') {
      const nextEnabledSet = new Set(nextEnabledColorHexes)
      const addedOverrides: Record<string, string> = {}
      sourceState.sourceCells.forEach((row, rowIndex) => {
        row.forEach((cell, colIndex) => {
          if (cell === BLANK_CELL || cell === FINISH_OUTLINE_CELL) return
          if (nextEnabledSet.has(cell)) return
          addedOverrides[makeCellKey(rowIndex, colIndex)] = BLANK_CELL
        })
      })
      if (Object.keys(addedOverrides).length > 0) {
        const nextOverrides = { ...syncedOverrides, ...addedOverrides }
        setManualCellOverrides(nextOverrides)
        applyEnabledPalette(nextEnabledColorHexes, removalMode, nextOverrides)
        return
      }
    }

    applyEnabledPalette(nextEnabledColorHexes, removalMode, syncedOverrides)
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

  function paintCellsWithColor(coords: Array<[number, number]>, paintColor: string) {
    if (!coords.length) return

    let nextCells: string[][] | null = null

    setCells((current) => {
      let changed = false
      const updatedCells = current.map((row) => [...row])
      coords.forEach(([row, col]) => {
        if (row < 0 || row >= updatedCells.length || col < 0 || col >= updatedCells[row].length) return
        if (updatedCells[row][col] === paintColor) return
        updatedCells[row][col] = paintColor
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
          nextOverrides[makeCellKey(row, col)] = paintColor
        })
        return nextOverrides
      })
    }

    setFinalPdfPath(null)
    setFinalPreviewImagePath(null)
  }

  function handlePaintCells(coords: Array<[number, number]>) {
    if (!activePaintColor) return
    paintCellsWithColor(coords, activePaintColor)
  }

  function handleFillCell({ row, col }: { row: number; col: number }) {
    if (!activePaintColor) return
    const targetColor = cells[row]?.[col]
    if (targetColor === undefined || targetColor === activePaintColor) return

    const totalRows = cells.length
    const totalCols = cells[0]?.length ?? 0
    const visited = new Set<string>()
    const region: Array<[number, number]> = []
    const queue: Array<[number, number]> = [[row, col]]
    visited.add(`${row}-${col}`)

    while (queue.length) {
      const [r, c] = queue.pop()!
      region.push([r, c])
      for (const [nr, nc] of [[r + 1, c], [r - 1, c], [r, c + 1], [r, c - 1]] as Array<[number, number]>) {
        if (nr < 0 || nr >= totalRows || nc < 0 || nc >= totalCols) continue
        const key = `${nr}-${nc}`
        if (visited.has(key) || cells[nr][nc] !== targetColor) continue
        visited.add(key)
        queue.push([nr, nc])
      }
    }

    pushUndoSnapshot()
    paintCellsWithColor(region, activePaintColor)
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
    setActivePaintColor(null)
    setClearSelectionSignal((k) => k + 1)
  }

  // ── Floating stamp (cut / copy / paste) ────────────────────────────────────

  function captureSelectionStamp(): { cells: (string | null)[][]; top: number; left: number } | null {
    if (!cells.length || !selectedRegionBounds.length) return null
    const top = Math.min(...selectedRegionBounds.map((b) => b.top))
    const bottom = Math.max(...selectedRegionBounds.map((b) => b.bottom))
    const left = Math.min(...selectedRegionBounds.map((b) => b.left))
    const right = Math.max(...selectedRegionBounds.map((b) => b.right))
    const stamp: (string | null)[][] = []
    let hasContent = false
    for (let r = top; r <= bottom; r += 1) {
      const row: (string | null)[] = []
      for (let c = left; c <= right; c += 1) {
        const insideRegion = selectedRegionBounds.some(
          (b) => r >= b.top && r <= b.bottom && c >= b.left && c <= b.right
        )
        const value = insideRegion ? cells[r]?.[c] : undefined
        if (value === undefined || value === BLANK_CELL || value === FINISH_OUTLINE_CELL) {
          row.push(null)
        } else {
          row.push(value)
          hasContent = true
        }
      }
      stamp.push(row)
    }
    if (!hasContent) return null
    return { cells: stamp, top, left }
  }

  function clampStampAnchor(anchorRow: number, anchorCol: number, stampCells: (string | null)[][]) {
    const gridH = cells.length
    const gridW = cells[0]?.length ?? 0
    const stampH = stampCells.length
    const stampW = stampCells[0]?.length ?? 0
    return {
      anchorRow: Math.max(1 - stampH, Math.min(gridH - 1, anchorRow)),
      anchorCol: Math.max(1 - stampW, Math.min(gridW - 1, anchorCol)),
    }
  }

  function handleCopySelection() {
    const captured = captureSelectionStamp()
    if (!captured) return
    stampCameFromCutRef.current = false
    setStampClipboard(captured.cells)
    setFloatingStamp({ cells: captured.cells, anchorRow: captured.top, anchorCol: captured.left })
    setSelectedRegions([])
  }

  function handleCutSelection() {
    const captured = captureSelectionStamp()
    if (!captured) return
    const nextCells = cloneCells(cells)
    const nextOverrides = { ...manualCellOverrides }
    for (const { top, bottom, left, right } of selectedRegionBounds) {
      for (let r = top; r <= bottom; r += 1) {
        for (let c = left; c <= right; c += 1) {
          if (nextCells[r]?.[c] === undefined) continue
          if (nextCells[r][c] === FINISH_OUTLINE_CELL) continue
          nextCells[r][c] = BLANK_CELL
          nextOverrides[makeCellKey(r, c)] = BLANK_CELL
        }
      }
    }
    pushUndoSnapshot()
    setCells(nextCells)
    setManualCellOverrides(nextOverrides)
    refreshPreviewPalette(nextCells)
    stampCameFromCutRef.current = true
    setStampClipboard(captured.cells)
    setFloatingStamp({ cells: captured.cells, anchorRow: captured.top, anchorCol: captured.left })
    setSelectedRegions([])
    setFinalPdfPath(null)
    setFinalPreviewImagePath(null)
    setViewMode('stitch')
  }

  // Accepts an explicit source so importing a project can place it
  // immediately — setStampClipboard's update wouldn't be visible yet to a
  // handlePasteClipboard() call made in the same tick.
  function handlePasteClipboard(source: (string | null)[][] | null = stampClipboard) {
    if (!source || !cells.length) return
    const stampH = source.length
    const stampW = source[0]?.length ?? 0
    const anchorRow = Math.max(0, Math.round((cells.length - stampH) / 2))
    const anchorCol = Math.max(0, Math.round(((cells[0]?.length ?? 0) - stampW) / 2))
    stampCameFromCutRef.current = false
    setFloatingStamp({ cells: source, anchorRow, anchorCol })
    setSelectedRegions([])
    setViewMode('stitch')
  }

  function handleOpenImportProjectPicker() {
    setShowImportProjectPicker(true)
    if (importableProjects !== null || !session?.access_token) return
    setImportProjectsLoading(true)
    setImportProjectsError('')
    listProjects(session.access_token)
      .then((projects) => setImportableProjects(projects.filter((p) => p.id !== savedProjectId)))
      .catch(() => setImportProjectsError('Could not load your projects.'))
      .finally(() => setImportProjectsLoading(false))
  }

  function handleImportProject(project: Project) {
    const cropped = cropCellsToContent(project.cells ?? [])
    if (!cropped.length || !cropped[0]?.length) return
    setStampClipboard(cropped)
    setShowImportProjectPicker(false)
    handlePasteClipboard(cropped)
  }

  const handleStampMove = useCallback((anchor: { row: number; col: number }) => {
    setFloatingStamp((current) => {
      if (!current) return current
      const gridH = cells.length
      const gridW = cells[0]?.length ?? 0
      const stampH = current.cells.length
      const stampW = current.cells[0]?.length ?? 0
      return {
        ...current,
        anchorRow: Math.max(1 - stampH, Math.min(gridH - 1, anchor.row)),
        anchorCol: Math.max(1 - stampW, Math.min(gridW - 1, anchor.col)),
      }
    })
  }, [cells])

  function handleStampNudge(direction: 'up' | 'down' | 'left' | 'right') {
    if (!floatingStamp) return
    const dr = direction === 'up' ? -1 : direction === 'down' ? 1 : 0
    const dc = direction === 'left' ? -1 : direction === 'right' ? 1 : 0
    const next = clampStampAnchor(floatingStamp.anchorRow + dr, floatingStamp.anchorCol + dc, floatingStamp.cells)
    setFloatingStamp({ ...floatingStamp, ...next })
  }

  function handleRotateStamp() {
    if (!floatingStamp) return
    const source = floatingStamp.cells
    const srcH = source.length
    const srcW = source[0]?.length ?? 0
    const rotated: (string | null)[][] = Array.from({ length: srcW }, (_, r) =>
      Array.from({ length: srcH }, (_, c) => source[srcH - 1 - c][r])
    )
    // Keep the stamp centered on the same spot as it rotates
    const anchorRow = Math.round(floatingStamp.anchorRow + srcH / 2 - srcW / 2)
    const anchorCol = Math.round(floatingStamp.anchorCol + srcW / 2 - srcH / 2)
    const next = clampStampAnchor(anchorRow, anchorCol, rotated)
    setFloatingStamp({ cells: rotated, ...next })
  }

  function handleFlipStamp(axis: 'horizontal' | 'vertical') {
    if (!floatingStamp) return
    const flipped = axis === 'horizontal'
      ? floatingStamp.cells.map((row) => [...row].reverse())
      : [...floatingStamp.cells].reverse().map((row) => [...row])
    setFloatingStamp({ ...floatingStamp, cells: flipped })
  }

  function handlePlaceStamp() {
    if (!floatingStamp || !cells.length) return
    const gridH = cells.length
    const gridW = cells[0].length
    const nextCells = cloneCells(cells)
    const nextOverrides = { ...manualCellOverrides }
    const placedHexes = new Set<string>()
    let changed = 0
    floatingStamp.cells.forEach((row, r) => {
      row.forEach((value, c) => {
        if (value === null) return
        const gr = floatingStamp.anchorRow + r
        const gc = floatingStamp.anchorCol + c
        if (gr < 0 || gr >= gridH || gc < 0 || gc >= gridW) return
        if (nextCells[gr][gc] === value) return
        nextCells[gr][gc] = value
        nextOverrides[makeCellKey(gr, gc)] = value
        placedHexes.add(value)
        changed += 1
      })
    })
    if (changed) {
      pushUndoSnapshot()
      setCells(nextCells)
      setManualCellOverrides(nextOverrides)
      refreshPreviewPalette(nextCells)
      setEnabledColorHexes((current) => Array.from(new Set([...current, ...Array.from(placedHexes)])))
      setFinalPdfPath(null)
      setFinalPreviewImagePath(null)
      setViewMode('stitch')
    }
    stampCameFromCutRef.current = false
    setFloatingStamp(null)
  }

  function handleCancelStamp() {
    if (stampCameFromCutRef.current) {
      handleUndoColorChange()
    }
    stampCameFromCutRef.current = false
    setFloatingStamp(null)
  }

  const handleEyedropperSample = useCallback(async ({ row, col }: { row: number; col: number }) => {
    if (!activeImagePath || !lastSettings) return
    const stitchWidth = Math.max(1, Math.round(lastSettings.width_inches * lastSettings.mesh_count))
    const stitchHeight = Math.max(1, Math.round(lastSettings.height_inches * lastSettings.mesh_count))
    try {
      const dmcColor = await samplePixel({ image_url: activeImagePath, col, row, stitch_width: stitchWidth, stitch_height: stitchHeight })
      setAllPalette((prev) => prev.some((c) => c.hex === dmcColor.hex) ? prev : [...prev, dmcColor])
      setPreviewPalette((prev) => prev.some((c) => c.hex === dmcColor.hex) ? prev : [...prev, dmcColor])
    } catch {
      // silently ignore lookup failures
    }
  }, [activeImagePath, lastSettings])

  const handleGridRender = useCallback(async () => {
    if (!activeImagePath || !lastSettings || !previewPalette.length) return
    const stitchWidth = Math.max(1, Math.round(lastSettings.width_inches * lastSettings.mesh_count))
    const stitchHeight = Math.max(1, Math.round(lastSettings.height_inches * lastSettings.mesh_count))
    setIsGridRendering(true)
    try {
      const result = await gridRender({
        image_url: activeImagePath,
        stitch_width: stitchWidth,
        stitch_height: stitchHeight,
        mesh_count: lastSettings.mesh_count,
        show_grid: lastSettings.show_grid,
        palette: previewPalette,
      })
      setCells(result.cells)
      setOriginalCells(result.cells)
      setPreviewImagePath(result.stitch_preview_url)
    } catch {
      // silently ignore failures — existing cells stay intact
    } finally {
      setIsGridRendering(false)
    }
  }, [activeImagePath, lastSettings, previewPalette])

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
          finishApplied,
          paletteReductionTarget,
          manuallyDisabledHexes: [...manuallyDisabledHexes],
        },
      ])
      setCells(previous.cells)
      setEnabledColorHexes(previous.enabledColorHexes)
      setPreviewPalette(previous.previewPalette)
      setActivePaintColor(previous.activePaintColor)
      setRemovalMode(previous.removalMode)
      setManualCellOverrides(previous.manualCellOverrides)
      setFinishOutlineBackups(previous.finishOutlineBackups)
      setFinishApplied(previous.finishApplied ?? false)
      setPaletteReductionTarget(previous.paletteReductionTarget)
      setManuallyDisabledHexes(previous.manuallyDisabledHexes)
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
          finishApplied,
          paletteReductionTarget,
          manuallyDisabledHexes: [...manuallyDisabledHexes],
        },
      ])
      setCells(next.cells)
      setEnabledColorHexes(next.enabledColorHexes)
      setPreviewPalette(next.previewPalette)
      setActivePaintColor(next.activePaintColor)
      setRemovalMode(next.removalMode)
      setManualCellOverrides(next.manualCellOverrides)
      setFinishOutlineBackups(next.finishOutlineBackups)
      setFinishApplied(next.finishApplied ?? false)
      setPaletteReductionTarget(next.paletteReductionTarget)
      setManuallyDisabledHexes(next.manuallyDisabledHexes)
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

      if (event.key === 'Escape') {
        if (floatingStamp) {
          event.preventDefault()
          handleCancelStamp()
        } else if (selectedRegions.length > 0) {
          event.preventDefault()
          setSelectedRegions([])
        }
        return
      }

      if (isTypingTarget) return

      if (floatingStamp) {
        if (event.key === 'Enter') {
          event.preventDefault()
          handlePlaceStamp()
          return
        }
        const nudge = ({
          ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
        } as const)[event.key as 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight']
        if (nudge) {
          event.preventDefault()
          handleStampNudge(nudge)
          return
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r') {
          event.preventDefault()
          handleRotateStamp()
          return
        }
      }

      if (!event.ctrlKey && !event.metaKey) return

      const key = event.key.toLowerCase()
      if (toolMode === 'select' && !floatingStamp && (key === 'x' || key === 'c') && selectedRegions.length > 0) {
        event.preventDefault()
        if (key === 'x') handleCutSelection()
        else handleCopySelection()
        return
      }
      if (toolMode === 'select' && key === 'v' && stampClipboard && !floatingStamp) {
        event.preventDefault()
        handlePasteClipboard()
        return
      }

      if (key !== 'z') return

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
  }, [redoStack.length, undoStack.length, selectedRegions.length, floatingStamp, stampClipboard, toolMode, cells, manualCellOverrides, selectedRegionBounds])

  useEffect(() => {
    if (toolMode !== 'select') setFloatingStamp(null)
  }, [toolMode])

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
    setTraceOpacity(0)
    setUndoStack([])
    setRedoStack([])
    setFinalPdfPath(null)
    setFinalPreviewImagePath(null)
    setViewMode('stitch')
    setSelectedRegions([])
    setPaletteReductionTarget(allPalette.length)
    setManuallyDisabledHexes([])
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


  function buildCanvasContext(): CanvasContext {
    return {
      source_mode: draftSettings.source_type,
      width_inches: draftSettings.width_inches,
      height_inches: draftSettings.height_inches,
      mesh_count: draftSettings.mesh_count,
      color_count: paletteReductionTarget,
      has_preview: hasGeneratedPreview,
      has_source_image: !!activeImagePath,
      source_image_url: activeImagePath ?? undefined,
      palette: displayPalette.slice(0, 30).map((c) => ({
        dmc_code: c.dmc_code,
        name: c.dmc_name,
        hex: c.hex,
      })),
      clean_background: draftSettings.clean_background,
      simplify_colors: draftSettings.simplify_colors,
      strengthen_dark_detail: draftSettings.strengthen_dark_detail,
      preserve_accents: draftSettings.preserve_accents,
      contrast_level: draftSettings.contrast_level,
      show_grid: draftSettings.show_grid,
      has_selection: selectedRegions.length > 0,
      grid_rows: cells.length,
      grid_cols: cells[0]?.length ?? 0,
      preview_image_url: hasGeneratedPreview ? (previewImagePath ?? lastVisibleImageUrl ?? undefined) : undefined,
    }
  }

  async function dispatchChatAction(action: ChatActionItem): Promise<void> {
    switch (action.type) {
      case 'set_source_mode':
        setDraftSettings((current) =>
          applySourceTypeDefaults(current, action.value as 'photo' | 'stitched_photo' | 'graphic_art')
        )
        break
      case 'set_dimensions': {
        const patch: Partial<PreviewSettings> = {}
        if (action.width_inches !== undefined && action.width_inches !== null) {
          const width = toFiniteNumber(action.width_inches)
          if (width === null || width <= 0) throw new Error('MNS Pro could not apply that width. Use a positive number of inches.')
          patch.width_inches = width
        }
        if (action.height_inches !== undefined && action.height_inches !== null) {
          const height = toFiniteNumber(action.height_inches)
          if (height === null || height <= 0) throw new Error('MNS Pro could not apply that height. Use a positive number of inches.')
          patch.height_inches = height
        }
        if (action.mesh_count !== undefined && action.mesh_count !== null) {
          const meshCount = toFiniteNumber(action.mesh_count)
          if (meshCount !== 13 && meshCount !== 18) throw new Error('MNS Pro supports only 13 or 18 mesh.')
          patch.mesh_count = meshCount
        }
        if (!Object.keys(patch).length) break

        const merged = normalizePreviewSettings(
          { ...draftSettingsRef.current, ...patch },
          draftSettingsRef.current,
        )
        draftSettingsRef.current = merged
        setDraftSettings(merged)
        if (activeImagePath) {
          await handleApply(merged)
        }
        break
      }
      case 'set_color_count':
        if (displayPalette.length) handleAutoReduceColors(action.value as number)
        break
      case 'toggle_setting':
        updateSettings({ [action.setting as string]: action.value })
        break
      case 'set_contrast':
        updateSettings({ contrast_level: action.value as string as 'low' | 'normal' | 'high' | 'super_high' | 'super_super_high' })
        break
      case 'generate_preview':
        if (activeImagePath) await handleApply(draftSettingsRef.current)
        break
      case 'undo':
        if (undoStack.length) handleUndoColorChange()
        break
      case 'redo':
        if (redoStack.length) handleRedoColorChange()
        break
      case 'reset_preview':
        handleResetColorChanges()
        break
      case 'remove_color': {
        const col = findPaletteColor(action.value as string)
        if (col) disableColorHex(col.hex)
        break
      }
      case 'restore_color': {
        const col = findPaletteColor(action.value as string)
        if (col) enableColorHex(col.hex)
        break
      }
      case 'merge_colors':
      case 'swap_color': {
        const target = findPaletteColor(action.to_code ?? '')
        if (target) {
          const fromHexes = (action.from_codes ?? [])
            .map((code) => findPaletteColor(code)?.hex)
            .filter((h): h is string => !!h)
          if (fromHexes.length) mergeColorsIntoTarget(fromHexes, target.hex)
        }
        break
      }
      case 'set_paint_color': {
        const col = findPaletteColor(action.value as string)
        if (col) setActivePaintColor(col.hex)
        break
      }
      case 'set_removal_mode':
        handleRemovalModeChange(action.value as 'fill' | 'blank')
        break
      case 'fill_selection':
      case 'clear_selection': {
        if (!cells.length || !selectedRegions.length) break
        const fillHex = action.type === 'fill_selection'
          ? (findPaletteColor(action.value as string)?.hex ?? null)
          : BLANK_CELL
        if (!fillHex) break
        const nextCells = cloneCells(cells)
        const nextOverrides = { ...manualCellOverrides }
        let changed = 0
        for (const rect of selectedRegions) {
          const r0 = Math.min(rect.startRow, rect.endRow)
          const r1 = Math.max(rect.startRow, rect.endRow)
          const c0 = Math.min(rect.startCol, rect.endCol)
          const c1 = Math.max(rect.startCol, rect.endCol)
          for (let r = r0; r <= r1; r++) {
            for (let c = c0; c <= c1; c++) {
              if (nextCells[r]?.[c] === undefined) continue
              if (nextCells[r][c] === FINISH_OUTLINE_CELL) continue
              nextCells[r][c] = fillHex
              nextOverrides[makeCellKey(r, c)] = fillHex
              changed++
            }
          }
        }
        if (changed) {
          pushUndoSnapshot()
          setCells(nextCells)
          setManualCellOverrides(nextOverrides)
          refreshPreviewPalette(nextCells)
          setFinalPdfPath(null)
          setFinalPreviewImagePath(null)
          setViewMode('stitch')
        }
        break
      }
      case 'paint_border': {
        const borderColor = findPaletteColor(action.value as string)
        if (!borderColor || !cells.length) break
        const bHex = borderColor.hex
        const numRows = cells.length
        const numCols = cells[0].length
        const nextCells = cloneCells(cells)
        const nextOverrides = { ...manualCellOverrides }
        let changed = 0
        for (let r = 0; r < numRows; r++) {
          for (let c = 0; c < numCols; c++) {
            if (r !== 0 && r !== numRows - 1 && c !== 0 && c !== numCols - 1) continue
            if (cells[r][c] === BLANK_CELL || cells[r][c] === FINISH_OUTLINE_CELL) continue
            nextCells[r][c] = bHex
            nextOverrides[makeCellKey(r, c)] = bHex
            changed++
          }
        }
        if (changed) {
          pushUndoSnapshot()
          setCells(nextCells)
          setManualCellOverrides(nextOverrides)
          refreshPreviewPalette(nextCells)
          setFinalPdfPath(null)
          setFinalPreviewImagePath(null)
          setViewMode('stitch')
        }
        break
      }
      case 'clear_background': {
        const bgColor = findPaletteColor(action.value as string)
        if (!bgColor || !cells.length) break
        const bgHex = bgColor.hex
        const replHex = action.to_code ? (findPaletteColor(action.to_code)?.hex ?? BLANK_CELL) : BLANK_CELL
        const numRows = cells.length
        const numCols = cells[0].length
        // BFS flood fill from all edge cells matching bgHex
        const visitedBg = new Set<string>()
        const queue: [number, number][] = []
        for (let r = 0; r < numRows; r++) {
          for (let c = 0; c < numCols; c++) {
            if (r !== 0 && r !== numRows - 1 && c !== 0 && c !== numCols - 1) continue
            if (cells[r][c] !== bgHex) continue
            const k = `${r},${c}`
            if (!visitedBg.has(k)) { visitedBg.add(k); queue.push([r, c]) }
          }
        }
        let head = 0
        while (head < queue.length) {
          const [r, c] = queue[head++]
          for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]] as const) {
            const nr = r + dr; const nc = c + dc
            if (nr < 0 || nr >= numRows || nc < 0 || nc >= numCols) continue
            const k = `${nr},${nc}`
            if (visitedBg.has(k) || cells[nr][nc] !== bgHex) continue
            visitedBg.add(k); queue.push([nr, nc])
          }
        }
        if (!visitedBg.size) break
        const nextCells = cloneCells(cells)
        const nextOverrides = { ...manualCellOverrides }
        Array.from(visitedBg).forEach((k) => {
          const [r, c] = k.split(',').map(Number)
          nextCells[r][c] = replHex
          nextOverrides[makeCellKey(r, c)] = replHex
        })
        pushUndoSnapshot()
        setCells(nextCells)
        setManualCellOverrides(nextOverrides)
        refreshPreviewPalette(nextCells)
        setFinalPdfPath(null)
        setFinalPreviewImagePath(null)
        setViewMode('stitch')
        break
      }
      case 'draw_shape': {
        if (!cells.length || action.r1 === undefined || action.c1 === undefined || action.r2 === undefined || action.c2 === undefined) break
        const shapeType = (action.shape === 'arc' ? 'semicircle' : (action.shape ?? 'box')) as 'box' | 'semicircle' | 'line'
        const fillHex = action.fill_color ? (findPaletteColor(action.fill_color)?.hex ?? null) : null
        const borderHex = action.border_color ? (findPaletteColor(action.border_color)?.hex ?? null) : null
        const shapeCells = computeShapeCells(
          shapeType, action.r1, action.c1, action.r2, action.c2,
          fillHex, borderHex,
          cells.length, cells[0]?.length ?? 0,
          action.border_size ?? 1,
          false,
          action.full_circle ?? false,
        )
        if (!shapeCells.length) break
        pushUndoSnapshot()
        const nextCells = cloneCells(cells)
        const nextOverrides = { ...manualCellOverrides }
        for (const sc of shapeCells) {
          if (sc.row < 0 || sc.row >= nextCells.length) continue
          if (sc.col < 0 || sc.col >= (nextCells[0]?.length ?? 0)) continue
          nextCells[sc.row][sc.col] = sc.color
          nextOverrides[makeCellKey(sc.row, sc.col)] = sc.color
        }
        setCells(nextCells)
        setManualCellOverrides(nextOverrides)
        refreshPreviewPalette(nextCells)
        setFinalPdfPath(null)
        setFinalPreviewImagePath(null)
        setViewMode('stitch')
        break
      }
      case 'add_text': {
        if (!cells.length || action.row === undefined || action.col === undefined || !action.text || !action.color) break
        const textColor = findPaletteColor(action.color)?.hex ?? action.color
        if (action.font_family) await ensureFontLoaded(action.font_family).catch(() => {})
        const textCells = getTextCells(
          action.text, action.row, action.col,
          action.font_size ?? 'medium',
          action.font_family ?? 'sans',
          textColor,
          { bold: action.bold, italic: action.italic, outline: action.outline },
          action.orientation ?? 'horizontal',
        )
        if (!textCells.length) break
        pushUndoSnapshot()
        const nextCells = cloneCells(cells)
        const nextOverrides = { ...manualCellOverrides }
        for (const tc of textCells) {
          if (tc.row < 0 || tc.row >= nextCells.length) continue
          if (tc.col < 0 || tc.col >= (nextCells[0]?.length ?? 0)) continue
          nextCells[tc.row][tc.col] = tc.color
          nextOverrides[makeCellKey(tc.row, tc.col)] = tc.color
        }
        setCells(nextCells)
        setManualCellOverrides(nextOverrides)
        refreshPreviewPalette(nextCells)
        setFinalPdfPath(null)
        setFinalPreviewImagePath(null)
        setViewMode('stitch')
        break
      }
      case 'flood_fill': {
        if (!cells.length || action.row === undefined || action.col === undefined || !action.color) break
        const seedRow = action.row
        const seedCol = action.col
        if (seedRow < 0 || seedRow >= cells.length || seedCol < 0 || seedCol >= (cells[0]?.length ?? 0)) break
        const fillHex = findPaletteColor(action.color)?.hex ?? action.color
        const targetHex = cells[seedRow][seedCol]
        if (targetHex === fillHex || targetHex === BLANK_CELL || targetHex === FINISH_OUTLINE_CELL) break
        const numRows = cells.length
        const numCols = cells[0].length
        const visited = new Set<string>()
        const queue: [number, number][] = [[seedRow, seedCol]]
        visited.add(`${seedRow},${seedCol}`)
        let head = 0
        while (head < queue.length) {
          const [r, c] = queue[head++]
          for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]] as const) {
            const nr = r + dr, nc = c + dc
            if (nr < 0 || nr >= numRows || nc < 0 || nc >= numCols) continue
            const k = `${nr},${nc}`
            if (visited.has(k) || cells[nr][nc] !== targetHex) continue
            visited.add(k)
            queue.push([nr, nc])
          }
        }
        if (!visited.size) break
        pushUndoSnapshot()
        const nextCells = cloneCells(cells)
        const nextOverrides = { ...manualCellOverrides }
        Array.from(visited).forEach((k) => {
          const [r, c] = k.split(',').map(Number)
          nextCells[r][c] = fillHex
          nextOverrides[makeCellKey(r, c)] = fillHex
        })
        setCells(nextCells)
        setManualCellOverrides(nextOverrides)
        refreshPreviewPalette(nextCells)
        setFinalPdfPath(null)
        setFinalPreviewImagePath(null)
        setViewMode('stitch')
        break
      }
      case 'set_source_image':
        if (action.url) applyImportedImage(action.url, false, action.source_type)
        break
      case 'expand_preview':
        setIsPreviewExpanded(action.value as boolean)
        break
    }
  }

  async function handleChatMessage(message: string, history: Array<{role: 'user' | 'assistant', content: string}>): Promise<CommandResult> {
    const trimmed = message.trim()
    const context = buildCanvasContext()
    const response = await chatAssistant(trimmed, context, history)

    for (const action of response.actions ?? []) {
      await dispatchChatAction(action)
    }

    return { reply: response.reply }
  }


  async function handleChatUpload(file: File, belt: boolean = false) {
    setUploadError(null)
    setLoading(true)
    try {
      const result = await uploadImage(file)
      applyImportedImage(result.active_image_url, belt)
      return `Imported ${file.name}. You can generate a stitch preview when ready.`
    } catch (error) {
      setLoading(false)
      throw error
    }
  }

  function applyImportedPattern(
    imageUrl: string | null,
    result: Pick<ImportPatternResponse, 'cells' | 'palette' | 'stitch_width' | 'stitch_height'>,
    extras?: { meshCount?: PreviewSettings['mesh_count']; patternName?: string; previewUrl?: string | null }
  ) {
    // Pick a mesh that keeps the pattern inside the printable bounds when
    // possible — otherwise PreviewControls' aspect-lock clamp rewrites the
    // height, and the settings change wipes the imported grid.
    const fitsPrintable = (mesh: PreviewSettings['mesh_count']) => {
      const w = result.stitch_width / mesh
      const h = result.stitch_height / mesh
      return Math.max(w, h) <= MAX_PRINTABLE_LONG_SIDE && Math.min(w, h) <= MAX_PRINTABLE_SHORT_SIDE
    }
    const preferred = extras?.meshCount ?? DEFAULT_SETTINGS.mesh_count
    const mesh = fitsPrintable(preferred) ? preferred : fitsPrintable(18) ? 18 : preferred
    const settings: PreviewSettings = {
      ...DEFAULT_SETTINGS,
      mesh_count: mesh,
      width_inches: Math.round((result.stitch_width / mesh) * 100) / 100,
      height_inches: Math.round((result.stitch_height / mesh) * 100) / 100,
      color_count: result.palette.length,
    }
    // Imported stitch grids aren't rescalable, so the photo-flow aspect lock
    // (which force-rewrites height and triggers a canvas reset) stays off.
    setLockAspectRatio(false)
    // Deliberately do NOT set activeImagePath: the imported cells are the
    // source of truth, and arming the photo pipeline with a source image
    // lets the settings-sync effect regenerate (and destroy) the pattern.
    setActiveImagePath(null)
    const preview = extras?.previewUrl ?? imageUrl
    if (preview) {
      setPreviewImagePath(preview)
      setOriginalPreviewImagePath(preview)
      setLastVisibleImageUrl(preview)
    }
    if (extras?.patternName) setDraftName(extras.patternName)
    setAllPalette(result.palette)
    setPreviewPalette(result.palette)
    setEnabledColorHexes(result.palette.map((c) => c.hex))
    setActivePaintColor(result.palette[0]?.hex ?? null)
    setCells(result.cells)
    setOriginalCells(result.cells)
    setManualCellOverrides({})
    setUndoStack([])
    setRedoStack([])
    setSettingsGuardAccepted(false)
    setDraftSettings(settings)
    setLastSettings(settings)
    setIsBeltCanvas(false)
    setImportedAspectRatio(settings.width_inches / settings.height_inches)
    setHasGeneratedPreview(true)
    setViewMode('stitch')
    setActiveWorkflowStep(2)
    markCurrentDesignClean()
  }

  async function handlePatternImportFile(file: File) {
    setUploadError(null)
    setLoading(true)
    try {
      if (file.name.toLowerCase().endsWith('.stitchly')) {
        const res = await importStitchlyFile(file)
        applyImportedPattern(res.source_image_url, res, {
          meshCount: res.mesh_count === 18 ? 18 : 13,
          patternName: res.pattern_name ?? undefined,
          previewUrl: res.preview_image_url,
        })
        if (res.backstitch_count > 0 || res.point_stitch_count > 0) {
          setUploadError(
            `Imported. Note: ${res.backstitch_count + res.point_stitch_count} backstitch/specialty stitches aren't supported yet and were skipped.`
          )
        }
        return
      }

      const uploaded = await uploadImage(file)
      let result: ImportPatternResponse
      try {
        result = await importPatternImage({ image_url: uploaded.active_image_url })
      } catch (error) {
        if (error instanceof ImportPatternError && error.code === 'needs_dimensions') {
          const answer = window.prompt(
            'This image has more than one pixel per stitch.\nEnter the pattern size in stitches as WIDTH x HEIGHT (e.g. 120 x 90):'
          )
          if (!answer) return
          const match = answer.match(/(\d+)\s*[x×,\s]\s*(\d+)/i)
          if (!match) {
            setUploadError('Could not read those stitch dimensions — expected something like "120 x 90".')
            return
          }
          result = await importPatternImage({
            image_url: uploaded.active_image_url,
            stitch_width: parseInt(match[1], 10),
            stitch_height: parseInt(match[2], 10),
          })
        } else {
          throw error
        }
      }
      applyImportedPattern(uploaded.active_image_url, result)
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Pattern import failed.')
    } finally {
      setLoading(false)
    }
  }

  async function handleStagedUploadDrop(event: DragEvent<HTMLDivElement>, belt: boolean = false) {
    event.preventDefault()
    setStagedUploadDragActive(false)
    if (loading) return

    const file = event.dataTransfer.files?.[0]
    if (!file || !file.type.startsWith('image/')) return

    await handleChatUpload(file, belt)
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
      const result = await finalizePreview({
        preview_url: previewImagePath,
        width_inches: finishApplied ? finishW : (contentBounds?.width_inches ?? settingsForFinalize.width_inches),
        height_inches: finishApplied ? finishH : (contentBounds?.height_inches ?? settingsForFinalize.height_inches),
        mesh_count: settingsForFinalize.mesh_count,
        color_count: currentDesignPalette.length,
        contrast_level: settingsForFinalize.contrast_level,
        show_grid: true,
        palette: currentDesignPalette,
        cells,
        previous_pdf_url: previousPdfUrl,
        project_id: activeDraftProjectId,
      }, session.access_token)

      const existingId = activeDraftProjectId
      const finalizedPayload = {
        name: draftName.trim() || 'Untitled',
        width_inches: settingsForFinalize.width_inches,
        height_inches: settingsForFinalize.height_inches,
        mesh_count: settingsForFinalize.mesh_count,
        color_count: currentDesignPalette.length,
        contrast_level: settingsForFinalize.contrast_level,
        source_type: settingsForFinalize.source_type,
        show_grid: true,
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
        parent_gallery_item_id: parentGalleryItemId ?? null,
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
      setInternalPdfSupabasePath(result.internal_pdf_supabase_path ?? null)
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
      markCurrentDesignClean()
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
      const originTags: string[] = []
      if (parentGalleryItemId) originTags.push('remix')
      if (lastSettings?.source_type === 'photo' || lastSettings?.source_type === 'stitched_photo') originTags.push('from photo')
      if (lastSettings?.source_type === 'graphic_art') originTags.push('graphic art')

      const userTags = galleryTags.split(',').map((t) => t.trim()).filter(Boolean)
      const allTags = Array.from(new Set([...originTags, ...userTags]))

      const publishedItem = await publishGalleryItem(
        {
          title,
          tags: allTags,
          submitter_name: userDisplayName(user),
          preview_image_url: finalPreviewImagePath ?? previewImagePath,
          pdf_url: finalPdfPath,
          width_inches: finishApplied ? finishW : (contentBounds?.width_inches ?? lastSettings?.width_inches ?? null),
          height_inches: finishApplied ? finishH : (contentBounds?.height_inches ?? lastSettings?.height_inches ?? null),
          mesh_count: lastSettings?.mesh_count ?? null,
          color_count: currentDesignPalette.length,
          palette: currentDesignPalette.map((c) => ({ hex: c.hex, dmc_code: c.dmc_code, dmc_name: c.dmc_name })),
          has_outline: Object.keys(finishOutlineBackups).length > 0,
          project_id: savedProjectId ?? null,
          parent_gallery_item_id: parentGalleryItemId ?? null,
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
      const { client_secret } = await createPrintOwnCheckout(
        {
          pdf_url: finalPdfPath,
          width_inches: finishApplied ? finishW : (contentBounds?.width_inches ?? lastSettings.width_inches),
          height_inches: finishApplied ? finishH : (contentBounds?.height_inches ?? lastSettings.height_inches),
          parent_gallery_item_id: parentGalleryItemId ?? null,
          internal_pdf_supabase_path: internalPdfSupabasePath,
          project_id: savedProjectId ?? null,
        },
        session.access_token,
      )
      const w = finishApplied ? finishW : (contentBounds?.width_inches ?? lastSettings.width_inches)
      const h = finishApplied ? finishH : (contentBounds?.height_inches ?? lastSettings.height_inches)
      setCheckoutClientSecret(client_secret)
    } catch (err) {
      setPrintCheckoutError(err instanceof Error ? err.message : 'Could not start checkout.')
    } finally {
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
          Settings changed. Waiting for the stitch preview to refresh before saving or finalizing.
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
      isLoggedIn={!!user}
      onSignIn={() => setAuthPrompt('login')}
    />
  )

  const hasCanvasEdits = undoStack.length > 0 || Object.keys(manualCellOverrides).length > 0
  const settingsGuardActive = hasCanvasEdits && !settingsGuardAccepted

  const settingsPanel = (
    <div
      data-tutorial="design-settings"
      style={{
        display: 'grid',
        gap: isMobile ? 11 : 9,
        width: '100%',
        minWidth: 0,
        minHeight: isMobile ? 'auto' : 286,
        alignContent: 'start',
        padding: isMobile ? '14px 14px 16px' : '14px 12px 16px',
        boxSizing: 'border-box',
        overflow: 'visible',
        border: '1px solid #d9d9d9',
        borderRadius: 8,
        background: '#fbfbfb',
        boxShadow: '0 8px 24px rgba(0,0,0,0.04)',
        position: 'relative',
      }}
    >
      {settingsGuardActive && (
        <div
          onClick={() => setShowSettingsGuardModal(true)}
          title="This canvas has edits — click for details"
          style={{ position: 'absolute', inset: 0, zIndex: 5, cursor: 'pointer', borderRadius: 8 }}
        />
      )}
      <div style={{ display: 'grid', gap: 2 }}>
        <h2 style={{ margin: 0, fontSize: 13 }}>Size and Settings</h2>
      </div>

      {isBeltCanvas ? (
        <BeltControls
          settings={draftSettings}
          compact={isMobile}
          onSettingsChange={setDraftSettings}
        />
      ) : (
        <PreviewControls
          importedAspectRatio={importedAspectRatio}
          settings={draftSettings}
          lockAspectRatio={lockAspectRatio}
          isBlankCanvas={isBlankCanvas}
          canResizeBlankCanvas={canResizeBlankCanvas}
          compact={isMobile}
          onSettingsChange={setDraftSettings}
          onLockAspectRatioChange={setLockAspectRatio}
          onDimensionClamped={() => {
            setDimensionLimitHit(true)
            setTimeout(() => setDimensionLimitHit(false), 3000)
          }}
        />
      )}
      <label
        style={{
          display: 'flex',
          gap: 7,
          alignItems: 'flex-start',
          paddingTop: 2,
          fontSize: isMobile ? 13 : 12,
          lineHeight: isMobile ? 1.2 : 1.1,
          color: '#3f382f',
          opacity: isBlankCanvas ? 0.4 : 1,
          pointerEvents: isBlankCanvas ? 'none' : undefined,
          minWidth: 0,
        }}
      >
        <input
          type="checkbox"
          checked={draftSettings.clean_background}
          onChange={(event) => updateSettings({ clean_background: event.target.checked })}
          style={{ flexShrink: 0, marginTop: 1 }}
        />
        <span style={{ minWidth: 0, whiteSpace: 'normal' }}>Exclude blank canvas</span>
      </label>
    </div>
  )

  const paletteReductionPanel = hasGeneratedPreview && allPalette.length > 2 && (
    <div
      data-tutorial="palette-slider"
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
  const finishW = finishShape === 'circle' ? resolvedFinishSize : Math.min(resolvedFinishSize, designWidthInches)
  const finishH = finishShape === 'circle' ? resolvedFinishSize : Math.min(resolvedFinishSize, designHeightInches)
  const workflowSteps = [
    { id: 1 as const, label: 'Upload', complete: Boolean(activeImagePath) || cells.length > 0 },
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
    // A resize (or any other draftSettings change) rebuilds `cells` on a
    // 250ms debounce (see the effect that derives newW/newH from
    // draftSettings). Saving before that settles sends the *new*
    // width_inches/height_inches alongside the *stale*, still-old-sized
    // cells grid — the mismatch this guards against is exactly what made
    // the roll print (which derives its physical size from cells, not the
    // stored width/height) come out at the pre-resize dimensions.
    // handleFinalize already guards on this same flag; mirror it here.
    if (hasPendingPreviewSettings) return
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
        parent_gallery_item_id: parentGalleryItemId ?? null,
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
      markCurrentDesignClean()
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
      width_inches: Math.round((maxCol - minCol + 1) / lastSettings.mesh_count * 100) / 100,
      height_inches: Math.round((maxRow - minRow + 1) / lastSettings.mesh_count * 100) / 100,
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
        gap: isMobile ? 8 : 18,
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: isPhoneCanvasLandscape ? '3px 10px' : isMobile ? '8px 12px' : '10px 14px',
        borderBottom: '1px solid #e8e4db',
        background: '#fffdf8',
        flexWrap: 'wrap',
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', gap: isMobile ? 10 : 18, alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
        {!isPhoneCanvasLandscape && (
          <div>
            <div style={{ fontSize: 10, letterSpacing: 1.5, color: '#8b8377', fontWeight: 700 }}>DESIGN</div>
            <strong style={{ fontSize: 13 }}>{previewDesignLabel}</strong>
          </div>
        )}
        {!isMobile && (
          <>
            <div>
              <div style={{ fontSize: 10, letterSpacing: 1.5, color: '#8b8377', fontWeight: 700 }}>SUGGESTED CANVAS</div>
              <strong style={{ fontSize: 13 }}>
                {previewStatsSettings
                  ? (() => {
                      const w = contentBounds?.width_inches ?? previewStatsSettings.width_inches
                      const h = contentBounds?.height_inches ?? previewStatsSettings.height_inches
                      return getCanvasForDesign(w, h).label
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
          </>
        )}
        {isMobile && !isPhoneCanvasLandscape && previewStatsSettings && (
          <div style={{ fontSize: 12, color: '#8a8177' }}>
            {previewStitchesLabel} stitches · {previewMeshLabel}
          </div>
        )}
        {isPhoneCanvasLandscape && previewStatsSettings && (
          <div style={{ fontSize: 11, color: '#8a8177' }}>
            {previewStitchesLabel} · {previewMeshLabel}
          </div>
        )}
      </div>

      {isPhoneDevice && !isLandscapeOrientation ? (
        <span style={{ fontSize: 11, color: '#8a8177', fontWeight: 600, whiteSpace: 'nowrap' }}>
          ↻ Rotate to landscape to expand
        </span>
      ) : !isPhoneCanvasLandscape ? (
        <button
          type="button"
          onClick={() => setIsPreviewExpanded((current) => !current)}
          style={{
            ...(isPreviewExpanded ? btnSecondary : btnPrimary),
            fontSize: isMobile ? 12 : 13,
            padding: isMobile ? '6px 10px' : '8px 14px',
          }}
        >
          {isPreviewExpanded ? 'Collapse' : 'Expand'}
        </button>
      ) : null}
    </div>
  )

  // Two separate questions: can the roll print it at all, and can it be bought
  // self-serve. A design can be printable and still need a hand-quoted shipping
  // cost — see isStandardOrder. Measured off the cropped content bounds when we
  // have them, since that's what actually gets printed.
  const sizedWidthInches = contentBounds?.width_inches ?? designWidthInches
  const sizedHeightInches = contentBounds?.height_inches ?? designHeightInches
  const printableSize = isDesignPrintable(sizedWidthInches, sizedHeightInches)
  const orderableSize = printableSize && isStandardOrder(sizedWidthInches, sizedHeightInches)

  const leftPanelContent = (() => {
    if (activeWorkflowStep === 1) {
      return (
        <>
          <div>
            {beltEntryMode && (
              <button
                type="button"
                onClick={() => setBeltEntryMode(false)}
                style={{
                  border: 'none',
                  background: 'none',
                  padding: 0,
                  marginBottom: 10,
                  color: '#8a8177',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                ← Back
              </button>
            )}
            <h2 style={{ margin: 0, fontSize: 28, lineHeight: 1.05, fontWeight: 700 }}>
              {beltEntryMode ? 'Design a belt' : 'Upload'}
            </h2>
            <p style={{ margin: '8px 0 0', color: '#8a8177', fontSize: 15 }}>
              {beltEntryMode ? 'Start with a photo, or begin from a blank belt.' : 'Start with a photo, screenshot, or artwork file.'}
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
            data-tutorial="upload-zone"
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
            onDrop={(event) => void handleStagedUploadDrop(event, beltEntryMode)}
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
            {/* Native <label> activation: JS input.click() is silently ignored
                in installed-PWA WebKit, so the input lives inside the label. */}
            <label
              role="button"
              tabIndex={0}
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
              <input
                ref={stagedUploadInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void handleChatUpload(file, beltEntryMode)
                  event.target.value = ''
                }}
              />
              <strong style={{ color: '#3f382f', fontSize: 18 }}>{isMobile ? 'Tap to choose a photo' : 'Drop image file here'}</strong>
              {!isMobile && <span>or click to choose a file</span>}
            </label>
            {activeImagePath && <p style={{ margin: 0, color: '#5f7f5a' }}>Image loaded.</p>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, height: 1, background: '#e7e1d8' }} />
            <span style={{ fontSize: 12, color: '#a09890' }}>or</span>
            <div style={{ flex: 1, height: 1, background: '#e7e1d8' }} />
          </div>
          {beltEntryMode ? (
            <button
              type="button"
              onClick={handleStartBelt}
              disabled={loading}
              style={btnSecondary}
            >
              Start with a blank belt
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleStartFresh}
                disabled={loading}
                style={btnSecondary}
              >
                Start with a blank canvas
              </button>
              <button
                type="button"
                onClick={() => setBeltEntryMode(true)}
                disabled={loading}
                style={btnSecondary}
              >
                Design a belt
              </button>
              {/* Native <label> activation: JS input.click() is silently ignored
                  in installed-PWA WebKit, so the input lives inside the label. */}
              <label
                role="button"
                tabIndex={loading ? -1 : 0}
                aria-disabled={loading}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    patternImportInputRef.current?.click()
                  }
                }}
                style={{
                  ...btnSecondary,
                  display: 'block',
                  textAlign: 'center',
                  opacity: loading ? 0.6 : 1,
                  pointerEvents: loading ? 'none' : 'auto',
                }}
              >
                <input
                  ref={patternImportInputRef}
                  type="file"
                  accept="image/*,.stitchly"
                  hidden
                  disabled={loading}
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) void handlePatternImportFile(file)
                    event.target.value = ''
                  }}
                />
                Import from Stitchly (.stitchly or chart image)
              </label>
            </>
          )}
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
          {!showChatPanel && paletteReductionPanel}
          {settingsPanel}
          {activeImagePath && (
            <button
              type="button"
              onClick={() => applyPreviewInBackground(draftSettings)}
              disabled={loading}
              style={btnPrimary}
            >
              {hasGeneratedPreview ? 'Regenerate preview' : 'Generate stitch preview'}
            </button>
          )}
          {statusBlock}
          {isMobile && hasGeneratedPreview && currentDesignPalette.length > 0 && (
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#8a8177', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                Paint color
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                {currentDesignPalette.map((color) => {
                  const isActive = activePaintColor === color.hex
                  return (
                    <button
                      key={color.hex}
                      type="button"
                      title={`${color.dmc_code} ${color.dmc_name}`}
                      onClick={() => {
                        setActivePaintColor(color.hex)
                        setToolMode('paint')
                        setSelectedRegions([])
                      }}
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: '50%',
                        background: color.hex,
                        border: isActive ? '3px solid #3f382f' : color.hex === '#FFFFFF' ? '1px solid #ccc' : '2px solid rgba(0,0,0,0.15)',
                        boxShadow: isActive ? '0 0 0 2px #fff, 0 0 0 4px #3f382f' : undefined,
                        cursor: 'pointer',
                        flexShrink: 0,
                        padding: 0,
                      }}
                    />
                  )
                })}
                <button
                  type="button"
                  title="Eraser"
                  onClick={() => { setToolMode('paint'); setActivePaintColor(BLANK_CELL); setSelectedRegions([]) }}
                  style={{
                    width: 32, height: 32, borderRadius: '50%',
                    background: '#ebe6dd',
                    border: activePaintColor === BLANK_CELL ? '3px solid #3f382f' : '2px dashed #b5afa8',
                    boxShadow: activePaintColor === BLANK_CELL ? '0 0 0 2px #fff, 0 0 0 4px #3f382f' : undefined,
                    cursor: 'pointer', flexShrink: 0, padding: 0,
                    display: 'grid', placeItems: 'center',
                  }}
                >
                  <span style={{ fontSize: 11, color: '#8a8177', lineHeight: 1 }}>✕</span>
                </button>
              </div>
            </div>
          )}
          {hasGeneratedPreview && !finalPdfPath && (
            <button
              type="button"
              onClick={() => setActiveWorkflowStep(3)}
              disabled={!activeImagePath && undoStack.length === 0 && !hasStitchedContent}
              style={{ ...btnSecondary, opacity: !activeImagePath && undoStack.length === 0 && !hasStitchedContent ? 0.4 : 1 }}
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
          {parentGalleryItemId && (
            <div style={{ background: '#f0ece5', border: '1px solid #ddd5c8', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#5f574f' }}>
              Working from a gallery template · print includes 20% creator credit
            </div>
          )}
          {!orderableSize && (
            <p style={{ margin: 0, fontSize: 12, color: '#8a8177' }}>
              {printableSize ? LARGE_PRINT_MESSAGE : 'Print unavailable — design exceeds the maximum printable size.'}
            </p>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 8 }}>
            <button
              type="button"
              onClick={() => setShowPriceBreakdownModal(true)}
              disabled={!lastSettings || printCheckoutLoading || !orderableSize}
              style={{ ...btnSecondary, opacity: (!lastSettings || !orderableSize) ? 0.55 : 1, cursor: (!lastSettings || !orderableSize) ? 'not-allowed' : 'pointer' }}
            >
              {orderableSize ? 'Review order' : 'Contact us for large prints'}
            </button>
            <button
              type="button"
              onClick={openGalleryPublishModal}
              disabled={!orderableSize}
              title={orderableSize ? undefined : LARGE_PRINT_MESSAGE}
              style={{ ...btnSecondary, opacity: orderableSize ? 1 : 0.55, cursor: orderableSize ? 'pointer' : 'not-allowed' }}
            >
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
            <div><strong>Canvas:</strong> {getCanvasForDesign(
              finishApplied ? finishW : (contentBounds?.width_inches ?? designWidthInches),
              finishApplied ? finishH : (contentBounds?.height_inches ?? designHeightInches),
            ).label}</div>
          </div>
          <div style={{ color: '#8a8177', lineHeight: 1.35 }}>
            {`${getCanvasForDesign(
              finishApplied ? finishW : (contentBounds?.width_inches ?? designWidthInches),
              finishApplied ? finishH : (contentBounds?.height_inches ?? designHeightInches),
            ).label} canvas with 2" working border on each side.`}
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
          <strong>SKU (optional)</strong>
          <div style={{ color: '#8a8177', lineHeight: 1.35 }}>
            Printed in the bottom-left corner of this project's canvas — separate from your signature, which prints bottom-right.
          </div>
          {!session?.access_token || !activeDraftProjectId ? (
            <div style={{ color: '#8a8177' }}>Save a draft first to add a SKU.</div>
          ) : skuUrl && !redrawingSku ? (
            <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={skuUrl}
                alt="Project SKU"
                style={{ maxWidth: 200, maxHeight: 100, border: '1px solid #d7d0c8', borderRadius: 8, background: '#fffdf8' }}
              />
              <button type="button" onClick={() => setRedrawingSku(true)} style={btnSecondary}>
                Redraw
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ display: 'inline-flex', border: '1px solid #d7d0c8', borderRadius: 999, padding: 3, width: 'fit-content' }}>
                {(['draw', 'pixel'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setSkuMode(mode)}
                    style={{
                      padding: '5px 14px',
                      borderRadius: 999,
                      border: 'none',
                      fontFamily: 'inherit',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                      background: skuMode === mode ? '#3f382f' : 'transparent',
                      color: skuMode === mode ? '#fff' : '#8a8177',
                    }}
                  >
                    {mode === 'draw' ? 'Draw' : 'Pixel'}
                  </button>
                ))}
              </div>
              {skuMode === 'draw' ? (
                <SignaturePad onSave={handleSaveSku} saving={savingSku} />
              ) : (
                <SignatureGridEditor onSave={handleSaveSku} saving={savingSku} />
              )}
            </div>
          )}
          {skuError && <p style={{ margin: 0, fontSize: 13, color: '#b0453a' }}>{skuError}</p>}
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

  const palettePanelElement = (
    <PalettePanel
      scrollWholePanel={isPhoneCanvasLandscape}
      colors={displayPalette}
      activeDesignColors={currentDesignPalette}
      selectionColors={selectedRegionColors}
      activeColor={activePaintColor}
      colorCountsByHex={displayColorCounts}
      toolMode={toolMode}
      onToolModeChange={(mode) => {
        setToolMode(mode as 'paint' | 'select' | 'shape' | 'merge' | 'text' | 'eyedropper' | 'fill')
        if (mode !== 'select') setSelectedRegions([])
        if (mode === 'select') setActivePaintColor(null)
      }}
      textFontSize={textFontSize}
      onTextFontSizeChange={setTextFontSize}
      textFontFamily={textFontFamily}
      onTextFontFamilyChange={handleTextFontFamilyChange}
      textOrientation={textOrientation}
      onTextOrientationChange={setTextOrientation}
      textBold={textBold}
      onTextBoldChange={setTextBold}
      textItalic={textItalic}
      onTextItalicChange={setTextItalic}
      textOutline={textOutline}
      onTextOutlineChange={setTextOutline}
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
      onApplyColorToSelection={handleApplyColorToSelection}
      onClearSelection={handleClearSelection}
      hasClipboard={Boolean(stampClipboard)}
      hasFloatingStamp={Boolean(floatingStamp)}
      isImportPickerOpen={showImportProjectPicker}
      onCutSelection={handleCutSelection}
      onCopySelection={handleCopySelection}
      onPasteClipboard={() => handlePasteClipboard()}
      onImportProject={handleOpenImportProjectPicker}
      onStampNudge={handleStampNudge}
      onRotateStamp={handleRotateStamp}
      onFlipStamp={handleFlipStamp}
      onPlaceStamp={handlePlaceStamp}
      onCancelStamp={handleCancelStamp}
      hasActiveTextBox={hasActiveTextBox}
      onPlaceText={() => setPlaceTextSignal((v) => v + 1)}
      onCancelText={() => setCancelTextSignal((v) => v + 1)}
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
      onOpenAddBrowser={() => { setColorBrowserTarget('add'); openColorBrowser() }}
      onOpenSwapBrowser={() => { setColorBrowserTarget('swap'); openColorBrowser() }}
      onOpenFillBrowser={() => { setColorBrowserTarget('fill'); openColorBrowser() }}
      onOpenBorderBrowser={() => { setColorBrowserTarget('border'); openColorBrowser() }}
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
  )

  const NAV_HEIGHT = 70
  const hideTopChrome = isPhoneCanvasLandscape
  const topOffset = hideTopChrome ? 0 : NAV_HEIGHT

  return (
    <main
      style={{
        display: 'grid',
        gridTemplateRows: isMobile ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) auto',
        minHeight: '100dvh',
        height: '100dvh',
        paddingTop: topOffset,
        overflow: 'hidden',
        boxSizing: 'border-box',
        width: '100%',
        background: '#f5f1ea',
        color: '#3f382f',
        isolation: 'isolate',
      }}
    >
      {!hideTopChrome && (
      <nav
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 18,
          padding: isMobile ? '0 14px' : '0 28px',
          borderBottom: '1px solid #5c7856',
          background: '#6e8d67',
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: NAV_HEIGHT,
          boxSizing: 'border-box',
          zIndex: 10000,
          pointerEvents: 'auto',
          overflow: 'visible',
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
                    border: '2px solid #fffdf8',
                    borderRadius: 2,
                    boxSizing: 'border-box',
                  }}
                />
              ))}
            </div>
            <strong style={{ fontSize: 22, color: '#fffdf8', whiteSpace: 'nowrap' }}>MNS Studio</strong>
          </button>
          {!isMobile && (
            <>
              <span style={{ color: 'rgba(255,255,255,0.5)', margin: '0 6px' }}>|</span>
              <div style={{ display: 'flex', gap: 24, color: '#fffdf8', fontWeight: 600, whiteSpace: 'nowrap' }}>
                <button
                  type="button"
                  onClick={() => navigateAwayFromStudio('/gallery')}
                  style={{ border: 0, background: 'transparent', font: 'inherit', color: 'rgba(255,255,255,0.86)', padding: 0, cursor: 'pointer', fontWeight: 600 }}
                >
                  Gallery
                </button>
                <button
                  type="button"
                  onClick={() => navigateAwayFromStudio('/drafts')}
                  style={{ border: 0, background: 'transparent', font: 'inherit', color: 'rgba(255,255,255,0.86)', padding: 0, cursor: 'pointer', fontWeight: 600 }}
                >
                  Your Studio
                </button>
                <span style={{ color: '#fffdf8', fontWeight: 700 }}>Active Canvas</span>
              </div>
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: isMobile ? 8 : 12, alignItems: 'center', flexShrink: 0 }}>
          <button
            type="button"
            onClick={tutorial.open}
            aria-label="Show tutorial"
            title="Tutorial"
            style={{ border: '1px solid #d7d0c8', borderRadius: '50%', width: 30, height: 30, padding: 0, lineHeight: 1, background: '#fffdf8', cursor: 'pointer', fontSize: 15, fontWeight: 700, color: '#6e8d67', display: 'grid', placeItems: 'center', flexShrink: 0 }}
          >?</button>
          <button
            type="button"
            onClick={() => setShowCartDrawer(true)}
            aria-label="Open cart"
            title="Cart"
            style={{ position: 'relative', border: '1px solid #d7d0c8', borderRadius: '50%', width: 30, height: 30, padding: 0, lineHeight: 1, background: '#fffdf8', cursor: 'pointer', fontSize: 15, display: 'grid', placeItems: 'center', flexShrink: 0 }}
          >
            🛒
            {cartCount > 0 && (
              <span style={{ position: 'absolute', top: -4, right: -4, background: '#4a7244', color: '#fff', borderRadius: '50%', width: 16, height: 16, fontSize: 10, fontWeight: 700, display: 'grid', placeItems: 'center' }}>{cartCount}</span>
            )}
          </button>
          {!session && (
            <button type="button" onClick={() => setAuthPrompt('login')} style={{ ...btnSecondary, fontSize: isMobile ? 12 : 13, padding: isMobile ? '6px 10px' : '8px 13px' }}>
              Log in
            </button>
          )}
          <NavAccountControls
            user={user}
            onProfile={() => void handleViewProfile()}
            onLogout={() => setShowLogoutConfirm(true)}
            onAdmin={() => navigateAwayFromStudio('/admin')}
            onNavigate={navigateAwayFromStudio}
            pendingCents={pendingCents}
          />
        </div>
      </nav>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isPhoneCanvasLandscape
            ? 'minmax(0, 1fr) minmax(200px, 260px)'
            : isMobile ? '1fr'
            : isPreviewExpanded && activeWorkflowStep === 2
              ? 'minmax(0, 1fr) minmax(240px, 280px)'
              : isPreviewExpanded
                ? 'minmax(0, 1fr)'
                : activeWorkflowStep === 2
                  ? 'minmax(240px, 340px) minmax(0, 1fr) minmax(240px, 280px)'
                  : 'minmax(240px, 340px) minmax(0, 1fr)',
          minHeight: 0,
          overflow: 'hidden',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {!isPreviewExpanded && !isPhoneCanvasLandscape && (() => {
          const mobileDrawer = isMobile && activeWorkflowStep === 2
          const asideContent = (
            <>
              <div data-tutorial="workflow-steps" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', alignItems: 'center', borderBottom: '1px solid #eee8df' }}>
                {workflowSteps.map((step) => {
                  const active = activeWorkflowStep === step.id
                  const locked = Boolean(finalPdfPath) && step.id < 3
                  return (
                    <button
                      key={step.id}
                      type="button"
                      onClick={() => { if (!locked) { setActiveWorkflowStep(step.id); if (mobileDrawer && step.id !== 2) setShowMobilePanel(false) } }}
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
              <div style={{ minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                {showChatPanel && !isMobile && (
                  <>
                    {paletteReductionPanel && (
                      <div style={{ padding: '10px 10px 0', flexShrink: 0 }}>
                        {paletteReductionPanel}
                      </div>
                    )}
                    <div style={{ flex: 1, minHeight: 0, padding: 10, paddingTop: paletteReductionPanel ? 6 : 10, display: 'flex', flexDirection: 'column' }}>
                      {chatPanel}
                    </div>
                  </>
                )}
                <div
                  style={{
                    display: showChatPanel && !isMobile ? 'none' : 'grid',
                    gap: activeWorkflowStep === 2 ? (isMobile ? 10 : 14) : isMobile ? 14 : 22,
                    alignContent: 'start',
                    padding: activeWorkflowStep === 2 ? (isMobile ? 12 : 18) : isMobile ? 14 : 24,
                    flex: 1,
                    overflow: 'auto',
                    WebkitOverflowScrolling: 'touch',
                    boxSizing: 'border-box',
                  }}
                >
                  {leftPanelContent}
                </div>
              </div>
              <div style={{ padding: isMobile ? '10px 14px' : '12px 24px', paddingBottom: isMobile ? 'max(10px, env(safe-area-inset-bottom, 10px))' : '12px', borderTop: '1px solid #eee8df', display: 'grid', gap: 8 }}>
                {!isMobile && (
                  <button
                    type="button"
                    onClick={() => setShowChatPanel((v) => !v)}
                    style={{
                      ...btnSecondary,
                      width: '100%',
                      background: showChatPanel ? '#e5eee2' : undefined,
                      borderColor: showChatPanel ? '#8aad83' : undefined,
                      color: showChatPanel ? '#3e6438' : undefined,
                    }}
                  >
                    {showChatPanel ? 'Close MNS Pro' : 'Open MNS Pro'}
                  </button>
                )}
                <button
                  data-tutorial="save-button"
                  type="button"
                  onClick={() => {
                    if (!session?.access_token) { setAuthPrompt('save'); return }
                    void handleSaveDraft()
                  }}
                  disabled={(!activeImagePath && !isBlankCanvas) || saveStatus === 'saving' || hasPendingPreviewSettings}
                  style={{ ...btnSecondary, width: '100%', opacity: (!activeImagePath && !isBlankCanvas) ? 0.5 : 1 }}
                >
                  {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved ✓' : saveStatus === 'limit' ? 'Limit reached' : saveStatus === 'error' ? 'Error saving' : 'Save Draft'}
                </button>
              </div>
            </>
          )

          if (mobileDrawer) {
            const showToolsTab = shouldShowStitchGrid
            const activeSheetTab = showToolsTab ? mobileSheetTab : 'design'
            return (
              <MobileSheet open={showMobilePanel} onClose={() => setShowMobilePanel(false)}>
                {showToolsTab && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3, padding: '2px 14px 10px', position: 'sticky', top: 0, background: '#fffdf8', zIndex: 2 }}>
                    {(['tools', 'design'] as const).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setMobileSheetTab(tab)}
                        style={{
                          padding: '10px 0',
                          borderRadius: 999,
                          border: '1px solid #d7d0c8',
                          background: activeSheetTab === tab ? '#3f382f' : '#fff',
                          color: activeSheetTab === tab ? '#fff' : '#6f665b',
                          fontFamily: 'inherit',
                          fontSize: 13,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {tab === 'tools' ? 'Tools & Colors' : 'Size & Design'}
                      </button>
                    ))}
                  </div>
                )}
                {activeSheetTab === 'tools' && showToolsTab ? (
                  <div style={{ height: '64vh', minHeight: 320, display: 'grid', padding: '0 12px 12px', boxSizing: 'border-box' }}>
                    {palettePanelElement}
                  </div>
                ) : (
                  asideContent
                )}
              </MobileSheet>
            )
          }

          return (
            <aside
              style={{
                display: 'grid',
                gridTemplateRows: 'auto minmax(0, 1fr) auto',
                borderRight: isMobile ? 'none' : '1px solid #e0d9cf',
                background: '#fffdf8',
                minWidth: 0,
                minHeight: 0,
                position: 'relative',
                zIndex: 30,
                pointerEvents: 'auto',
              }}
            >
              {asideContent}
            </aside>
          )
        })()}

        <section
          data-tutorial="canvas-section"
          style={{
            display: isMobile && activeWorkflowStep !== 2 ? 'none' : 'grid',
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

          <div style={{ display: 'flex', minHeight: 0, overflow: 'hidden', position: 'relative' }}>
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
                  centerKey={gridKey}
                  signatureUrl={signatureUrl}
                  skuUrl={skuUrl}
                  isPhoneLandscape={isPhoneCanvasLandscape}
                  traceImageUrl={activeImagePath ? assetUrl(activeImagePath) : null}
                  traceOpacity={traceOpacity}
                  onTraceOpacityChange={setTraceOpacity}
                  placeTextSignal={placeTextSignal}
                  cancelTextSignal={cancelTextSignal}
                  onTextBoxActiveChange={setHasActiveTextBox}
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
                  textFontSize={textFontSize}
                  textFontFamily={textFontFamily}
                  textOrientation={textOrientation}
                  textBold={textBold}
                  textItalic={textItalic}
                  textOutline={textOutline}
                  onPaintStart={pushUndoSnapshot}
                  onPaintCells={toolMode === 'merge' ? handleMergeCells : handlePaintCells}
                  onFillCell={handleFillCell}
                  onApplyShapeCells={handleApplyShapeCells}
                  onEyedropperSample={handleEyedropperSample}
                  floatingStamp={floatingStamp}
                  onStampMove={handleStampMove}
                  clearSelectionSignal={clearSelectionSignal}
                  canvasOverlay={showColorBrowser && activeWorkflowStep === 2 && !isFinalizeReview && (
                    // Rendered inside GridEditor's own canvas row (below its
                    // toolbar) via the canvasOverlay prop — top: 0 here means
                    // the top of that row, i.e. right under the toolbar, not
                    // the top of the whole component. No manual height/offset
                    // math needed; the grid row boundary does it for free.
                    <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, zIndex: 10, display: 'flex' }}>
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
                            closeColorBrowser()
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
                              closeColorBrowser()
                            } else if (colorBrowserTarget === 'add') {
                              setShowColorBrowser(true)
                            } else {
                              closeColorBrowser()
                            }
                          }
                        }}
                        onClose={closeColorBrowser}
                      />
                    </div>
                  )}
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
                  <span style={{ fontSize: 12, color: '#7a6e63', fontWeight: 500 }}>Rendering…</span>
                </div>
              </div>
            )}
          </div>
          <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>

          </div>

          {isPhoneCanvasLandscape && !isFinalizeReview && (
            <div style={{ position: 'absolute', bottom: 10, left: 20, display: 'flex', gap: 6, zIndex: 35, pointerEvents: 'auto' }}>
              <button
                type="button"
                onClick={handleUndoColorChange}
                disabled={!undoStack.length}
                aria-label="Undo"
                style={{ width: 34, height: 34, borderRadius: '50%', border: '1px solid #d7d0c8', background: 'rgba(255,253,248,0.92)', boxShadow: '0 2px 8px rgba(0,0,0,0.18)', fontSize: 16, cursor: 'pointer', display: 'grid', placeItems: 'center', opacity: undoStack.length ? 1 : 0.4 }}
              >↺</button>
              <button
                type="button"
                onClick={handleRedoColorChange}
                disabled={!redoStack.length}
                aria-label="Redo"
                style={{ width: 34, height: 34, borderRadius: '50%', border: '1px solid #d7d0c8', background: 'rgba(255,253,248,0.92)', boxShadow: '0 2px 8px rgba(0,0,0,0.18)', fontSize: 16, cursor: 'pointer', display: 'grid', placeItems: 'center', opacity: redoStack.length ? 1 : 0.4 }}
              >↻</button>
            </div>
          )}

          {!isFinalizeReview && !isPhoneCanvasLandscape && (
            isMobile ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', paddingBottom: 'max(8px, env(safe-area-inset-bottom, 8px))', borderTop: '1px solid #ded8cf', background: '#fffdf8', zIndex: 35, pointerEvents: 'auto' }}>
                {activePaintColor && (
                  <div style={{
                    width: 24, height: 24, borderRadius: '50%',
                    background: activePaintColor === BLANK_CELL ? '#ebe6dd' : activePaintColor,
                    border: activePaintColor === BLANK_CELL ? '2px dashed #b5afa8' : '2px solid rgba(0,0,0,0.18)',
                    flexShrink: 0, display: 'grid', placeItems: 'center',
                  }}>
                    {activePaintColor === BLANK_CELL && <span style={{ fontSize: 10, color: '#8a8177', lineHeight: 1 }}>✕</span>}
                  </div>
                )}
                <button type="button" onClick={handleUndoColorChange} disabled={!undoStack.length} style={{ ...btnSecondary, fontSize: 12, padding: '5px 10px' }}>Undo</button>
                <button type="button" onClick={handleRedoColorChange} disabled={!redoStack.length} style={{ ...btnSecondary, fontSize: 12, padding: '5px 10px' }}>Redo</button>
                <div style={{ flex: 1 }} />
                <button type="button" onClick={() => setShowMobilePanel(true)} style={{ ...btnSecondary, fontSize: 12, padding: '5px 12px', fontWeight: 700 }}>⚙ Tools</button>
              </div>
            ) : (
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
                <button type="button" onClick={handleUndoColorChange} disabled={!undoStack.length} style={btnSecondary}>Undo</button>
                <button type="button" onClick={handleRedoColorChange} disabled={!redoStack.length} style={btnSecondary}>Redo</button>
                <button type="button" onClick={() => setShowResetConfirm(true)} disabled={!originalCells.length} style={btnSecondary}>Reset</button>
              </div>
            )
          )}
        </section>

        {/* Rendered as a sibling of <section>, not nested inside it — the section
            establishes its own stacking context (position:relative + zIndex:0), which
            would trap this dialog behind the palette <aside> (zIndex:30) regardless of
            the dialog's own zIndex, since a descendant's z-index can never outrank an
            ancestor's stacking context from outside it. */}
        {showImportProjectPicker && (
          <div
            role="dialog"
            aria-modal="true"
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 10025, padding: 18 }}
            onClick={() => setShowImportProjectPicker(false)}
          >
            <div
              onClick={(event) => event.stopPropagation()}
              style={{ background: '#fffdf8', padding: 24, borderRadius: 12, width: 480, maxWidth: '100%', maxHeight: '80vh', display: 'grid', gridTemplateRows: 'auto 1fr', gap: 14, boxSizing: 'border-box' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ display: 'grid', gap: 4 }}>
                  <h2 style={{ margin: 0 }}>Import a saved project</h2>
                  <p style={{ margin: 0, color: '#8a8177', fontSize: 13 }}>Pick a design to drop onto this canvas — you can move, rotate, and flip it before placing.</p>
                </div>
                <button type="button" onClick={() => setShowImportProjectPicker(false)} style={{ border: 0, background: 'transparent', cursor: 'pointer', fontSize: 16, color: '#7f776d', lineHeight: 1, padding: 4 }}>✕</button>
              </div>
              <div style={{ overflow: 'auto', minHeight: 0 }}>
                {importProjectsLoading ? (
                  <p style={{ margin: 0, color: '#8a8177', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>Loading your projects…</p>
                ) : importProjectsError ? (
                  <p style={{ margin: 0, color: '#b0453a', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>{importProjectsError}</p>
                ) : !importableProjects || importableProjects.length === 0 ? (
                  <p style={{ margin: 0, color: '#8a8177', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>No other saved projects yet.</p>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                    {importableProjects.map((project) => {
                      const thumbnailUrl = project.preview_image_url
                        ? project.preview_image_url.startsWith('http')
                          ? project.preview_image_url
                          : assetUrl(project.preview_image_url)
                        : null
                      return (
                        <button
                          key={project.id}
                          type="button"
                          onClick={() => handleImportProject(project)}
                          title={project.name}
                          style={{ display: 'grid', gap: 5, border: '1px solid #e0d8cf', borderRadius: 8, padding: 6, background: '#fff', cursor: 'pointer', textAlign: 'left' }}
                        >
                          <div style={{ width: '100%', aspectRatio: '1', borderRadius: 5, overflow: 'hidden', background: '#f8f4ec', display: 'grid', placeItems: 'center' }}>
                            {thumbnailUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={thumbnailUrl} alt={project.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                            ) : (
                              <span style={{ fontSize: 10, color: '#b0a89e' }}>No preview</span>
                            )}
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 600, color: '#3f382f', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{project.name}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {(!isMobile || isPhoneCanvasLandscape) && activeWorkflowStep === 2 && !isFinalizeReview && (
          <aside
            data-tutorial="palette-panel"
            style={{
              display: 'grid',
              gridTemplateRows: 'minmax(0, 1fr)',
              borderLeft: '1px solid #e0d9cf',
              background: '#fffdf8',
              minWidth: 0,
              minHeight: 0,
              overflowX: 'hidden',
              overflowY: 'auto',
              WebkitOverflowScrolling: 'touch',
              padding: '14px 12px',
              boxSizing: 'border-box',
              position: 'relative',
              zIndex: 30,
              pointerEvents: 'auto',
            }}
          >
            {palettePanelElement}
          </aside>
        )}
      </div>


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
            zIndex: 10080,
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
            zIndex: 10031,
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
              {hasUnsavedChanges ? (
                <p style={{ margin: 0, color: '#8a8177', fontSize: 14 }}>
                  This canvas has changes that have not been saved. Save the draft first, or log out and lose those changes.
                </p>
              ) : (
                <p style={{ margin: 0, color: '#8a8177', fontSize: 14 }}>
                  You will need to log back in to save drafts, finalize designs, or post to the gallery.
                </p>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setShowLogoutConfirm(false)} style={btnSecondary}>
                Cancel
              </button>
              {hasUnsavedChanges && (
                <button
                  type="button"
                  onClick={() => {
                    setShowLogoutConfirm(false)
                    void handleSaveDraft()
                  }}
                  style={btnSecondary}
                >
                  Save draft
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  void handleLogoutAndReturnToGallery()
                }}
                style={{ ...btnPrimary, background: '#a03428', borderColor: '#a03428' }}
              >
                Log out anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {showPostFinalizeOptions && (() => {
        const designW = contentBounds?.width_inches ?? lastSettings?.width_inches ?? 0
        const designH = contentBounds?.height_inches ?? lastSettings?.height_inches ?? 0
        const printable = isDesignPrintable(designW, designH)
        const canvas = lastSettings ? getCanvasForDesign(designW, designH) : null
        const printTotal = canvas
          ? (parentGalleryItemId ? printGalleryTotalCents(canvas) : printOwnTotalCents(canvas))
          : null
        return (
          <div
            role="dialog"
            aria-modal="true"
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'grid', placeItems: 'center', zIndex: 10025, padding: 18 }}
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
                  {!printable ? (
                    <p style={{ margin: 0, fontSize: 12, color: '#8a8177' }}>Print unavailable — design exceeds max 6″×10″ (8×12 canvas).</p>
                  ) : canvas && printTotal !== null ? (
                    <div style={{ fontSize: 13, color: '#5f574f' }}>
                      <div>{canvas.label} canvas</div>
                      <div style={{ fontWeight: 700, fontSize: 16, marginTop: 4 }}>{formatCents(printTotal)}</div>
                      <div style={{ fontSize: 11, color: '#8a8177', marginTop: 2 }}>+ $7.00 shipping</div>
                      {parentGalleryItemId && (
                        <div style={{ fontSize: 11, color: '#8a8177', marginTop: 3 }}>Includes 20% creator credit</div>
                      )}
                    </div>
                  ) : null}
                  {printCheckoutError && <p style={{ margin: 0, fontSize: 12, color: '#b0453a' }}>{printCheckoutError}</p>}
                  <button
                    type="button"
                    onClick={() => setShowPriceBreakdownModal(true)}
                    disabled={!canvas || !printable || printCheckoutLoading}
                    style={{ ...btnPrimary, opacity: (!canvas || !printable) ? 0.5 : 1, cursor: (!canvas || !printable) ? 'not-allowed' : 'pointer' }}
                  >
                    Review order
                  </button>
                </div>

                <div style={{ padding: '20px 20px 20px', display: 'grid', gap: 12, alignContent: 'start' }}>
                  <div>
                    <strong style={{ fontSize: 15 }}>Share to gallery</strong>
                    <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6f675f', lineHeight: 1.4 }}>
                      Let the MNS community see your work. If someone buys your design, earn 20% of the sale in canvas credit!
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
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 10025, padding: 18 }}
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
                    autoFocus={!isTouchDevice}
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
            zIndex: 10020,
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
              autoFocus={!isTouchDevice}
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
            zIndex: 10100,
            padding: 18,
          }}
        >
          <div
            style={{
              background: '#fffdf8',
              padding: 24,
              borderRadius: 12,
              width: 360,
              maxWidth: 'calc(100vw - 32px)',
              boxSizing: 'border-box',
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
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'grid', placeItems: 'center', zIndex: 10100, padding: 18 }}
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

      {showResetConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'grid', placeItems: 'center', zIndex: 10100, padding: 18 }}
        >
          <div style={{ background: '#fffdf8', borderRadius: 12, width: 420, maxWidth: '100%', display: 'grid', gap: 16, padding: '24px', boxSizing: 'border-box', border: '1px solid #e7e1d8' }}>
            <div style={{ display: 'grid', gap: 6 }}>
              <h2 style={{ margin: 0, fontSize: 20 }}>Reset all color changes?</h2>
              <p style={{ margin: 0, color: '#6f675f', fontSize: 14, lineHeight: 1.5 }}>
                This reverts every paint, fill, and palette edit back to the original design. Undo history will be cleared and this can't be undone.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                style={btnSecondary}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { handleResetColorChanges(); setShowResetConfirm(false) }}
                style={btnPrimary}
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      )}

      {showPriceBreakdownModal && (() => {
        const bW = finishApplied ? finishW : (contentBounds?.width_inches ?? lastSettings?.width_inches ?? 0)
        const bH = finishApplied ? finishH : (contentBounds?.height_inches ?? lastSettings?.height_inches ?? 0)
        const bCanvas = lastSettings ? getCanvasForDesign(bW, bH) : null
        const bShipping = 700
        // Everything above the canvas material charge: the print-own base fee,
        // plus the creator markup when this is a gallery remix.
        const bBase = bCanvas
          ? (parentGalleryItemId ? printGalleryTotalCents(bCanvas) : printOwnTotalCents(bCanvas)) - bCanvas.priceCents
          : 0
        const bTotal = bCanvas ? bBase + bCanvas.priceCents + bShipping : null
        return (
          <div
            role="dialog"
            aria-modal="true"
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'grid', placeItems: 'center', zIndex: 10030, padding: 18 }}
          >
            <div style={{ background: '#fffdf8', borderRadius: 14, width: 380, maxWidth: '100%', boxSizing: 'border-box', overflow: 'hidden', border: '1px solid #e7e1d8', display: 'grid', gap: 0 }}>
              <div style={{ padding: '20px 22px 14px', borderBottom: '1px solid #e7e1d8' }}>
                <h2 style={{ margin: 0, fontSize: 18 }}>Order summary</h2>
                <p style={{ margin: '4px 0 0', color: '#8a8177', fontSize: 13 }}>Review before continuing to checkout.</p>
              </div>
              <div style={{ padding: '16px 22px', display: 'grid', gap: 10, fontSize: 14 }}>
                {bCanvas && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#5f574f' }}>{bCanvas.label} canvas</span>
                      <span>{formatCents(bCanvas.priceCents)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#5f574f' }}>Printing &amp; fulfillment</span>
                      <span>{formatCents(bBase)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#5f574f' }}>Shipping (Standard, 5–7 days)</span>
                      <span>{formatCents(bShipping)}</span>
                    </div>
                    {parentGalleryItemId && (
                      <div style={{ fontSize: 12, color: '#8a8177', borderTop: '1px solid #e7e1d8', paddingTop: 8 }}>
                        Includes 20% creator credit for the original designer
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 16, borderTop: '1px solid #e7e1d8', paddingTop: 10 }}>
                      <span>Total</span>
                      <span>{bTotal !== null ? formatCents(bTotal) : '—'}</span>
                    </div>
                  </>
                )}
                {printCheckoutError && <p style={{ margin: 0, fontSize: 12, color: '#b0453a' }}>{printCheckoutError}</p>}
              </div>
              <div style={{ padding: '12px 22px 18px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setShowPriceBreakdownModal(false)}
                  style={{ ...btnSecondary, textAlign: 'center' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!bCanvas || !lastSettings) return
                    cartAdd({
                      pdf_url: finalPdfPath ?? '',
                      internal_pdf_supabase_path: internalPdfSupabasePath ?? null,
                      width_inches: bW,
                      height_inches: bH,
                      quantity: 1,
                      title: bCanvas.label + ' canvas',
                      canvas_label: bCanvas.label,
                      canvas_price_cents: bCanvas.priceCents,
                      base_price_cents: bBase,
                      gallery_item_id: null,
                      parent_gallery_item_id: parentGalleryItemId,
                      project_id: savedProjectId,
                    })
                    setShowPriceBreakdownModal(false)
                    setShowCartDrawer(true)
                  }}
                  disabled={!bCanvas}
                  style={{ ...btnPrimary, opacity: !bCanvas ? 0.5 : 1, cursor: !bCanvas ? 'not-allowed' : 'pointer' }}
                >
                  Add to cart
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {checkoutClientSecret && (
        <CheckoutModal
          clientSecret={checkoutClientSecret}
          onClose={() => setCheckoutClientSecret(null)}
        />
      )}
      <OrderConfirmationModal open={showOrderConfirmation} onClose={() => setShowOrderConfirmation(false)} />
      <CartDrawer
        open={showCartDrawer}
        onClose={() => setShowCartDrawer(false)}
        accessToken={session?.access_token ?? null}
        onCheckoutReady={(secret) => setCheckoutClientSecret(secret)}
        pendingCents={pendingCents}
      />
      {saveStatus !== 'idle' && (
        <div style={{
          position: 'fixed',
          bottom: 28,
          right: 24,
          zIndex: 9998,
          background:
            saveStatus === 'saved' ? '#4a7244'
            : saveStatus === 'saving' ? '#6e8d67'
            : saveStatus === 'limit' ? '#8a6a2a'
            : '#a03428',
          color: '#fff',
          padding: '12px 18px',
          borderRadius: 10,
          fontSize: 14,
          fontWeight: 600,
          boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
          maxWidth: 'min(300px, calc(100vw - 48px))',
          lineHeight: 1.4,
          pointerEvents: 'none',
        }}>
          {saveStatus === 'saving' && 'Saving draft…'}
          {saveStatus === 'saved' && `"${draftName.trim() || 'Untitled'}" saved ✓`}
          {(saveStatus === 'error' || saveStatus === 'limit') && (draftSaveError || 'Error saving draft')}
        </div>
      )}
      {showPortraitWarning && (
        <div style={{
          position: 'fixed', bottom: 'env(safe-area-inset-bottom, 0px)', left: 0, right: 0, zIndex: 99999,
          background: '#3f382f', color: '#f5f1ea',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          padding: '10px 14px',
          fontFamily: 'Georgia, "Times New Roman", serif',
          fontSize: 13,
        }}>
          <span>↻ Landscape works better for editing</span>
          <button
            type="button"
            onClick={() => setShowPortraitWarning(false)}
            style={{ border: 0, background: 'none', color: '#f5f1ea', fontSize: 20, cursor: 'pointer', padding: '0 0 0 8px', lineHeight: 1, flexShrink: 0 }}
            aria-label="Dismiss"
          >✕</button>
        </div>
      )}

      {recoveryCandidate && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="recovery-dialog-title"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.52)', display: 'grid', placeItems: 'center', zIndex: 100001, padding: 18 }}
        >
          <div
            style={{ background: '#fffdf8', borderRadius: 10, padding: 24, width: 'min(430px, 100%)', display: 'grid', gap: 14, boxSizing: 'border-box', boxShadow: '0 12px 36px rgba(0,0,0,0.22)' }}
          >
            <div style={{ display: 'grid', gap: 6 }}>
              <h2 id="recovery-dialog-title" style={{ margin: 0, fontSize: 21, color: '#3f382f' }}>
                Restore your unsaved canvas?
              </h2>
              <p style={{ margin: 0, color: '#6f675f', fontSize: 14, lineHeight: 1.5 }}>
                We found canvas work saved on this device that was not saved as a draft.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={discardRecoveredDesign}
                style={{ ...btnSecondary, color: '#a03428' }}
              >
                Discard recovery
              </button>
              <button type="button" onClick={restoreRecoveredDesign} style={btnPrimary}>
                Restore canvas
              </button>
            </div>
          </div>
        </div>
      )}

      {showLeaveStudioConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="leave-studio-dialog-title"
          onClick={stayOnActiveCanvas}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.52)', display: 'grid', placeItems: 'center', zIndex: 100002, padding: 18 }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{ background: '#fffdf8', borderRadius: 10, padding: 24, width: 'min(430px, 100%)', display: 'grid', gap: 14, boxSizing: 'border-box', boxShadow: '0 12px 36px rgba(0,0,0,0.22)' }}
          >
            <div style={{ display: 'grid', gap: 6 }}>
              <h2 id="leave-studio-dialog-title" style={{ margin: 0, fontSize: 21, color: '#3f382f' }}>
                Leave this unsaved canvas?
              </h2>
              <p style={{ margin: 0, color: '#6f675f', fontSize: 14, lineHeight: 1.5 }}>
                Your latest changes have not been saved as a draft. Leaving now will discard them.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button type="button" onClick={stayOnActiveCanvas} style={btnSecondary}>
                Stay on canvas
              </button>
              <button
                type="button"
                onClick={leaveActiveCanvas}
                style={{ ...btnPrimary, background: '#a03428', borderColor: '#a03428' }}
              >
                Leave without saving
              </button>
            </div>
          </div>
        </div>
      )}

      {tutorial.show && !recoveryCandidate && !showLeaveStudioConfirm && (
        <StudioTutorial onClose={tutorial.close} />
      )}

      {showSettingsGuardModal && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setShowSettingsGuardModal(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'grid', placeItems: 'center', zIndex: 11000, padding: 18 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fffdf8', borderRadius: 12, padding: 24, width: 'min(430px, 100%)', display: 'grid', gap: 14, boxSizing: 'border-box', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}
          >
            <h2 style={{ margin: 0, fontSize: 19, color: '#3f382f' }}>Careful — this canvas has edits</h2>
            <p style={{ margin: 0, fontSize: 14, color: '#5f574e', lineHeight: 1.6 }}>
              Changing the size and settings re-renders the design from the source image.
              Hand-painted stitches, fills, text, and other edits you&rsquo;ve made on this canvas
              may be lost or changed. Save a draft first if you want a safe copy.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setShowSettingsGuardModal(false)}
                style={{ padding: '9px 18px', border: '1px solid #d7d0c8', borderRadius: 8, fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer', background: '#fff', color: '#3f382f' }}
              >
                Keep my edits
              </button>
              <button
                type="button"
                onClick={() => { setSettingsGuardAccepted(true); setShowSettingsGuardModal(false) }}
                style={{ padding: '9px 18px', border: '1px solid #a8503f', borderRadius: 8, fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: 'pointer', background: '#c05b47', color: '#fff' }}
              >
                I understand, unlock settings
              </button>
            </div>
          </div>
        </div>
      )}

      {isUnauthenticatedWithCanvas && (
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'grid', placeItems: 'center', zIndex: 19000, padding: 18 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ display: 'grid', gap: 12, width: 'min(460px, 100%)' }}>
            <AuthPanel
              title="Log in to use the canvas"
              onSuccess={() => {}}
            />
            <button
              type="button"
              onClick={() => navigateAwayFromStudio('/gallery')}
              style={{ justifySelf: 'center', border: 0, background: 'transparent', color: '#fff', font: 'inherit', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}
            >
              Go to gallery instead
            </button>
          </div>
        </div>
      )}
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
