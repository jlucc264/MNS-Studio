'use client'

import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { type FontSize, type FontFamily, type TextOrientation, type TextStyle, getCaretPlacement, getTextCells } from '../lib/bitmapFonts'
import { useIsPhoneDevice, useIsTouch } from '../lib/useViewport'

type ShapeCell = { row: number; col: number; color: string }

type Props = {
  cells: string[][]
  activeColor: string | null
  toolMode: 'paint' | 'select' | 'shape' | 'merge' | 'text' | 'eyedropper' | 'fill'
  meshCount: 13 | 18
  brushDensity: number
  centerKey?: number
  onSelectionChange?: (selection: DesignSelectionRect[] | null) => void
  onDesignAreaMiss?: () => void
  onPaintStart: () => void
  onPaintCells: (coords: Array<[number, number]>) => void
  shapeType?: 'box' | 'semicircle' | 'line'
  arcFlipped?: boolean
  arcFullCircle?: boolean
  shapeFillColor?: string | null
  shapeBorderColor?: string | null
  shapeBorderSize?: number
  onApplyShapeCells?: (cells: ShapeCell[]) => void
  traceImageUrl?: string | null
  traceOpacity?: number
  onTraceOpacityChange?: (value: number) => void
  onEyedropperSample?: (cell: { row: number; col: number }) => void
  onFillCell?: (cell: { row: number; col: number }) => void
  textFontSize?: FontSize
  textFontFamily?: FontFamily
  textOrientation?: TextOrientation
  textBold?: boolean
  textItalic?: boolean
  textOutline?: boolean
  floatingStamp?: { cells: (string | null)[][]; anchorRow: number; anchorCol: number } | null
  onStampMove?: (anchor: { row: number; col: number }) => void
  clearSelectionSignal?: number
  signatureUrl?: string | null
  skuUrl?: string | null
  // Phone landscape has so little horizontal room in this toolbar that the
  // Trace slider (last in the row) gets pushed off since the row does not
  // wrap. Compact everything else so it stays reachable without wrapping.
  isPhoneLandscape?: boolean
  // Parent-driven "Place"/"Cancel" for the active text box (a Palette panel
  // button pair, mirroring the floating-stamp Place/Cancel) — incrementing
  // counters rather than a direct call since the box's state lives here.
  placeTextSignal?: number
  cancelTextSignal?: number
  onTextBoxActiveChange?: (active: boolean) => void
  // Rendered inside GridEditor's own canvas row (below the toolbar), not as
  // an external sibling — so an overlay like the color browser is confined
  // to the canvas area by the grid layout itself and can never cover the
  // toolbar, instead of needing to out-rank it with a guessed pixel offset.
  canvasOverlay?: ReactNode
}

const PAINTBRUSH_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cpath d='M15.6 3.2l5.2 5.2-7.8 7.8-5.2-5.2z' fill='%23222'/%3E%3Cpath d='M6.8 11.9l5.3 5.3-1.1 2.7c-.3.8-1 1.4-1.9 1.6-2 .5-4-.4-4.8-2.3-.4-.9-.4-1.8 0-2.7l1.1-2.6z' fill='%23c43b3b'/%3E%3Cpath d='M15.1 2.7l6.2 6.2' stroke='%23fff' stroke-width='1.2' stroke-linecap='round'/%3E%3C/g%3E%3C/svg%3E") 4 20, crosshair`
const RULER_THICKNESS = 24
const ZOOM_BUTTON_STEP = 10
const MAX_ZOOM_PERCENT = 800
const STAGE_SIZE_INCHES = 20

// iOS/iPadOS Safari silently rasterizes a canvas as blank (no error, no
// pixels) once its backing store crosses roughly this size per axis — not
// documented anywhere, just an empirical WebKit ceiling. The stage's pixel
// width scales directly with zoom and grows unbounded, so a wide design
// (a belt) at a high-but-not-max zoom can cross it well before 800%. Scale
// the device pixel ratio down instead of the CSS size so the canvas
// degrades to a softer render rather than going blank.
const MAX_CANVAS_DIMENSION_PX = 4096

function getSafeDevicePixelRatio(width: number, height: number, baseDpr: number): number {
  const overflowScale = Math.min(
    1,
    MAX_CANVAS_DIMENSION_PX / Math.max(width * baseDpr, 1),
    MAX_CANVAS_DIMENSION_PX / Math.max(height * baseDpr, 1)
  )
  return baseDpr * overflowScale
}
const BLANK_CELL = '__BLANK__'
const FINISH_OUTLINE_CELL = '__FINISH_OUTLINE__'

export type DesignSelectionRect = {
  startRow: number
  startCol: number
  endRow: number
  endCol: number
}

// ── Shape helpers ────────────────────────────────────────────────────────────

function getBoxCells(
  r1: number, c1: number, r2: number, c2: number,
  fillColor: string | null, borderColor: string | null,
  totalRows: number, totalCols: number,
  borderSize = 1
): Array<{ row: number; col: number; color: string }> {
  const top = Math.max(0, Math.min(r1, r2))
  const bottom = Math.min(totalRows - 1, Math.max(r1, r2))
  const left = Math.max(0, Math.min(c1, c2))
  const right = Math.min(totalCols - 1, Math.max(c1, c2))
  const result: Array<{ row: number; col: number; color: string }> = []
  for (let row = top; row <= bottom; row++) {
    for (let col = left; col <= right; col++) {
      const isBorder = row < top + borderSize || row > bottom - borderSize || col < left + borderSize || col > right - borderSize
      if (isBorder) {
        if (borderColor) result.push({ row, col, color: borderColor })
      } else {
        if (fillColor) result.push({ row, col, color: fillColor })
      }
    }
  }
  return result
}

function getLineCells(
  r1: number, c1: number, r2: number, c2: number,
  borderColor: string | null, fillColor: string | null,
  totalRows: number, totalCols: number,
  borderSize = 1
): Array<{ row: number; col: number; color: string }> {
  const color = borderColor ?? fillColor
  if (!color) return []
  const spine: Array<{ row: number; col: number }> = []
  let row = r1, col = c1
  const dr = Math.abs(r2 - r1), dc = Math.abs(c2 - c1)
  const sr = r1 < r2 ? 1 : -1, sc = c1 < c2 ? 1 : -1
  let err = dr - dc
  for (;;) {
    spine.push({ row, col })
    if (row === r2 && col === c2) break
    const e2 = 2 * err
    if (e2 > -dc) { err -= dc; row += sr }
    if (e2 < dr) { err += dr; col += sc }
  }
  const half = Math.floor((borderSize - 1) / 2)
  const ext = borderSize - 1 - half
  const seen = new Set<string>()
  const result: Array<{ row: number; col: number; color: string }> = []
  for (const cell of spine) {
    for (let dr2 = -half; dr2 <= ext; dr2++) {
      for (let dc2 = -half; dc2 <= ext; dc2++) {
        const nr = cell.row + dr2, nc = cell.col + dc2
        const key = `${nr},${nc}`
        if (!seen.has(key) && nr >= 0 && nr < totalRows && nc >= 0 && nc < totalCols) {
          seen.add(key)
          result.push({ row: nr, col: nc, color })
        }
      }
    }
  }
  return result
}

function getSemicircleCells(
  r1: number, c1: number, r2: number, c2: number,
  fillColor: string | null, borderColor: string | null,
  totalRows: number, totalCols: number,
  borderSize = 1,
  flipped = false
): Array<{ row: number; col: number; color: string }> {
  const topRow = Math.min(r1, r2)
  const botRow = Math.max(r1, r2)
  const leftCol = Math.min(c1, c2)
  const rightCol = Math.max(c1, c2)
  const width = Math.max(1, rightCol - leftCol)
  const height = Math.max(1, botRow - topRow)
  const result: Array<{ row: number; col: number; color: string }> = []

  let cx: number, cy: number, a: number, b: number
  let isOnOpenSide: (row: number, col: number) => boolean

  if (!flipped) {
    // Original drag-based up/down
    const opensDown = r2 >= r1
    cx = (leftCol + rightCol) / 2
    cy = opensDown ? topRow : botRow
    a = width / 2 + 0.5; b = height + 0.5
    isOnOpenSide = (row) => opensDown ? row >= cy : row <= cy
  } else {
    // Horizontal axis — drag-based left/right
    const opensRight = c2 >= c1
    cy = (topRow + botRow) / 2
    cx = opensRight ? leftCol : rightCol
    a = width + 0.5; b = height / 2 + 0.5
    isOnOpenSide = (_row, col) => opensRight ? col >= cx : col <= cx
  }

  function isInsideSemicircle(row: number, col: number) {
    if (row < 0 || row >= totalRows || col < 0 || col >= totalCols) return false
    if (!isOnOpenSide(row, col)) return false
    const nx = (col + 0.5 - cx) / a
    const ny = (row + 0.5 - cy) / b
    return nx * nx + ny * ny <= 1
  }

  for (let row = Math.max(0, topRow); row <= Math.min(totalRows - 1, botRow); row++) {
    for (let col = Math.max(0, leftCol); col <= Math.min(totalCols - 1, rightCol); col++) {
      if (!isInsideSemicircle(row, col)) continue
      let isBorder = false
      outer: for (let dr = -borderSize; dr <= borderSize; dr++) {
        for (let dc = -(borderSize - Math.abs(dr)); dc <= borderSize - Math.abs(dr); dc++) {
          if (dr === 0 && dc === 0) continue
          if (!isInsideSemicircle(row + dr, col + dc)) { isBorder = true; break outer }
        }
      }
      if (isBorder) {
        if (borderColor) result.push({ row, col, color: borderColor })
      } else {
        if (fillColor) result.push({ row, col, color: fillColor })
      }
    }
  }
  return result
}

function getFullCircleCells(
  r1: number, c1: number, r2: number, c2: number,
  fillColor: string | null, borderColor: string | null,
  totalRows: number, totalCols: number,
  borderSize = 1,
): Array<{ row: number; col: number; color: string }> {
  const topRow = Math.min(r1, r2)
  const botRow = Math.max(r1, r2)
  const leftCol = Math.min(c1, c2)
  const rightCol = Math.max(c1, c2)
  const width = Math.max(1, rightCol - leftCol)
  const height = Math.max(1, botRow - topRow)
  const cx = (leftCol + rightCol) / 2
  const cy = (topRow + botRow) / 2
  const a = width / 2 + 0.5
  const b = height / 2 + 0.5
  const result: Array<{ row: number; col: number; color: string }> = []

  function isInside(row: number, col: number) {
    if (row < 0 || row >= totalRows || col < 0 || col >= totalCols) return false
    const nx = (col + 0.5 - cx) / a
    const ny = (row + 0.5 - cy) / b
    return nx * nx + ny * ny <= 1
  }

  for (let row = Math.max(0, topRow); row <= Math.min(totalRows - 1, botRow); row++) {
    for (let col = Math.max(0, leftCol); col <= Math.min(totalCols - 1, rightCol); col++) {
      if (!isInside(row, col)) continue
      let isBorder = false
      outer: for (let dr = -borderSize; dr <= borderSize; dr++) {
        for (let dc = -(borderSize - Math.abs(dr)); dc <= borderSize - Math.abs(dr); dc++) {
          if (dr === 0 && dc === 0) continue
          if (!isInside(row + dr, col + dc)) { isBorder = true; break outer }
        }
      }
      if (isBorder) {
        if (borderColor) result.push({ row, col, color: borderColor })
      } else {
        if (fillColor) result.push({ row, col, color: fillColor })
      }
    }
  }
  return result
}

export function computeShapeCells(
  shapeType: 'box' | 'semicircle' | 'line',
  r1: number, c1: number, r2: number, c2: number,
  fillColor: string | null, borderColor: string | null,
  totalRows: number, totalCols: number,
  borderSize = 1,
  arcFlipped = false,
  arcFullCircle = false,
): Array<{ row: number; col: number; color: string }> {
  const cr1 = Math.max(0, Math.min(totalRows - 1, r1))
  const cc1 = Math.max(0, Math.min(totalCols - 1, c1))
  const cr2 = Math.max(0, Math.min(totalRows - 1, r2))
  const cc2 = Math.max(0, Math.min(totalCols - 1, c2))
  if (shapeType === 'box') return getBoxCells(cr1, cc1, cr2, cc2, fillColor, borderColor, totalRows, totalCols, borderSize)
  if (shapeType === 'line') return getLineCells(cr1, cc1, cr2, cc2, borderColor, fillColor, totalRows, totalCols, borderSize)
  if (arcFullCircle) return getFullCircleCells(cr1, cc1, cr2, cc2, fillColor, borderColor, totalRows, totalCols, borderSize)
  return getSemicircleCells(cr1, cc1, cr2, cc2, fillColor, borderColor, totalRows, totalCols, borderSize, arcFlipped)
}

// ── End shape helpers ────────────────────────────────────────────────────────

function stitchStroke(hex: string) {
  if (hex === '#FFFFFF') {
    return 'rgba(190, 190, 190, 0.95)'
  }
  return 'rgba(0, 0, 0, 0.22)'
}

function stitchHighlight(hex: string) {
  if (hex === '#FFFFFF') {
    return 'rgba(255, 255, 255, 0.95)'
  }
  return 'rgba(255, 255, 255, 0.28)'
}

function stitchShadow(hex: string) {
  if (hex === '#FFFFFF') {
    return 'rgba(170, 170, 170, 0.6)'
  }
  return 'rgba(0, 0, 0, 0.14)'
}

function clampZoom(nextZoom: number) {
  return Math.max(100, Math.min(MAX_ZOOM_PERCENT, nextZoom))
}

const TOUCH_EDIT_GRACE_MS = 90

function formatInches(value: number) {
  return Number.isInteger(value) ? `${value}` : value.toFixed(2).replace(/\.?0+$/, '')
}

function isWithinSelection(
  selection: DesignSelectionRect | null,
  row: number,
  col: number
) {
  if (!selection) return false

  const top = Math.min(selection.startRow, selection.endRow)
  const bottom = Math.max(selection.startRow, selection.endRow)
  const left = Math.min(selection.startCol, selection.endCol)
  const right = Math.max(selection.startCol, selection.endCol)

  return row >= top && row <= bottom && col >= left && col <= right
}

function isWithinSelections(
  selections: DesignSelectionRect[],
  row: number,
  col: number
) {
  return selections.some((selection) => isWithinSelection(selection, row, col))
}

function drawCenterReferenceCross({
  context,
  x,
  y,
  cellSize,
}: {
  context: CanvasRenderingContext2D
  x: number
  y: number
  cellSize: number
}) {
  const armLength = Math.max(7, cellSize * 0.72)
  const innerGap = Math.max(2, cellSize * 0.18)

  context.save()
  context.strokeStyle = 'rgba(60, 54, 45, 0.48)'
  context.lineWidth = Math.max(1.25, cellSize * 0.08)
  context.lineCap = 'round'

  context.beginPath()
  context.moveTo(x - armLength, y)
  context.lineTo(x - innerGap, y)
  context.moveTo(x + innerGap, y)
  context.lineTo(x + armLength, y)
  context.moveTo(x, y - armLength)
  context.lineTo(x, y - innerGap)
  context.moveTo(x, y + innerGap)
  context.lineTo(x, y + armLength)
  context.stroke()

  context.restore()
}

function drawCanvasCell({
  activeColor,
  context,
  color,
  cellSize,
  displayMode,
  highlightSelection,
  inDesign,
  isInsideFocusRegion,
  focusRegionActive,
  x,
  y,
}: {
  activeColor: string | null
  context: CanvasRenderingContext2D
  color: string
  cellSize: number
  displayMode: 'flat' | 'stitched'
  highlightSelection: boolean
  inDesign: boolean
  isInsideFocusRegion: boolean
  focusRegionActive: boolean
  x: number
  y: number
}) {
  const selectedMatch = Boolean(
    highlightSelection &&
      activeColor &&
      inDesign &&
      color === activeColor &&
      (!focusRegionActive || isInsideFocusRegion)
  )
  const dimNonSelected = Boolean(
    highlightSelection &&
      activeColor &&
      inDesign &&
      (focusRegionActive ? !isInsideFocusRegion : color !== activeColor)
  )
  const isBlankCell = color === BLANK_CELL
  const renderColor = color === FINISH_OUTLINE_CELL ? '#000000' : color

  context.clearRect(x, y, cellSize, cellSize)
  context.fillStyle = isBlankCell ? '#fffdf8' : renderColor
  context.fillRect(x, y, cellSize, cellSize)

  if (dimNonSelected) {
    context.fillStyle = 'rgba(255, 255, 255, 0.62)'
    context.fillRect(x, y, cellSize, cellSize)
  }

  context.strokeStyle = 'rgba(0,0,0,0.08)'
  context.lineWidth = 0.5
  context.strokeRect(x, y, cellSize, cellSize)

  if (isBlankCell) {
    context.strokeStyle = 'rgba(160, 150, 138, 0.18)'
    context.lineWidth = 0.75
    context.beginPath()
    context.moveTo(x + cellSize * 0.22, y + cellSize * 0.78)
    context.lineTo(x + cellSize * 0.78, y + cellSize * 0.22)
    context.stroke()
    return
  }

  if (displayMode !== 'stitched' || !inDesign) return

  const inset = Math.max(1, Math.round(cellSize * 0.08))
  const left = x + inset
  const top = y + inset
  const width = cellSize - inset * 2
  const height = cellSize - inset * 2

  context.lineCap = 'round'

  context.strokeStyle = stitchShadow(renderColor)
  context.lineWidth = Math.max(1.5, cellSize * 0.22)
  context.beginPath()
  context.moveTo(left + width * 0.18, top + height * 0.22)
  context.lineTo(left + width * 0.82, top + height * 0.78)
  context.stroke()

  context.strokeStyle = renderColor
  context.lineWidth = Math.max(1.25, cellSize * 0.18)
  context.beginPath()
  context.moveTo(left + width * 0.17, top + height * 0.24)
  context.lineTo(left + width * 0.8, top + height * 0.77)
  context.stroke()

  context.strokeStyle = stitchHighlight(renderColor)
  context.lineWidth = Math.max(0.75, cellSize * 0.05)
  context.beginPath()
  context.moveTo(left + width * 0.22, top + height * 0.25)
  context.lineTo(left + width * 0.76, top + height * 0.7)
  context.stroke()

  context.strokeStyle = stitchShadow(renderColor)
  context.lineWidth = Math.max(1.5, cellSize * 0.22)
  context.beginPath()
  context.moveTo(left + width * 0.82, top + height * 0.22)
  context.lineTo(left + width * 0.18, top + height * 0.78)
  context.stroke()

  context.strokeStyle = stitchStroke(renderColor)
  context.lineWidth = Math.max(1.35, cellSize * 0.2)
  context.beginPath()
  context.moveTo(left + width * 0.8, top + height * 0.23)
  context.lineTo(left + width * 0.18, top + height * 0.8)
  context.stroke()

  context.strokeStyle = stitchHighlight(renderColor)
  context.lineWidth = Math.max(0.75, cellSize * 0.05)
  context.beginPath()
  context.moveTo(left + width * 0.76, top + height * 0.26)
  context.lineTo(left + width * 0.23, top + height * 0.75)
  context.stroke()

  context.fillStyle = renderColor === '#FFFFFF' ? 'rgba(246, 246, 246, 0.88)' : 'rgba(255, 255, 255, 0.12)'
  context.beginPath()
  context.ellipse(
    x + cellSize / 2,
    y + cellSize / 2,
    Math.max(1, cellSize * 0.18),
    Math.max(1, cellSize * 0.12),
    0,
    0,
    Math.PI * 2
  )
  context.fill()

  if (selectedMatch) {
    context.strokeStyle = 'rgba(255, 196, 0, 0.92)'
    context.lineWidth = Math.max(1, cellSize * 0.12)
    context.strokeRect(
      x + context.lineWidth / 2,
      y + context.lineWidth / 2,
      cellSize - context.lineWidth,
      cellSize - context.lineWidth
    )

    context.strokeStyle = 'rgba(255, 196, 0, 0.35)'
    context.lineWidth = Math.max(1, cellSize * 0.22)
    context.strokeRect(
      x + context.lineWidth / 2,
      y + context.lineWidth / 2,
      cellSize - context.lineWidth,
      cellSize - context.lineWidth
    )
  }
}

export default function GridEditor({
  cells,
  activeColor,
  toolMode,
  meshCount,
  brushDensity,
  centerKey,
  onSelectionChange,
  onDesignAreaMiss,
  onPaintStart,
  onPaintCells,
  shapeType,
  arcFlipped = false,
  arcFullCircle = false,
  shapeFillColor,
  shapeBorderColor,
  shapeBorderSize = 1,
  onApplyShapeCells,
  traceImageUrl,
  traceOpacity = 0,
  onTraceOpacityChange,
  onEyedropperSample,
  onFillCell,
  textFontSize = 'medium',
  textFontFamily = 'sans',
  textOrientation = 'horizontal',
  textBold = false,
  textItalic = false,
  textOutline = false,
  floatingStamp = null,
  onStampMove,
  clearSelectionSignal = 0,
  isPhoneLandscape = false,
  signatureUrl = null,
  skuUrl = null,
  placeTextSignal = 0,
  cancelTextSignal = 0,
  onTextBoxActiveChange,
  canvasOverlay,
}: Props) {
  if (!cells.length) return null

  const highlightSelection = toolMode === 'select'

  const isTouch = useIsTouch()
  const isMobile = useIsPhoneDevice()
  const toolbarButtonPadding = isMobile ? '3px 8px' : isTouch ? '12px 14px' : '4px 10px'
  const onSelectionChangeRef = useRef(onSelectionChange)
  useEffect(() => { onSelectionChangeRef.current = onSelectionChange })

  const containerRef = useRef<HTMLDivElement | null>(null)
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const traceImageRef = useRef<HTMLImageElement | null>(null)
  useEffect(() => {
    if (!traceImageUrl) { traceImageRef.current = null; return }
    const img = new Image()
    img.src = traceImageUrl
    img.onload = () => { traceImageRef.current = img }
  }, [traceImageUrl])
  const zoomLabelRef = useRef<HTMLSpanElement | null>(null)
  const horizontalRulerTickRefs = useRef<Array<HTMLDivElement | null>>([])
  const verticalRulerTickRefs = useRef<Array<HTMLDivElement | null>>([])
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })
  const [toolbarHeight, setToolbarHeight] = useState(56)
  const [zoomPercent, setZoomPercent] = useState(100)
  const [scrollPosition, setScrollPosition] = useState({ left: 0, top: 0 })
  const [displayMode, setDisplayMode] = useState<'flat' | 'stitched'>('stitched')
  const [isZooming, setIsZooming] = useState(false)
  const [isPainting, setIsPainting] = useState(false)
  const [isSelecting, setIsSelecting] = useState(false)
  const [selectionRects, setSelectionRects] = useState<DesignSelectionRect[]>([])
  const [dragSelectionRect, setDragSelectionRect] = useState<DesignSelectionRect | null>(null)
  const [isAddingSelection, setIsAddingSelection] = useState(false)
  const [shapeStartCell, setShapeStartCell] = useState<{ row: number; col: number } | null>(null)
  const [shapeEndCell, setShapeEndCell] = useState<{ row: number; col: number } | null>(null)
  const shapeStartCellRef = useRef<{ row: number; col: number } | null>(null)
  const [textAnchorCell, setTextAnchorCell] = useState<{ row: number; col: number } | null>(null)
  const [textBoxEnd, setTextBoxEnd] = useState<{ row: number; col: number } | null>(null)
  const textBoxStartRef = useRef<{ row: number; col: number } | null>(null)
  const [textInput, setTextInput] = useState('')
  const textInputRef = useRef<HTMLInputElement | null>(null)
  const [textCursorVisible, setTextCursorVisible] = useState(true)
  const textIsMovingRef = useRef(false)
  const textMoveStartRef = useRef<{
    initAnchorRow: number; initAnchorCol: number
    initBoxEndRow: number; initBoxEndCol: number
    pointerRow: number; pointerCol: number
  } | null>(null)
  const stampMoveStartRef = useRef<{
    initAnchorRow: number; initAnchorCol: number
    pointerRow: number; pointerCol: number
  } | null>(null)
  const onStampMoveRef = useRef(onStampMove)
  useEffect(() => { onStampMoveRef.current = onStampMove })
  const paintingPointerIdRef = useRef<number | null>(null)
  const selectionPointerIdRef = useRef<number | null>(null)
  const lastPaintedCellRef = useRef<{ row: number; col: number } | null>(null)
  const touchActivePointersRef = useRef<Set<number>>(new Set())
  const pendingTouchEditRef = useRef<{
    pointerId: number
    clientX: number
    clientY: number
    ctrlKey: boolean
    metaKey: boolean
  } | null>(null)
  const pendingTouchEditTimeoutRef = useRef<number | null>(null)
  const flushPendingTouchEditRef = useRef<(() => boolean) | null>(null)
  const pinchPointersRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pinchStartDistRef = useRef<number | null>(null)
  const pinchStartZoomRef = useRef<number>(100)
  const pinchStartMidpointRef = useRef<{ x: number; y: number } | null>(null)
  const pinchStartScrollRef = useRef<{ left: number; top: number } | null>(null)
  // Last cursor position over the canvas, so the +/− zoom buttons can anchor on
  // the cursor (like ctrl+wheel does) instead of the viewport center.
  const lastPointerClientRef = useRef<{ clientX: number; clientY: number } | null>(null)
  const zoomPercentRef = useRef(100)
  const activeColorRef = useRef<string | null>(activeColor)
  const brushDensityRef = useRef(brushDensity)
  const previousCellsRef = useRef<string[][] | null>(null)
  const previousRenderSignatureRef = useRef('')
  const canvasSizeRef = useRef<{ width: number; height: number } | null>(null)
  const overlayCanvasSizeRef = useRef<{ width: number; height: number } | null>(null)
  const liveSelectionRectRef = useRef<DesignSelectionRect | null>(null)
  const zoomSettleTimeoutRef = useRef<number | null>(null)
  const zoomFrameRef = useRef<number | null>(null)
  const pendingZoomRef = useRef<{
    zoom: number
    origin?: { clientX: number; clientY: number }
  } | null>(null)
  const pendingZoomAnchorRef = useRef<{
    zoom: number
    stageX: number
    stageY: number
    anchorX: number
    anchorY: number
  } | null>(null)
  const pendingResetViewRef = useRef(false)
  const centeredDimsRef = useRef('')

  useLayoutEffect(() => {
    const node = containerRef.current
    if (!node) return

    const updateSizeImmediate = () => {
      setContainerSize({
        width: node.clientWidth || 640,
        height: node.clientHeight || 520,
      })
    }

    let rafId: number | null = null
    const updateSizeDebounced = () => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        updateSizeImmediate()
      })
    }

    updateSizeImmediate()

    const observer = new ResizeObserver(updateSizeDebounced)
    observer.observe(node)

    return () => {
      observer.disconnect()
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [])

  useLayoutEffect(() => {
    const node = toolbarRef.current
    if (!node) return

    const updateHeight = () => {
      setToolbarHeight(node.clientHeight || 56)
    }

    updateHeight()

    const observer = new ResizeObserver(updateHeight)
    observer.observe(node)

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    zoomPercentRef.current = zoomPercent
  }, [zoomPercent])

  useEffect(() => {
    activeColorRef.current = activeColor
  }, [activeColor])

  useEffect(() => {
    brushDensityRef.current = brushDensity
  }, [brushDensity])

  useEffect(() => {
    return () => {
      if (zoomSettleTimeoutRef.current !== null) {
        window.clearTimeout(zoomSettleTimeoutRef.current)
      }
      if (zoomFrameRef.current !== null) {
        window.cancelAnimationFrame(zoomFrameRef.current)
      }
      if (pendingTouchEditTimeoutRef.current !== null) {
        window.clearTimeout(pendingTouchEditTimeoutRef.current)
      }
    }
  }, [])

  const clearPendingTouchEdit = useCallback(() => {
    if (pendingTouchEditTimeoutRef.current !== null) {
      window.clearTimeout(pendingTouchEditTimeoutRef.current)
      pendingTouchEditTimeoutRef.current = null
    }
    pendingTouchEditRef.current = null
  }, [])

  const cancelActiveTouchEdit = useCallback(() => {
    setIsPainting(false)
    setIsSelecting(false)
    setIsAddingSelection(false)
    setDragSelectionRect(null)
    paintingPointerIdRef.current = null
    selectionPointerIdRef.current = null
    liveSelectionRectRef.current = null
    shapeStartCellRef.current = null
    setShapeStartCell(null)
    setShapeEndCell(null)
    textBoxStartRef.current = null
    textIsMovingRef.current = false
    textMoveStartRef.current = null
    stampMoveStartRef.current = null
  }, [])

  const focusTextInputForKeyboard = useCallback(() => {
    const input = textInputRef.current
    if (!input) return
    input.focus({ preventScroll: true })
    const cursorPosition = input.value.length
    input.setSelectionRange(cursorPosition, cursorPosition)
  }, [])

  // Shared by Enter, the "Place" button, and the "Cancel" button — the three
  // ways to end a text box — so all of them agree on what counts as a commit.
  const commitTextBox = useCallback(() => {
    if (textAnchorCell && textInput.trim() && activeColor) {
      const stampCells = getTextCells(textInput, textAnchorCell.row, textAnchorCell.col, textFontSize, textFontFamily, activeColor, { bold: textBold, italic: textItalic, outline: textOutline }, textOrientation)
      onApplyShapeCells?.(stampCells)
    }
    setTextAnchorCell(null)
    setTextBoxEnd(null)
    setTextInput('')
  }, [textAnchorCell, textInput, activeColor, textFontSize, textFontFamily, textOrientation, textBold, textItalic, textOutline, onApplyShapeCells])

  const discardTextBox = useCallback(() => {
    setTextAnchorCell(null)
    setTextBoxEnd(null)
    setTextInput('')
  }, [])

  useEffect(() => {
    if (toolMode !== 'text' || !textAnchorCell) { setTextCursorVisible(true); return }
    setTextCursorVisible(true)
    const id = window.setInterval(() => setTextCursorVisible((v) => !v), 530)
    return () => window.clearInterval(id)
  }, [toolMode, textAnchorCell, textInput])

  // Clicking any text-settings control (font, size, orientation, B/I/outline)
  // moves focus to that button, silently disconnecting the keyboard from the
  // active text box. Pull focus back so typing and Enter keep working.
  useEffect(() => {
    if (toolMode === 'text' && textAnchorCell && textBoxEnd) focusTextInputForKeyboard()
  }, [toolMode, textAnchorCell, textBoxEnd, focusTextInputForKeyboard,
      textFontSize, textFontFamily, textOrientation, textBold, textItalic, textOutline])

  useEffect(() => {
    if (!highlightSelection) {
      setDragSelectionRect(null)
      setSelectionRects([])
      liveSelectionRectRef.current = null
      onSelectionChangeRef.current?.(null)
    }
  }, [highlightSelection])

  // Cut/Copy lifts the selection into a floating stamp — drop the marquee
  useEffect(() => {
    if (floatingStamp) {
      setDragSelectionRect(null)
      setSelectionRects([])
      liveSelectionRectRef.current = null
    }
  }, [floatingStamp])

  // Parent-driven "clear highlight": drop the internal marquee too
  const lastClearSignalRef = useRef(clearSelectionSignal)
  useEffect(() => {
    if (clearSelectionSignal === lastClearSignalRef.current) return
    lastClearSignalRef.current = clearSelectionSignal
    setDragSelectionRect(null)
    setSelectionRects([])
    liveSelectionRectRef.current = null
  }, [clearSelectionSignal])

  // Parent-driven "Place"/"Cancel" buttons for the active text box
  const lastPlaceTextSignalRef = useRef(placeTextSignal)
  useEffect(() => {
    if (placeTextSignal === lastPlaceTextSignalRef.current) return
    lastPlaceTextSignalRef.current = placeTextSignal
    commitTextBox()
  }, [placeTextSignal, commitTextBox])

  const lastCancelTextSignalRef = useRef(cancelTextSignal)
  useEffect(() => {
    if (cancelTextSignal === lastCancelTextSignalRef.current) return
    lastCancelTextSignalRef.current = cancelTextSignal
    discardTextBox()
  }, [cancelTextSignal, discardTextBox])

  useEffect(() => {
    onTextBoxActiveChange?.(Boolean(textAnchorCell && textBoxEnd))
  }, [textAnchorCell, textBoxEnd, onTextBoxActiveChange])

  useEffect(() => {
    const stopPainting = (event: PointerEvent) => {
      if (event.pointerType === 'touch') {
        if (event.type === 'pointerup') {
          flushPendingTouchEditRef.current?.()
        } else {
          clearPendingTouchEdit()
        }
        touchActivePointersRef.current.delete(event.pointerId)
      }
      if (toolMode === 'text' && textIsMovingRef.current) {
        textIsMovingRef.current = false
        textMoveStartRef.current = null
        focusTextInputForKeyboard()
      } else if (toolMode === 'text' && textBoxStartRef.current && textBoxEnd) {
        const start = textBoxStartRef.current
        const anchorRow = Math.min(start.row, textBoxEnd.row)
        const anchorCol = Math.min(start.col, textBoxEnd.col)
        textBoxStartRef.current = null
        setTextAnchorCell({ row: anchorRow, col: anchorCol })
        focusTextInputForKeyboard()
      }

      if (toolMode === 'shape' && shapeStartCellRef.current && shapeEndCell) {
        const start = shapeStartCellRef.current
        if (shapeType && onApplyShapeCells) {
          const shapeCells = computeShapeCells(
            shapeType,
            start.row, start.col,
            shapeEndCell.row, shapeEndCell.col,
            shapeFillColor ?? null,
            shapeBorderColor ?? null,
            cells.length, cells[0]?.length ?? 0,
            shapeBorderSize,
            arcFlipped,
            arcFullCircle,
          )
          if (shapeCells.length) onApplyShapeCells(shapeCells)
        }
        shapeStartCellRef.current = null
        setShapeStartCell(null)
        setShapeEndCell(null)
      }

      if (isSelecting && dragSelectionRect) {
        const _rows = cells.length
        const _cols = cells[0]?.length ?? 0
        const minRow = Math.min(dragSelectionRect.startRow, dragSelectionRect.endRow)
        const maxRow = Math.max(dragSelectionRect.startRow, dragSelectionRect.endRow)
        const minCol = Math.min(dragSelectionRect.startCol, dragSelectionRect.endCol)
        const maxCol = Math.max(dragSelectionRect.startCol, dragSelectionRect.endCol)
        const hitsDesign = minRow < _rows && maxRow >= 0 && minCol < _cols && maxCol >= 0

        if (hitsDesign) {
          const nextSelectionRects = isAddingSelection
            ? [...selectionRects, dragSelectionRect]
            : [dragSelectionRect]
          setSelectionRects(nextSelectionRects)
          onSelectionChange?.(nextSelectionRects)
        } else {
          setSelectionRects([])
          onSelectionChange?.(null)
          onDesignAreaMiss?.()
        }
        liveSelectionRectRef.current = null
      }

      setIsPainting(false)
      setIsSelecting(false)
      setIsAddingSelection(false)
      setDragSelectionRect(null)
      paintingPointerIdRef.current = null
      selectionPointerIdRef.current = null
      lastPaintedCellRef.current = null
      stampMoveStartRef.current = null
    }

    window.addEventListener('pointerup', stopPainting)
    window.addEventListener('pointercancel', stopPainting)

    return () => {
      window.removeEventListener('pointerup', stopPainting)
      window.removeEventListener('pointercancel', stopPainting)
    }
  }, [
    toolMode, shapeEndCell, shapeType, shapeFillColor, shapeBorderColor,
    onApplyShapeCells, cells,
    dragSelectionRect, isAddingSelection, isSelecting, onSelectionChange, selectionRects,
    onDesignAreaMiss, textBoxEnd, focusTextInputForKeyboard, clearPendingTouchEdit,
  ])

  const borderStitches = Math.floor(1 * meshCount)
  const rows = cells.length
  const cols = cells[0].length
  const totalRows = rows + borderStitches * 2
  const totalCols = cols + borderStitches * 2
  // Stage is normally a fixed 20" square — plenty of panning room around any
  // design up to the old printable max. A belt can run past 20" on its long
  // axis, so the stage must grow to at least contain the actual content or
  // scrolling hard-stops at the stage edge with the rest of the design
  // unreachable.
  const stageRows = Math.max(Math.round(STAGE_SIZE_INCHES * meshCount), totalRows)
  const stageCols = Math.max(Math.round(STAGE_SIZE_INCHES * meshCount), totalCols)
  const availableStageWidth = Math.max(containerSize.width - RULER_THICKNESS, 160)
  const availableStageHeight = Math.max(
    containerSize.height - toolbarHeight - 8 - RULER_THICKNESS,
    160
  )
  // baseCellSize fits the design (+ 1" border) in the viewport; the larger stage extends beyond for panning
  const baseCellSize = useMemo(
    () =>
      Math.max(
        1,
        Math.min(availableStageWidth / totalCols, availableStageHeight / totalRows)
      ),
    [availableStageHeight, availableStageWidth, totalCols, totalRows]
  )

  const cellSize = Math.max(1, (baseCellSize * zoomPercent) / 100)
  const stageWidth = stageCols * cellSize
  const stageHeight = stageRows * cellSize
  // Viewport fills the available container; stage is larger so it overflows and scrollbars appear
  const previewViewportWidth = Math.round(availableStageWidth)
  const previewViewportHeight = Math.round(availableStageHeight)
  const previewFrameWidth = previewViewportWidth + RULER_THICKNESS
  const previewFrameHeight = previewViewportHeight + RULER_THICKNESS
  const wrapperWidth = Math.max(previewViewportWidth, Math.round(stageWidth))
  const wrapperHeight = Math.max(previewViewportHeight, Math.round(stageHeight))
  const gridOriginX = Math.max(0, (wrapperWidth - Math.round(stageWidth)) / 2)
  const gridOriginY = Math.max(0, (wrapperHeight - Math.round(stageHeight)) / 2)
  const contentOriginCol = Math.max(0, Math.floor((stageCols - totalCols) / 2))
  const contentOriginRow = Math.max(0, Math.floor((stageRows - totalRows) / 2))
  const inchStepPixels = meshCount * cellSize
  const rulerWidthUnits = Math.ceil(stageCols / meshCount)
  const rulerHeightUnits = Math.ceil(stageRows / meshCount)
  const horizontalRulerTicks = useMemo(
    () =>
      Array.from({ length: rulerWidthUnits + 1 }, (_, index) => ({
        index,
        offset: index * inchStepPixels,
      })),
    [inchStepPixels, rulerWidthUnits]
  )
  const verticalRulerTicks = useMemo(
    () =>
      Array.from({ length: rulerHeightUnits + 1 }, (_, index) => ({
        index,
        offset: index * inchStepPixels,
      })),
    [inchStepPixels, rulerHeightUnits]
  )
  // Two separate offsets stand between a tick and where it belongs.
  //
  // gridOrigin is the gap that centres the stage inside the viewport when the
  // canvas is smaller than the visible area. Hit-testing subtracts it and zoom
  // adds it, but the rulers ignored it, so every reading was off by the
  // centring gap.
  //
  // contentOrigin is the bigger one: the stage is a fixed 20" square and the
  // design sits centred in it, so measuring from the stage edge put zero
  // wherever the padding happened to fall — 7" across and 6" down on a 4x6
  // design. Ticks now start at the waste canvas edge instead, so 0" is the
  // corner of the material that actually gets printed and the design begins
  // at the border mark.
  const rulerOriginX = contentOriginCol * cellSize
  const rulerOriginY = contentOriginRow * cellSize
  const visibleHorizontalTicks = useMemo(
    () =>
      horizontalRulerTicks.map((tick) => {
        const position = tick.offset + gridOriginX + rulerOriginX - scrollPosition.left
        return {
          ...tick,
          position,
          visible: position >= -32 && position <= previewViewportWidth + 32,
        }
      }),
    [gridOriginX, horizontalRulerTicks, previewViewportWidth, rulerOriginX, scrollPosition.left]
  )
  const visibleVerticalTicks = useMemo(
    () =>
      verticalRulerTicks.map((tick) => {
        const position = tick.offset + gridOriginY + rulerOriginY - scrollPosition.top
        return {
          ...tick,
          position,
          visible: position >= -32 && position <= previewViewportHeight + 32,
        }
      }),
    [gridOriginY, previewViewportHeight, rulerOriginY, scrollPosition.top, verticalRulerTicks]
  )

  const getDefaultCenteredScroll = useCallback(() => {
    const centerX = Math.max(
      0,
      Math.round((contentOriginCol + totalCols / 2) * baseCellSize - availableStageWidth / 2)
    )
    const centerY = Math.max(
      0,
      Math.round((contentOriginRow + totalRows / 2) * baseCellSize - availableStageHeight / 2)
    )

    return { left: centerX, top: centerY }
  }, [
    availableStageHeight,
    availableStageWidth,
    baseCellSize,
    contentOriginCol,
    contentOriginRow,
    totalCols,
    totalRows,
  ])

  const buildBrushCoords = useCallback(
    (row: number, col: number) => {
      const radius = Math.max(0, brushDensityRef.current - 1)
      const coords: Array<[number, number]> = []

      for (let rowOffset = -radius; rowOffset <= radius; rowOffset += 1) {
        for (let colOffset = -radius; colOffset <= radius; colOffset += 1) {
          if (Math.hypot(rowOffset, colOffset) > radius + 0.25) continue

          const nextRow = row + rowOffset
          const nextCol = col + colOffset
          if (nextRow < 0 || nextRow >= rows || nextCol < 0 || nextCol >= cols) continue

          coords.push([nextRow, nextCol])
        }
      }

      return coords
    },
    [rows, cols]
  )

  const paintCell = useCallback(
    (row: number, col: number) => {
      const last = lastPaintedCellRef.current
      if (last && last.row === row && last.col === col) return

      // Bresenham's line — fill any skipped cells when pointer moves fast
      const points: Array<[number, number]> = []
      if (last) {
        let r = last.row, c = last.col
        const dr = Math.abs(row - r), dc = Math.abs(col - c)
        const sr = r < row ? 1 : -1, sc = c < col ? 1 : -1
        let err = dr - dc
        while (true) {
          points.push([r, c])
          if (r === row && c === col) break
          const e2 = 2 * err
          if (e2 > -dc) { err -= dc; r += sr }
          if (e2 < dr) { err += dr; c += sc }
        }
      } else {
        points.push([row, col])
      }

      lastPaintedCellRef.current = { row, col }

      const seen = new Set<string>()
      const allCoords: Array<[number, number]> = []
      for (const [r, c] of points) {
        for (const coord of buildBrushCoords(r, c)) {
          const key = `${coord[0]}-${coord[1]}`
          if (!seen.has(key)) {
            seen.add(key)
            allCoords.push(coord)
          }
        }
      }
      onPaintCells(allCoords)
    },
    [buildBrushCoords, onPaintCells]
  )

  const getCellFromClientPoint = useCallback(
    (
      clientX: number,
      clientY: number,
      clampTo: 'design' | 'stage' = 'design'
    ) => {
      const canvas = canvasRef.current
      if (!canvas) return null

      const rect = canvas.getBoundingClientRect()
      const localX = clientX - rect.left
      const localY = clientY - rect.top

      const gridCol = Math.floor((localX - gridOriginX) / cellSize)
      const gridRow = Math.floor((localY - gridOriginY) / cellSize)
      const designCol = gridCol - contentOriginCol - borderStitches
      const designRow = gridRow - contentOriginRow - borderStitches

      if (clampTo === 'stage') {
        const minDesignCol = -contentOriginCol - borderStitches
        const maxDesignCol = stageCols - contentOriginCol - borderStitches - 1
        const minDesignRow = -contentOriginRow - borderStitches
        const maxDesignRow = stageRows - contentOriginRow - borderStitches - 1
        const clampedDesignCol = Math.max(minDesignCol, Math.min(maxDesignCol, designCol))
        const clampedDesignRow = Math.max(minDesignRow, Math.min(maxDesignRow, designRow))

        return {
          row: clampedDesignRow,
          col: clampedDesignCol,
        }
      }

      if (designCol < 0 || designCol >= cols) return null
      if (designRow < 0 || designRow >= rows) return null

      return {
        row: designRow,
        col: designCol,
      }
    },
    [
      borderStitches,
      cellSize,
      cols,
      contentOriginCol,
      contentOriginRow,
      gridOriginX,
      gridOriginY,
      rows,
      stageCols,
      stageRows,
    ]
  )

  const updateLiveRulers = useCallback(
    (nextZoom: number, scrollLeft: number, scrollTop: number) => {
      const nextCellSize = Math.max(1, (baseCellSize * nextZoom) / 100)
      // Mirrors getZoomMetrics — the centring gap changes with zoom, so it has
      // to be recomputed here rather than closing over the rendered value, or
      // the rulers drift away from the grid mid-gesture and snap back on
      // release when the memoized ticks take over.
      const nextStageWidth = stageCols * nextCellSize
      const nextStageHeight = stageRows * nextCellSize
      const nextGridOriginX = Math.max(
        0,
        (Math.max(previewViewportWidth, Math.round(nextStageWidth)) - Math.round(nextStageWidth)) / 2
      )
      const nextGridOriginY = Math.max(
        0,
        (Math.max(previewViewportHeight, Math.round(nextStageHeight)) - Math.round(nextStageHeight)) / 2
      )

      horizontalRulerTickRefs.current.forEach((tickNode, index) => {
        if (!tickNode) return

        const position =
          index * meshCount * nextCellSize + nextGridOriginX + contentOriginCol * nextCellSize - scrollLeft
        tickNode.style.left = `${position}px`
        tickNode.style.display =
          position >= -32 && position <= previewViewportWidth + 32 ? 'block' : 'none'
      })

      verticalRulerTickRefs.current.forEach((tickNode, index) => {
        if (!tickNode) return

        const position =
          index * meshCount * nextCellSize + nextGridOriginY + contentOriginRow * nextCellSize - scrollTop
        tickNode.style.top = `${position}px`
        tickNode.style.display =
          position >= -32 && position <= previewViewportHeight + 32 ? 'block' : 'none'
      })
    },
    [
      baseCellSize, contentOriginCol, contentOriginRow, meshCount,
      previewViewportHeight, previewViewportWidth, stageCols, stageRows,
    ]
  )

  const applyViewportScroll = useCallback(
    (left: number, top: number, nextZoom = zoomPercentRef.current) => {
      const viewport = viewportRef.current
      if (!viewport) return

      viewport.scrollLeft = Math.max(0, left)
      viewport.scrollTop = Math.max(0, top)
      setScrollPosition({ left: viewport.scrollLeft, top: viewport.scrollTop })
      updateLiveRulers(nextZoom, viewport.scrollLeft, viewport.scrollTop)
    },
    [updateLiveRulers]
  )

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const syncScroll = () => {
      updateLiveRulers(zoomPercentRef.current, viewport.scrollLeft, viewport.scrollTop)

      setScrollPosition({
        left: viewport.scrollLeft,
        top: viewport.scrollTop,
      })
    }

    syncScroll()
    viewport.addEventListener('scroll', syncScroll, { passive: true })
    return () => viewport.removeEventListener('scroll', syncScroll)
  }, [previewViewportHeight, previewViewportWidth, updateLiveRulers])

  // Center the design when dims/mesh change, on first container measurement, or on resize at 100% zoom.
  useLayoutEffect(() => {
    if (containerSize.width === 0) return
    const viewport = viewportRef.current
    if (!viewport) return
    const dimsKey = `${rows}-${cols}-${meshCount}`
    const atDefaultZoom = zoomPercentRef.current === 100
    // Skip if same dims and user has zoomed in (preserve their scroll position)
    if (centeredDimsRef.current === dimsKey && !atDefaultZoom) return
    centeredDimsRef.current = dimsKey
    const centeredScroll = getDefaultCenteredScroll()
    applyViewportScroll(centeredScroll.left, centeredScroll.top)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, cols, meshCount, baseCellSize, containerSize.width, containerSize.height, getDefaultCenteredScroll, applyViewportScroll])

  // Re-center when centerKey changes (e.g. "Start fresh") without remounting the component.
  useLayoutEffect(() => {
    if (!centerKey) return
    const viewport = viewportRef.current
    if (!viewport || containerSize.width === 0) return
    centeredDimsRef.current = ''
    pendingZoomAnchorRef.current = null

    if (zoomPercentRef.current === 100) {
      pendingResetViewRef.current = false
      const centeredScroll = getDefaultCenteredScroll()
      applyViewportScroll(centeredScroll.left, centeredScroll.top, 100)
      return
    }

    zoomPercentRef.current = 100
    setZoomPercent(100)
    pendingResetViewRef.current = true
  }, [centerKey, containerSize.width, getDefaultCenteredScroll, applyViewportScroll])

  const getZoomMetrics = useCallback(
    (targetZoom: number) => {
      const targetCellSize = Math.max(1, (baseCellSize * targetZoom) / 100)
      const targetStageWidth = stageCols * targetCellSize
      const targetStageHeight = stageRows * targetCellSize
      const targetWrapperWidth = Math.max(previewViewportWidth, Math.round(targetStageWidth))
      const targetWrapperHeight = Math.max(previewViewportHeight, Math.round(targetStageHeight))

      return {
        cellSize: targetCellSize,
        gridOriginX: Math.max(0, (targetWrapperWidth - Math.round(targetStageWidth)) / 2),
        gridOriginY: Math.max(0, (targetWrapperHeight - Math.round(targetStageHeight)) / 2),
        wrapperWidth: targetWrapperWidth,
        wrapperHeight: targetWrapperHeight,
      }
    },
    [baseCellSize, previewViewportHeight, previewViewportWidth, stageCols, stageRows]
  )

  const applyStageAnchorScroll = useCallback(
    (
      targetZoom: number,
      stageX: number,
      stageY: number,
      anchorX: number,
      anchorY: number
    ) => {
      const viewport = viewportRef.current
      if (!viewport) return

      const metrics = getZoomMetrics(targetZoom)
      const maxScrollLeft = Math.max(0, metrics.wrapperWidth - previewViewportWidth)
      const maxScrollTop = Math.max(0, metrics.wrapperHeight - previewViewportHeight)
      const nextScrollLeft = metrics.gridOriginX + stageX * metrics.cellSize - anchorX
      const nextScrollTop = metrics.gridOriginY + stageY * metrics.cellSize - anchorY

      viewport.scrollLeft = Math.max(0, Math.min(maxScrollLeft, nextScrollLeft))
      viewport.scrollTop = Math.max(0, Math.min(maxScrollTop, nextScrollTop))
      updateLiveRulers(targetZoom, viewport.scrollLeft, viewport.scrollTop)
      setScrollPosition({
        left: viewport.scrollLeft,
        top: viewport.scrollTop,
      })
    },
    [getZoomMetrics, previewViewportHeight, previewViewportWidth, updateLiveRulers]
  )

  const setZoomWithStageAnchor = useCallback(
    (
      nextZoom: number,
      stageX: number,
      stageY: number,
      anchorX: number,
      anchorY: number
    ) => {
      const viewport = viewportRef.current
      const clampedZoom = clampZoom(nextZoom)
      if (!viewport) {
        zoomPercentRef.current = clampedZoom
        setZoomPercent(clampedZoom)
        return
      }

      if (zoomSettleTimeoutRef.current !== null) {
        window.clearTimeout(zoomSettleTimeoutRef.current)
      }

      pendingResetViewRef.current = false
      pendingZoomAnchorRef.current = {
        zoom: clampedZoom,
        stageX,
        stageY,
        anchorX,
        anchorY,
      }

      viewport.style.overflowX = 'auto'
      viewport.style.overflowY = 'auto'

      if (zoomLabelRef.current) {
        zoomLabelRef.current.textContent = `${Math.round(clampedZoom)}%`
      }

      if (clampedZoom === zoomPercentRef.current) {
        applyStageAnchorScroll(clampedZoom, stageX, stageY, anchorX, anchorY)
        pendingZoomAnchorRef.current = null
        return
      }

      setIsZooming(true)
      zoomPercentRef.current = clampedZoom
      setZoomPercent(clampedZoom)

      zoomSettleTimeoutRef.current = window.setTimeout(() => {
        setIsZooming(false)
        zoomSettleTimeoutRef.current = null
      }, 160)
    },
    [applyStageAnchorScroll]
  )

  const updateZoom = useCallback(
    (
      nextZoom: number,
      origin?: {
        clientX: number
        clientY: number
      }
    ) => {
      const viewport = viewportRef.current
      if (!viewport) return

      const currentZoom = zoomPercentRef.current
      const rect = viewport.getBoundingClientRect()
      const anchorX = origin ? origin.clientX - rect.left : viewport.clientWidth / 2
      const anchorY = origin ? origin.clientY - rect.top : viewport.clientHeight / 2
      const currentMetrics = getZoomMetrics(currentZoom)
      const anchoredStageX =
        (viewport.scrollLeft + anchorX - currentMetrics.gridOriginX) / currentMetrics.cellSize
      const anchoredStageY =
        (viewport.scrollTop + anchorY - currentMetrics.gridOriginY) / currentMetrics.cellSize

      setZoomWithStageAnchor(nextZoom, anchoredStageX, anchoredStageY, anchorX, anchorY)
    },
    [getZoomMetrics, setZoomWithStageAnchor]
  )

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    if (pendingResetViewRef.current && zoomPercent === 100) {
      pendingResetViewRef.current = false
      pendingZoomAnchorRef.current = null
      const centeredScroll = getDefaultCenteredScroll()
      applyViewportScroll(centeredScroll.left, centeredScroll.top, 100)
      return
    }

    const pendingAnchor = pendingZoomAnchorRef.current
    if (!pendingAnchor || pendingAnchor.zoom !== zoomPercent) return

    applyStageAnchorScroll(
      zoomPercent,
      pendingAnchor.stageX,
      pendingAnchor.stageY,
      pendingAnchor.anchorX,
      pendingAnchor.anchorY
    )
    pendingZoomAnchorRef.current = null
  }, [
    applyStageAnchorScroll,
    applyViewportScroll,
    getDefaultCenteredScroll,
    previewViewportHeight,
    previewViewportWidth,
    wrapperHeight,
    wrapperWidth,
    zoomPercent,
  ])

  const scheduleZoom = useCallback(
    (
      nextZoom: number,
      origin?: {
        clientX: number
        clientY: number
      }
    ) => {
      pendingZoomRef.current = {
        zoom: clampZoom(nextZoom),
        origin,
      }

      if (zoomFrameRef.current !== null) return

      zoomFrameRef.current = window.requestAnimationFrame(() => {
        zoomFrameRef.current = null
        const pendingZoom = pendingZoomRef.current
        pendingZoomRef.current = null
        if (!pendingZoom) return

        updateZoom(pendingZoom.zoom, pendingZoom.origin)
      })
    },
    [updateZoom]
  )

  const resetView = useCallback(() => {
    const wasDefaultZoom = zoomPercentRef.current === 100

    if (zoomFrameRef.current !== null) {
      window.cancelAnimationFrame(zoomFrameRef.current)
      zoomFrameRef.current = null
    }
    if (zoomSettleTimeoutRef.current !== null) {
      window.clearTimeout(zoomSettleTimeoutRef.current)
      zoomSettleTimeoutRef.current = null
    }

    pendingZoomRef.current = null
    pendingZoomAnchorRef.current = null
    pendingResetViewRef.current = true
    pinchPointersRef.current.clear()
    pinchStartDistRef.current = null
    pinchStartMidpointRef.current = null
    pinchStartScrollRef.current = null
    setIsZooming(false)
    zoomPercentRef.current = 100
    setZoomPercent(100)

    if (zoomLabelRef.current) {
      zoomLabelRef.current.textContent = '100%'
    }

    if (wasDefaultZoom) {
      pendingResetViewRef.current = false
      const centeredScroll = getDefaultCenteredScroll()
      applyViewportScroll(centeredScroll.left, centeredScroll.top, 100)
    }
  }, [applyViewportScroll, getDefaultCenteredScroll])

  const runCanvasPointerDown = useCallback(
    (input: {
      pointerId: number
      clientX: number
      clientY: number
      ctrlKey: boolean
      metaKey: boolean
      preventDefault: () => void
    }) => {
      if (highlightSelection && floatingStamp) {
        // A floating stamp captures all canvas drags: move it, don't select
        input.preventDefault()
        const hit = getCellFromClientPoint(input.clientX, input.clientY, 'stage')
        if (!hit) return
        stampMoveStartRef.current = {
          initAnchorRow: floatingStamp.anchorRow,
          initAnchorCol: floatingStamp.anchorCol,
          pointerRow: hit.row,
          pointerCol: hit.col,
        }
        selectionPointerIdRef.current = input.pointerId
        return
      }

      if (highlightSelection) {
        input.preventDefault()
        selectionPointerIdRef.current = input.pointerId
        setIsAddingSelection(input.ctrlKey || input.metaKey)
        setIsSelecting(true)
        const startHit = getCellFromClientPoint(input.clientX, input.clientY, 'stage')
        if (!startHit) return

        const nextRect = {
          startRow: startHit.row,
          startCol: startHit.col,
          endRow: startHit.row,
          endCol: startHit.col,
        }
        liveSelectionRectRef.current = nextRect
        setDragSelectionRect(nextRect)
        return
      }

      if (toolMode === 'shape') {
        const hit = getCellFromClientPoint(input.clientX, input.clientY)
        if (!hit) return
        input.preventDefault()
        shapeStartCellRef.current = { row: hit.row, col: hit.col }
        setShapeStartCell({ row: hit.row, col: hit.col })
        setShapeEndCell({ row: hit.row, col: hit.col })
        return
      }

      if (toolMode === 'text') {
        const hit = getCellFromClientPoint(input.clientX, input.clientY)
        if (!hit) return
        input.preventDefault()
        // If a box is already defined, check if click is inside it
        if (textAnchorCell && textBoxEnd) {
          const r1 = Math.min(textAnchorCell.row, textBoxEnd.row)
          const r2 = Math.max(textAnchorCell.row, textBoxEnd.row)
          const c1 = Math.min(textAnchorCell.col, textBoxEnd.col)
          const c2 = Math.max(textAnchorCell.col, textBoxEnd.col)
          if (hit.row >= r1 && hit.row <= r2 && hit.col >= c1 && hit.col <= c2) {
            // Start moving the box
            textIsMovingRef.current = true
            textMoveStartRef.current = {
              initAnchorRow: textAnchorCell.row, initAnchorCol: textAnchorCell.col,
              initBoxEndRow: textBoxEnd.row, initBoxEndCol: textBoxEnd.col,
              pointerRow: hit.row, pointerCol: hit.col,
            }
            return
          }
          // Click outside a box with typed content: leave it as-is (deselected,
          // not stamped) so clicking back inside resumes editing instead of
          // silently committing it. An empty box has nothing to lose, so it's
          // discarded to make room for the new one being started below.
          if (textInput.trim()) return
          setTextAnchorCell(null)
          setTextBoxEnd(null)
        }
        // Start drawing a new box
        textBoxStartRef.current = { row: hit.row, col: hit.col }
        setTextBoxEnd({ row: hit.row, col: hit.col })
        return
      }

      if (toolMode === 'eyedropper') {
        const hit = getCellFromClientPoint(input.clientX, input.clientY)
        if (!hit) return
        input.preventDefault()
        onEyedropperSample?.({ row: hit.row, col: hit.col })
        return
      }

      if (toolMode === 'fill') {
        const hit = getCellFromClientPoint(input.clientX, input.clientY)
        if (!hit) return
        input.preventDefault()
        onFillCell?.({ row: hit.row, col: hit.col })
        return
      }

      if (toolMode !== 'merge' && !activeColorRef.current) return

      const hit = getCellFromClientPoint(input.clientX, input.clientY)
      if (!hit) return

      input.preventDefault()

      onPaintStart()
      paintingPointerIdRef.current = input.pointerId
      setIsPainting(true)
      paintCell(hit.row, hit.col)
    },
    [getCellFromClientPoint, highlightSelection, toolMode, onPaintStart, paintCell,
     textAnchorCell, textBoxEnd, textInput, activeColor, onApplyShapeCells,
     traceImageRef, cells, onEyedropperSample, onFillCell,
     textFontSize, textFontFamily, textOrientation, textBold, textItalic, textOutline, floatingStamp]
  )

  const flushPendingTouchEdit = useCallback(() => {
    const pending = pendingTouchEditRef.current
    if (!pending) return false
    clearPendingTouchEdit()
    if (touchActivePointersRef.current.size > 1) return false
    if (!touchActivePointersRef.current.has(pending.pointerId)) return false

    runCanvasPointerDown({
      ...pending,
      preventDefault: () => {},
    })
    return true
  }, [clearPendingTouchEdit, runCanvasPointerDown])
  flushPendingTouchEditRef.current = flushPendingTouchEdit

  const handleCanvasPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (event.pointerType === 'touch') {
        touchActivePointersRef.current.add(event.pointerId)
        if (touchActivePointersRef.current.size > 1) {
          clearPendingTouchEdit()
          cancelActiveTouchEdit()
          return
        }

        const hasTouchEditAction =
          highlightSelection ||
          toolMode === 'shape' ||
          toolMode === 'text' ||
          toolMode === 'eyedropper' ||
          toolMode === 'fill' ||
          toolMode === 'merge' ||
          Boolean(activeColorRef.current)

        if (hasTouchEditAction) {
          event.preventDefault()
          clearPendingTouchEdit()
          pendingTouchEditRef.current = {
            pointerId: event.pointerId,
            clientX: event.clientX,
            clientY: event.clientY,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
          }
          pendingTouchEditTimeoutRef.current = window.setTimeout(() => {
            pendingTouchEditTimeoutRef.current = null
            flushPendingTouchEditRef.current?.()
          }, TOUCH_EDIT_GRACE_MS)
          return
        }
      }

      runCanvasPointerDown({
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        preventDefault: () => event.preventDefault(),
      })
    },
    [
      cancelActiveTouchEdit,
      clearPendingTouchEdit,
      highlightSelection,
      runCanvasPointerDown,
      toolMode,
    ]
  )

  const handleCanvasPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (event.pointerType === 'touch' && touchActivePointersRef.current.size > 1) return
      if (highlightSelection && stampMoveStartRef.current && selectionPointerIdRef.current === event.pointerId) {
        const hit = getCellFromClientPoint(event.clientX, event.clientY, 'stage')
        if (!hit) return
        const start = stampMoveStartRef.current
        onStampMoveRef.current?.({
          row: start.initAnchorRow + (hit.row - start.pointerRow),
          col: start.initAnchorCol + (hit.col - start.pointerCol),
        })
        return
      }
      if (highlightSelection && isSelecting && selectionPointerIdRef.current === event.pointerId) {
        const hit = getCellFromClientPoint(event.clientX, event.clientY, 'stage')
        if (!hit) return

        const current = liveSelectionRectRef.current
        if (!current) return
        if (current.endRow === hit.row && current.endCol === hit.col) return

        const nextRect = {
          ...current,
          endRow: hit.row,
          endCol: hit.col,
        }
        liveSelectionRectRef.current = nextRect
        setDragSelectionRect(nextRect)
        return
      }

      if (toolMode === 'shape' && shapeStartCellRef.current) {
        const hit = getCellFromClientPoint(event.clientX, event.clientY)
        if (!hit) return
        setShapeEndCell({ row: hit.row, col: hit.col })
        return
      }

      if (toolMode === 'text' && textIsMovingRef.current) {
        const hit = getCellFromClientPoint(event.clientX, event.clientY)
        if (!hit || !textMoveStartRef.current) return
        const dr = hit.row - textMoveStartRef.current.pointerRow
        const dc = hit.col - textMoveStartRef.current.pointerCol
        setTextAnchorCell({
          row: textMoveStartRef.current.initAnchorRow + dr,
          col: textMoveStartRef.current.initAnchorCol + dc,
        })
        setTextBoxEnd({
          row: textMoveStartRef.current.initBoxEndRow + dr,
          col: textMoveStartRef.current.initBoxEndCol + dc,
        })
        return
      }

      if (toolMode === 'text' && textBoxStartRef.current) {
        const hit = getCellFromClientPoint(event.clientX, event.clientY)
        if (!hit) return
        setTextBoxEnd({ row: hit.row, col: hit.col })
        return
      }

      if (!isPainting || paintingPointerIdRef.current !== event.pointerId) return

      const hit = getCellFromClientPoint(event.clientX, event.clientY)
      if (!hit) return

      paintCell(hit.row, hit.col)
    },
    [getCellFromClientPoint, highlightSelection, toolMode, isPainting, isSelecting, paintCell]
  )

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return

      event.preventDefault()
      const direction = event.deltaY < 0 ? 1 : -1
      const magnitude = Math.min(54, Math.max(12, Math.abs(event.deltaY) * 0.14))
      const currentTarget = pendingZoomRef.current?.zoom ?? zoomPercentRef.current
      // Trackpad pinch arrives as a ctrl+wheel event, but on some platforms
      // (notably Chrome on Windows) its clientX/clientY report the viewport
      // origin rather than the cursor, which anchored zoom at the top-left. The
      // cursor is stationary during a pinch, so the last real pointer position
      // over the canvas is the dependable anchor; fall back to the event's own
      // coords for a physical mouse wheel with no prior pointer move.
      const anchor = lastPointerClientRef.current ?? { clientX: event.clientX, clientY: event.clientY }
      scheduleZoom(currentTarget + direction * magnitude, anchor)
    }

    const handleViewportPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return
      pinchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

      if (pinchPointersRef.current.size === 2) {
        clearPendingTouchEdit()
        cancelActiveTouchEdit()
        const [p1, p2] = Array.from(pinchPointersRef.current.values())
        pinchStartDistRef.current = Math.hypot(p2.x - p1.x, p2.y - p1.y)
        pinchStartZoomRef.current = zoomPercentRef.current
        pinchStartMidpointRef.current = {
          x: (p1.x + p2.x) / 2,
          y: (p1.y + p2.y) / 2,
        }
        pinchStartScrollRef.current = {
          left: viewport.scrollLeft,
          top: viewport.scrollTop,
        }
      }
    }

    const handleViewportPointerMove = (event: PointerEvent) => {
      lastPointerClientRef.current = { clientX: event.clientX, clientY: event.clientY }
      if (event.pointerType !== 'touch') return
      if (!pinchPointersRef.current.has(event.pointerId)) return
      pinchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (pinchPointersRef.current.size !== 2) return
      event.preventDefault()
      const [p1, p2] = Array.from(pinchPointersRef.current.values())
      const currentDist = Math.hypot(p2.x - p1.x, p2.y - p1.y)
      const currentMidpoint = {
        x: (p1.x + p2.x) / 2,
        y: (p1.y + p2.y) / 2,
      }

      if (
        pinchStartDistRef.current === null ||
        pinchStartMidpointRef.current === null ||
        pinchStartScrollRef.current === null
      ) {
        pinchStartDistRef.current = currentDist
        pinchStartZoomRef.current = zoomPercentRef.current
        pinchStartMidpointRef.current = currentMidpoint
        pinchStartScrollRef.current = {
          left: viewport.scrollLeft,
          top: viewport.scrollTop,
        }
        return
      }

      const scale = currentDist / pinchStartDistRef.current
      const rect = viewport.getBoundingClientRect()
      const startMetrics = getZoomMetrics(pinchStartZoomRef.current)
      const startAnchorX = pinchStartMidpointRef.current.x - rect.left
      const startAnchorY = pinchStartMidpointRef.current.y - rect.top
      const currentAnchorX = currentMidpoint.x - rect.left
      const currentAnchorY = currentMidpoint.y - rect.top
      const anchoredStageX =
        (pinchStartScrollRef.current.left + startAnchorX - startMetrics.gridOriginX) /
        startMetrics.cellSize
      const anchoredStageY =
        (pinchStartScrollRef.current.top + startAnchorY - startMetrics.gridOriginY) /
        startMetrics.cellSize

      setZoomWithStageAnchor(
        pinchStartZoomRef.current * scale,
        anchoredStageX,
        anchoredStageY,
        currentAnchorX,
        currentAnchorY
      )
    }

    const handleViewportPointerUp = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return
      pinchPointersRef.current.delete(event.pointerId)
      if (pinchPointersRef.current.size < 2) {
        pinchStartDistRef.current = null
        pinchStartMidpointRef.current = null
        pinchStartScrollRef.current = null
      }
    }

    const handleViewportPointerLeave = () => {
      lastPointerClientRef.current = null
    }

    viewport.addEventListener('wheel', handleWheel, { passive: false })
    viewport.addEventListener('pointerdown', handleViewportPointerDown)
    viewport.addEventListener('pointermove', handleViewportPointerMove, { passive: false })
    viewport.addEventListener('pointerup', handleViewportPointerUp)
    viewport.addEventListener('pointercancel', handleViewportPointerUp)
    viewport.addEventListener('pointerleave', handleViewportPointerLeave)

    return () => {
      viewport.removeEventListener('wheel', handleWheel)
      viewport.removeEventListener('pointerdown', handleViewportPointerDown)
      viewport.removeEventListener('pointermove', handleViewportPointerMove)
      viewport.removeEventListener('pointerup', handleViewportPointerUp)
      viewport.removeEventListener('pointercancel', handleViewportPointerUp)
      viewport.removeEventListener('pointerleave', handleViewportPointerLeave)
    }
  }, [cancelActiveTouchEdit, clearPendingTouchEdit, getZoomMetrics, scheduleZoom, setZoomWithStageAnchor])

  const renderSelections = useMemo(
    () =>
      dragSelectionRect
        ? isAddingSelection
          ? [...selectionRects, dragSelectionRect]
          : [dragSelectionRect]
        : selectionRects,
    [dragSelectionRect, isAddingSelection, selectionRects]
  )
  const activeRenderSelections = selectionRects
  const effectiveDisplayMode = isZooming && displayMode === 'stitched' ? 'flat' : displayMode

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const context = canvas.getContext('2d')
    if (!context) return

    const baseDevicePixelRatio = isZooming ? 1 : Math.min(window.devicePixelRatio || 1, 1.25)
    const devicePixelRatio = getSafeDevicePixelRatio(wrapperWidth, wrapperHeight, baseDevicePixelRatio)
    const nextCanvasWidth = Math.round(wrapperWidth * devicePixelRatio)
    const nextCanvasHeight = Math.round(wrapperHeight * devicePixelRatio)
    const canvasSizeChanged =
      canvasSizeRef.current?.width !== nextCanvasWidth ||
      canvasSizeRef.current?.height !== nextCanvasHeight

    if (canvasSizeChanged) {
      canvas.width = nextCanvasWidth
      canvas.height = nextCanvasHeight
      canvasSizeRef.current = {
        width: nextCanvasWidth,
        height: nextCanvasHeight,
      }
    }

    canvas.style.width = `${wrapperWidth}px`
    canvas.style.height = `${wrapperHeight}px`

    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
    const activeFocusRegions = activeRenderSelections
    // While a stamp floats, mute the active-color highlight so the canvas reads normally
    const cellHighlightColor = floatingStamp ? null : activeColor
    const renderSignature = [
      wrapperWidth,
      wrapperHeight,
      cellSize,
      effectiveDisplayMode,
      cellHighlightColor ?? '',
      highlightSelection,
      activeFocusRegions
        .map((selection) =>
          [
            selection.startRow,
            selection.startCol,
            selection.endRow,
            selection.endCol,
          ].join(':')
        )
        .join('|'),
      gridOriginX,
      gridOriginY,
      contentOriginCol,
      contentOriginRow,
      borderStitches,
      rows,
      cols,
    ].join(':')
    const requiresFullRedraw =
      canvasSizeChanged ||
      previousRenderSignatureRef.current !== renderSignature ||
      previousCellsRef.current === null

    if (requiresFullRedraw) {
      context.clearRect(0, 0, wrapperWidth, wrapperHeight)
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, wrapperWidth, wrapperHeight)

      // Only iterate the design+border region (skip the large white stage margin)
      for (let row = contentOriginRow; row < contentOriginRow + totalRows; row += 1) {
        for (let col = contentOriginCol; col < contentOriginCol + totalCols; col += 1) {
          const sourceRow = row - contentOriginRow - borderStitches
          const sourceCol = col - contentOriginCol - borderStitches
          const inDesign =
            sourceRow >= 0 && sourceRow < rows && sourceCol >= 0 && sourceCol < cols
          const color = inDesign ? cells[sourceRow][sourceCol] : '#FFFFFF'
          const x = gridOriginX + col * cellSize
          const y = gridOriginY + row * cellSize

          if (isZooming) {
            context.fillStyle = color === BLANK_CELL ? '#fffdf8' : color === FINISH_OUTLINE_CELL ? '#000000' : color
            context.fillRect(x, y, cellSize + 0.5, cellSize + 0.5)
            continue
          }

          drawCanvasCell({
            context,
            activeColor: cellHighlightColor,
            color,
            cellSize: cellSize,
            displayMode: effectiveDisplayMode,
            highlightSelection,
            inDesign,
            isInsideFocusRegion: isWithinSelections(activeFocusRegions, sourceRow, sourceCol),
            focusRegionActive: activeFocusRegions.length > 0,
            x,
            y,
          })
        }
      }
    } else {
      const previousCells = previousCellsRef.current!
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          if (previousCells[row][col] === cells[row][col]) continue

          const x = gridOriginX + (col + borderStitches + contentOriginCol) * cellSize
          const y = gridOriginY + (row + borderStitches + contentOriginRow) * cellSize

          drawCanvasCell({
            context,
            activeColor: cellHighlightColor,
            color: cells[row][col],
            cellSize: cellSize,
            displayMode: effectiveDisplayMode,
            highlightSelection,
            inDesign: true,
            isInsideFocusRegion: isWithinSelections(activeFocusRegions, row, col),
            focusRegionActive: activeFocusRegions.length > 0,
            x,
            y,
          })
        }
      }
    }

    previousCellsRef.current = cells.map((row) => [...row])
    previousRenderSignatureRef.current = renderSignature
  }, [
    borderStitches,
    cellSize,
    cells,
    cols,
    effectiveDisplayMode,
    activeColor,
    floatingStamp,
    highlightSelection,
    activeRenderSelections,
    gridOriginX,
    gridOriginY,
    contentOriginCol,
    contentOriginRow,
    rows,
    stageCols,
    stageRows,
    wrapperHeight,
    wrapperWidth,
    isZooming,
  ])

  useEffect(() => {
    const overlayCanvas = overlayCanvasRef.current
    if (!overlayCanvas) return

    const baseDevicePixelRatio = isZooming ? 1 : Math.min(window.devicePixelRatio || 1, 1.25)
    const devicePixelRatio = getSafeDevicePixelRatio(wrapperWidth, wrapperHeight, baseDevicePixelRatio)
    const nextCanvasWidth = Math.round(wrapperWidth * devicePixelRatio)
    const nextCanvasHeight = Math.round(wrapperHeight * devicePixelRatio)
    const canvasSizeChanged =
      overlayCanvasSizeRef.current?.width != nextCanvasWidth ||
      overlayCanvasSizeRef.current?.height != nextCanvasHeight

    if (canvasSizeChanged) {
      overlayCanvas.width = nextCanvasWidth
      overlayCanvas.height = nextCanvasHeight
      overlayCanvasSizeRef.current = {
        width: nextCanvasWidth,
        height: nextCanvasHeight,
      }
    }

    overlayCanvas.style.width = `${wrapperWidth}px`
    overlayCanvas.style.height = `${wrapperHeight}px`

    const context = overlayCanvas.getContext('2d')
    if (!context) return

    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
    context.clearRect(0, 0, wrapperWidth, wrapperHeight)

    // Design area border
    const designX = gridOriginX + (contentOriginCol + borderStitches) * cellSize
    const designY = gridOriginY + (contentOriginRow + borderStitches) * cellSize
    const designW = cols * cellSize
    const designH = rows * cellSize
    context.strokeStyle = 'rgba(180, 168, 152, 0.55)'
    context.lineWidth = 1
    context.strokeRect(designX, designY, designW, designH)

    if (traceOpacity > 0 && traceImageRef.current) {
      context.globalAlpha = traceOpacity
      context.drawImage(traceImageRef.current, designX, designY, designW, designH)
      context.globalAlpha = 1
    }

    // Text tool: dashed box border + text preview
    if (toolMode === 'text' && textBoxEnd) {
      const boxStart = textBoxStartRef.current ?? textAnchorCell
      if (boxStart) {
        const r1 = Math.min(boxStart.row, textBoxEnd.row)
        const c1 = Math.min(boxStart.col, textBoxEnd.col)
        const r2 = Math.max(boxStart.row, textBoxEnd.row)
        const c2 = Math.max(boxStart.col, textBoxEnd.col)
        const bx = gridOriginX + (c1 + contentOriginCol + borderStitches) * cellSize
        const by = gridOriginY + (r1 + contentOriginRow + borderStitches) * cellSize
        const bw = (c2 - c1 + 1) * cellSize
        const bh = (r2 - r1 + 1) * cellSize
        context.strokeStyle = 'rgba(0, 0, 0, 0.85)'
        context.lineWidth = 1.5
        context.setLineDash([Math.max(3, cellSize * 0.3), Math.max(2, cellSize * 0.2)])
        context.strokeRect(bx, by, bw, bh)
        context.setLineDash([])
        // Corner handles
        const h = Math.max(3, Math.min(cellSize * 0.4, 8))
        context.fillStyle = '#000'
        for (const [cx, cy] of [[bx, by], [bx + bw, by], [bx, by + bh], [bx + bw, by + bh]]) {
          context.fillRect(cx - h / 2, cy - h / 2, h, h)
        }
      }
      // Text preview + cursor from anchor
      if (textAnchorCell && activeColor) {
        if (textInput) {
          const previewCells = getTextCells(textInput, textAnchorCell.row, textAnchorCell.col, textFontSize, textFontFamily, activeColor, { bold: textBold, italic: textItalic, outline: textOutline }, textOrientation)
          context.globalAlpha = 0.85
          for (const cell of previewCells) {
            const stageRow = cell.row + contentOriginRow + borderStitches
            const stageCol = cell.col + contentOriginCol + borderStitches
            if (stageRow < 0 || stageRow >= stageRows || stageCol < 0 || stageCol >= stageCols) continue
            const x = gridOriginX + stageCol * cellSize
            const y = gridOriginY + stageRow * cellSize
            context.fillStyle = cell.color
            context.fillRect(x, y, cellSize, cellSize)
            context.strokeStyle = 'rgba(0,0,0,0.18)'
            context.lineWidth = 0.5
            context.strokeRect(x, y, cellSize, cellSize)
          }
          context.globalAlpha = 1
        }
        // Blinking cursor — a bar spanning the glyph height, oriented to
        // match which way the text advances.
        if (textCursorVisible) {
          const caret = getCaretPlacement(textInput, textFontSize, textFontFamily, { bold: textBold, italic: textItalic }, textOrientation)
          const stageRow = textAnchorCell.row + caret.row + contentOriginRow + borderStitches
          const stageCol = textAnchorCell.col + caret.col + contentOriginCol + borderStitches
          if (stageRow >= 0 && stageRow < stageRows && stageCol >= 0 && stageCol < stageCols) {
            const cx = gridOriginX + stageCol * cellSize
            const cy = gridOriginY + stageRow * cellSize
            const thin = Math.max(1.5, cellSize * 0.18)
            context.fillStyle = activeColor
            context.globalAlpha = 0.9
            if (caret.axis === 'vertical') context.fillRect(cx, cy, thin, caret.span * cellSize)
            else context.fillRect(cx, cy, caret.span * cellSize, thin)
            context.globalAlpha = 1
          }
        }
      }
    }

    // Shape drag preview
    if (toolMode === 'shape' && shapeStartCell && shapeEndCell && shapeType) {
      const previewCells = computeShapeCells(
        shapeType,
        shapeStartCell.row, shapeStartCell.col,
        shapeEndCell.row, shapeEndCell.col,
        shapeFillColor ?? null,
        shapeBorderColor ?? null,
        rows, cols,
        shapeBorderSize,
        arcFlipped,
        arcFullCircle,
      )
      for (const cell of previewCells) {
        const stageRow = cell.row + contentOriginRow + borderStitches
        const stageCol = cell.col + contentOriginCol + borderStitches
        const x = gridOriginX + stageCol * cellSize
        const y = gridOriginY + stageRow * cellSize
        context.globalAlpha = 0.7
        context.fillStyle = cell.color === BLANK_CELL ? '#fffdf8' : cell.color
        context.fillRect(x, y, cellSize, cellSize)
        context.globalAlpha = 1
        context.strokeStyle = 'rgba(0,0,0,0.25)'
        context.lineWidth = 0.5
        context.strokeRect(x, y, cellSize, cellSize)
      }
    }

    const designCenterX = gridOriginX + (contentOriginCol + borderStitches + cols / 2) * cellSize
    const designCenterY = gridOriginY + (contentOriginRow + borderStitches + rows / 2) * cellSize
    drawCenterReferenceCross({
      context,
      x: designCenterX,
      y: designCenterY,
      cellSize,
    })

    // Floating stamp (cut/copy/paste) preview
    if (highlightSelection && floatingStamp) {
      const stampRows = floatingStamp.cells.length
      const stampCols = floatingStamp.cells[0]?.length ?? 0
      context.globalAlpha = 0.9
      for (let r = 0; r < stampRows; r += 1) {
        for (let c = 0; c < stampCols; c += 1) {
          const color = floatingStamp.cells[r][c]
          if (color === null) continue
          const stageRow = floatingStamp.anchorRow + r + contentOriginRow + borderStitches
          const stageCol = floatingStamp.anchorCol + c + contentOriginCol + borderStitches
          if (stageRow < 0 || stageRow >= stageRows || stageCol < 0 || stageCol >= stageCols) continue
          const x = gridOriginX + stageCol * cellSize
          const y = gridOriginY + stageRow * cellSize
          context.fillStyle = color
          context.fillRect(x, y, cellSize, cellSize)
          context.strokeStyle = 'rgba(0,0,0,0.15)'
          context.lineWidth = 0.5
          context.strokeRect(x, y, cellSize, cellSize)
        }
      }
      context.globalAlpha = 1
      const bx = gridOriginX + (floatingStamp.anchorCol + contentOriginCol + borderStitches) * cellSize
      const by = gridOriginY + (floatingStamp.anchorRow + contentOriginRow + borderStitches) * cellSize
      context.strokeStyle = 'rgba(74, 124, 89, 0.95)'
      context.lineWidth = Math.max(1.5, cellSize * 0.1)
      context.setLineDash([Math.max(4, cellSize * 0.35), Math.max(2, cellSize * 0.2)])
      context.strokeRect(bx, by, stampCols * cellSize, stampRows * cellSize)
      context.setLineDash([])
    }

    if (!renderSelections.length) return

    renderSelections.forEach((overlaySelection) => {
      const top = Math.min(overlaySelection.startRow, overlaySelection.endRow)
      const bottom = Math.max(overlaySelection.startRow, overlaySelection.endRow)
      const left = Math.min(overlaySelection.startCol, overlaySelection.endCol)
      const right = Math.max(overlaySelection.startCol, overlaySelection.endCol)
      const x = gridOriginX + (left + borderStitches + contentOriginCol) * cellSize
      const y = gridOriginY + (top + borderStitches + contentOriginRow) * cellSize
      const width = (right - left + 1) * cellSize
      const height = (bottom - top + 1) * cellSize

      context.fillStyle = 'rgba(255, 196, 0, 0.12)'
      context.fillRect(x, y, width, height)
      context.strokeStyle = 'rgba(255, 196, 0, 0.9)'
      context.lineWidth = Math.max(1, cellSize * 0.08)
      context.setLineDash([Math.max(4, cellSize * 0.35), Math.max(2, cellSize * 0.2)])
      context.strokeRect(x, y, width, height)
      context.setLineDash([])
    })
  }, [
    borderStitches,
    cellSize,
    cols,
    contentOriginCol,
    contentOriginRow,
    dragSelectionRect,
    gridOriginX,
    gridOriginY,
    renderSelections,
    rows,
    shapeBorderColor,
    shapeFillColor,
    shapeEndCell,
    shapeStartCell,
    shapeType,
    toolMode,
    wrapperHeight,
    wrapperWidth,
    isZooming,
    traceOpacity,
    traceImageUrl,
    textAnchorCell,
    textBoxEnd,
    textInput,
    textFontSize,
    textFontFamily,
    textOrientation,
    textBold,
    textItalic,
    textOutline,
    textCursorVisible,
    activeColor,
    highlightSelection,
    floatingStamp,
    stageRows,
    stageCols,
  ])

  // Real, non-degenerate geometry for the hidden keyboard-capture input,
  // aligned over the active text box. iOS/iPadOS Safari's anti-abuse
  // heuristics dismiss the keyboard shortly after focusing a 1x1/opacity:0
  // input — it has to look like a legitimate on-screen target to stick.
  const textInputAnchorCol = Math.min(textAnchorCell?.col ?? 0, textBoxEnd?.col ?? textAnchorCell?.col ?? 0)
  const textInputAnchorRow = Math.min(textAnchorCell?.row ?? 0, textBoxEnd?.row ?? textAnchorCell?.row ?? 0)
  const textInputSpanCols = Math.abs((textBoxEnd?.col ?? textInputAnchorCol) - textInputAnchorCol) + 1
  const textInputSpanRows = Math.abs((textBoxEnd?.row ?? textInputAnchorRow) - textInputAnchorRow) + 1
  const textInputBoxStyle = {
    left: gridOriginX + (textInputAnchorCol + contentOriginCol + borderStitches) * cellSize,
    top: gridOriginY + (textInputAnchorRow + contentOriginRow + borderStitches) * cellSize,
    width: Math.max(44, textInputSpanCols * cellSize),
    height: Math.max(36, textInputSpanRows * cellSize),
  }

  return (
    <div
      ref={containerRef}
      style={{
        display: 'grid',
        gridTemplateRows: 'auto minmax(0, 1fr)',
        justifyContent: 'stretch',
        alignContent: 'start',
        width: '100%',
        minWidth: 0,
        maxWidth: '100%',
        minHeight: 0,
        height: '100%',
        boxSizing: 'border-box',
        background: '#f7f7f7',
        padding: isMobile ? 5 : 8,
        borderRadius: 12,
        gap: isMobile ? 4 : 8,
        userSelect: 'none',
        WebkitUserSelect: 'none',
        // @ts-ignore — non-standard but required for iOS Safari
        WebkitTouchCallout: 'none',
      }}
    >
      <div
        ref={toolbarRef}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: isMobile ? 6 : 12,
          flexWrap: 'wrap',
        }}
      >
        {!isPhoneLandscape && <strong style={{ fontSize: isMobile ? 11 : 14 }}>Stitch Preview</strong>}
        <div style={{ display: 'flex', alignItems: 'center', gap: isPhoneLandscape ? 2 : isMobile ? 4 : 8, flexShrink: 0 }}>
          <div
            style={{
              display: 'inline-grid',
              gridTemplateColumns: 'repeat(2, auto)',
              gap: 4,
              padding: isMobile ? 2 : 3,
              border: '1px solid #d7d7d7',
              borderRadius: 999,
              background: '#ffffff',
            }}
          >
            <button
              type="button"
              onClick={() => setDisplayMode('flat')}
              style={{
                padding: toolbarButtonPadding,
                borderRadius: 999,
                border: 'none',
                fontFamily: 'inherit',
                fontSize: 13,
                cursor: 'pointer',
                background: displayMode === 'flat' ? '#111' : 'transparent',
                color: displayMode === 'flat' ? '#fff' : '#333',
              }}
            >
              Flat
            </button>
            <button
              type="button"
              onClick={() => setDisplayMode('stitched')}
              style={{
                padding: toolbarButtonPadding,
                borderRadius: 999,
                border: 'none',
                fontFamily: 'inherit',
                fontSize: 13,
                cursor: 'pointer',
                background: displayMode === 'stitched' ? '#111' : 'transparent',
                color: displayMode === 'stitched' ? '#fff' : '#333',
              }}
            >
              Stitched
            </button>
          </div>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              border: '1px solid #d7d7d7',
              borderRadius: 999,
              background: '#ffffff',
              overflow: 'hidden',
            }}
          >
            <button
              type="button"
              onClick={() => scheduleZoom(Math.ceil((zoomPercentRef.current - ZOOM_BUTTON_STEP) / 10) * 10, lastPointerClientRef.current ?? undefined)}
              disabled={zoomPercentRef.current <= 100}
              style={{ padding: toolbarButtonPadding, border: 'none', background: 'transparent', fontFamily: 'inherit', fontSize: 14, cursor: 'pointer', lineHeight: 1 }}
            >
              −
            </button>
            <span ref={zoomLabelRef} style={{ minWidth: isPhoneLandscape ? 32 : 44, textAlign: 'center', fontSize: 13, userSelect: 'none' }}>
              {Math.round(zoomPercent)}%
            </span>
            <button
              type="button"
              onClick={() => scheduleZoom(Math.floor((zoomPercentRef.current + ZOOM_BUTTON_STEP) / 10) * 10, lastPointerClientRef.current ?? undefined)}
              disabled={zoomPercentRef.current >= MAX_ZOOM_PERCENT}
              style={{ padding: toolbarButtonPadding, border: 'none', background: 'transparent', fontFamily: 'inherit', fontSize: 14, cursor: 'pointer', lineHeight: 1 }}
            >
              +
            </button>
          </div>
          <button
            type="button"
            onClick={resetView}
            aria-label="Reset view"
            style={{ padding: toolbarButtonPadding, border: '1px solid #d7d7d7', borderRadius: 999, background: '#ffffff', fontFamily: 'inherit', fontSize: 13, cursor: 'pointer', color: '#555', whiteSpace: 'nowrap' }}
          >
            {isPhoneLandscape ? '↺' : 'Reset'}
          </button>
          {(() => {
            // macOS/Chromium overlay scrollbars stay hidden until an active
            // scroll gesture, and drag-to-paint hijacks click-drag panning —
            // for a canvas much wider than the viewport (a belt) there's
            // otherwise no discoverable way to see the rest of the design.
            // Keyed off the actual content width, not wrapperWidth (which
            // includes generous stage padding around any design, so it
            // would show these for every design, not just overflowing ones).
            //
            // Always mounted (visibility toggled, not conditionally
            // rendered) so this group's width doesn't come and go — mounting
            // it used to widen the button cluster, and since the cluster is
            // right-anchored (justifyContent: 'space-between' on the parent
            // row), that shifted every earlier button — including Reset —
            // left by its width, right into the spot the zoom "+" button had
            // just been clicked at.
            const canScroll = totalCols * cellSize > previewViewportWidth
            return (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                border: '1px solid #d7d7d7',
                borderRadius: 999,
                background: '#ffffff',
                overflow: 'hidden',
                visibility: canScroll ? 'visible' : 'hidden',
              }}
            >
              <button
                type="button"
                tabIndex={canScroll ? 0 : -1}
                onClick={() => viewportRef.current?.scrollBy({ left: -previewViewportWidth * 0.75, behavior: 'smooth' })}
                aria-label="Scroll left"
                style={{ padding: toolbarButtonPadding, border: 'none', background: 'transparent', fontFamily: 'inherit', fontSize: 14, cursor: 'pointer', lineHeight: 1 }}
              >
                ‹
              </button>
              <button
                type="button"
                tabIndex={canScroll ? 0 : -1}
                onClick={() => viewportRef.current?.scrollBy({ left: previewViewportWidth * 0.75, behavior: 'smooth' })}
                aria-label="Scroll right"
                style={{ padding: toolbarButtonPadding, border: 'none', background: 'transparent', fontFamily: 'inherit', fontSize: 14, cursor: 'pointer', lineHeight: 1 }}
              >
                ›
              </button>
            </div>
            )
          })()}
          {traceImageUrl && onTraceOpacityChange && (
            <label style={{ display: 'flex', alignItems: 'center', gap: isPhoneLandscape ? 3 : 6, fontSize: isMobile ? 11 : 12, color: '#8a8177', userSelect: 'none', flexShrink: 0 }}>
              Trace
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={traceOpacity}
                onChange={(e) => onTraceOpacityChange(parseFloat(e.target.value))}
                style={{ width: isPhoneLandscape ? 42 : isMobile ? 60 : 80, accentColor: '#6e8d67', cursor: 'pointer' }}
              />
            </label>
          )}
        </div>
      </div>

      <div
        style={{
          width: '100%',
          height: '100%',
          minHeight: 0,
          display: 'grid',
          justifyItems: 'center',
          alignItems: 'start',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <div
          style={{
            width: `${previewFrameWidth}px`,
            height: `${previewFrameHeight}px`,
            maxWidth: '100%',
            maxHeight: '100%',
            borderRadius: 8,
            border: '1px solid #e4e4e4',
            background: '#ffffff',
            display: 'grid',
            gridTemplateColumns: `${RULER_THICKNESS}px minmax(0, 1fr)`,
            gridTemplateRows: `${RULER_THICKNESS}px minmax(0, 1fr)`,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              gridColumn: '1 / 2',
              gridRow: '1 / 2',
              borderRight: '1px solid #ececec',
              borderBottom: '1px solid #ececec',
              background: '#fafafa',
            }}
          />

          <div
            style={{
              gridColumn: '2 / 3',
              gridRow: '1 / 2',
              position: 'relative',
              overflow: 'hidden',
              borderBottom: '1px solid #ececec',
              background: 'rgba(250, 250, 250, 0.96)',
            }}
          >
            {visibleHorizontalTicks.map((tick) => (
              <div
                key={`viewport-ruler-x-${tick.index}`}
                ref={(node) => {
                  horizontalRulerTickRefs.current[tick.index] = node
                }}
                style={{
                  position: 'absolute',
                  left: tick.position,
                  top: 0,
                  display: tick.visible ? 'block' : 'none',
                  transform: 'translateX(-0.5px)',
                }}
              >
                <div
                  style={{
                    width: 0,
                    height: tick.index % 2 === 0 ? 14 : 10,
                    borderLeft: '1px solid rgba(17,17,17,0.65)',
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    top: 12,
                    left:
                      tick.index === 0
                        ? 4
                        : tick.index === horizontalRulerTicks.length - 1
                          ? -4
                          : 0,
                    transform:
                      tick.index === 0
                        ? 'none'
                        : tick.index === horizontalRulerTicks.length - 1
                          ? 'translateX(-100%)'
                          : 'translateX(-50%)',
                    fontSize: 10,
                    color: '#5a5a5a',
                    whiteSpace: 'nowrap',
                    textAlign: 'center',
                  }}
                >
                  {tick.index}"
                </div>
              </div>
            ))}
          </div>

          <div
            style={{
              gridColumn: '1 / 2',
              gridRow: '2 / 3',
              position: 'relative',
              overflow: 'hidden',
              borderRight: '1px solid #ececec',
              background: 'rgba(250, 250, 250, 0.96)',
            }}
          >
            {visibleVerticalTicks.map((tick) => (
              <div
                key={`viewport-ruler-y-${tick.index}`}
                ref={(node) => {
                  verticalRulerTickRefs.current[tick.index] = node
                }}
                style={{
                  position: 'absolute',
                  top: tick.position,
                  left: 0,
                  display: tick.visible ? 'block' : 'none',
                  transform: 'translateY(-0.5px)',
                }}
              >
                <div
                  style={{
                    width: tick.index % 2 === 0 ? 14 : 10,
                    height: 0,
                    borderTop: '1px solid rgba(17,17,17,0.65)',
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    top:
                      tick.index === 0
                        ? 2
                        : tick.index === verticalRulerTicks.length - 1
                          ? -4
                          : 0,
                    transform:
                      tick.index === 0
                        ? 'none'
                        : tick.index === verticalRulerTicks.length - 1
                          ? 'translateY(-100%)'
                          : 'translateY(-50%)',
                    left: 15,
                    fontSize: 10,
                    color: '#5a5a5a',
                    writingMode: 'vertical-rl',
                    textOrientation: 'mixed',
                  }}
                >
                  {tick.index}"
                </div>
              </div>
            ))}
          </div>

          <style>{`
            .mns-grid-viewport::-webkit-scrollbar { height: 14px; width: 14px; }
            .mns-grid-viewport::-webkit-scrollbar-track { background: #f0ece5; }
            .mns-grid-viewport::-webkit-scrollbar-thumb { background: #b8ac9c; border-radius: 7px; border: 3px solid #f0ece5; }
            .mns-grid-viewport::-webkit-scrollbar-thumb:hover { background: #a89a86; }
            .mns-grid-viewport { scrollbar-width: auto; scrollbar-color: #b8ac9c #f0ece5; }
          `}</style>
          <div
            ref={viewportRef}
            className="mns-grid-viewport"
            style={{
              gridColumn: '2 / 3',
              gridRow: '2 / 3',
              width: `${previewViewportWidth}px`,
              height: `${previewViewportHeight}px`,
              minHeight: 0,
              minWidth: 0,
              overflowX: 'auto',
              overflowY: 'auto',
              touchAction: (activeColor || toolMode === 'merge' || toolMode === 'shape' || toolMode === 'text' || toolMode === 'eyedropper' || toolMode === 'fill' || highlightSelection) ? 'none' : 'pan-x pan-y',
              overscrollBehavior: 'contain',
              WebkitOverflowScrolling: 'touch',
            }}
          >
            <div
              style={{
                minWidth: '100%',
                minHeight: '100%',
                width: `${wrapperWidth}px`,
                height: `${wrapperHeight}px`,
                boxSizing: 'border-box',
                position: 'relative',
              }}
            >
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  position: 'relative',
                }}
              >
                <canvas
                  ref={canvasRef}
                  onPointerDown={handleCanvasPointerDown}
                  onPointerMove={handleCanvasPointerMove}
                  style={{
                    display: 'block',
                    cursor: toolMode === 'text' ? 'text' : (toolMode === 'eyedropper' || toolMode === 'fill') ? 'crosshair' : (toolMode === 'merge' || activeColor) ? (highlightSelection ? 'crosshair' : PAINTBRUSH_CURSOR) : 'default',
                    touchAction: (activeColor || toolMode === 'merge' || toolMode === 'shape' || toolMode === 'text' || toolMode === 'eyedropper' || toolMode === 'fill' || highlightSelection) ? 'none' : 'pan-x pan-y',
                  }}
                />
                <canvas
                  ref={overlayCanvasRef}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'block',
                    pointerEvents: 'none',
                  }}
                />
                {/* Always-mounted keyboard capture, positioned over the active text box.
                    Real geometry (not 1x1/opacity:0) so iOS/iPadOS Safari treats it as a
                    legitimate focus target instead of dismissing the keyboard after a frame. */}
                <input
                  ref={textInputRef}
                  value={textInput}
                  autoCorrect="off"
                  autoCapitalize="off"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => {
                    if (toolMode === 'text' && textAnchorCell && textBoxEnd) setTextInput(e.target.value)
                  }}
                  onKeyDown={(e) => {
                    if (toolMode !== 'text' || !textAnchorCell || !textBoxEnd) return
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      commitTextBox()
                    } else if (e.key === 'Escape') {
                      discardTextBox()
                    }
                  }}
                  style={{
                    position: 'absolute',
                    left: textInputBoxStyle.left,
                    top: textInputBoxStyle.top,
                    width: textInputBoxStyle.width,
                    height: textInputBoxStyle.height,
                    color: 'transparent',
                    background: 'transparent',
                    caretColor: 'transparent',
                    border: 'none',
                    outline: 'none',
                    pointerEvents: 'none',
                  }}
                />
              </div>
              {signatureUrl && (
                // Live preview badge only — the design fills the whole active
                // canvas with no margin today, so this peeks outside the
                // corner rather than compositing into the design pixels
                // (the print/finalize output places it in the real margin).
                <div
                  style={{
                    position: 'absolute',
                    right: -14,
                    bottom: -14,
                    pointerEvents: 'none',
                    background: '#fffdf8',
                    border: '1px solid #d7d0c8',
                    borderRadius: 8,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                    padding: 4,
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={signatureUrl}
                    alt="Your signature"
                    style={{ display: 'block', maxWidth: 64, maxHeight: 44, objectFit: 'contain' }}
                  />
                </div>
              )}
              {skuUrl && (
                // Mirror of the signature badge above, bottom-left instead
                // of bottom-right — same peek-outside-the-corner caveat.
                <div
                  style={{
                    position: 'absolute',
                    left: -14,
                    bottom: -14,
                    pointerEvents: 'none',
                    background: '#fffdf8',
                    border: '1px solid #d7d0c8',
                    borderRadius: 8,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                    padding: 4,
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={skuUrl}
                    alt="Project SKU"
                    style={{ display: 'block', maxWidth: 64, maxHeight: 44, objectFit: 'contain' }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
        {canvasOverlay}
      </div>
    </div>
  )
}
