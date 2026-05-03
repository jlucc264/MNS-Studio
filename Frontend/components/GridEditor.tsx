'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

type ShapeCell = { row: number; col: number; color: string }

type Props = {
  cells: string[][]
  activeColor: string | null
  toolMode: 'paint' | 'select' | 'shape'
  meshCount: 13 | 18
  brushDensity: number
  onSelectionChange?: (selection: DesignSelectionRect[] | null) => void
  onPaintStart: () => void
  onPaintCells: (coords: Array<[number, number]>) => void
  shapeType?: 'box' | 'semicircle' | 'line'
  shapeFillColor?: string | null
  shapeBorderColor?: string | null
  onApplyShapeCells?: (cells: ShapeCell[]) => void
}

const PAINTBRUSH_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cpath d='M15.6 3.2l5.2 5.2-7.8 7.8-5.2-5.2z' fill='%23222'/%3E%3Cpath d='M6.8 11.9l5.3 5.3-1.1 2.7c-.3.8-1 1.4-1.9 1.6-2 .5-4-.4-4.8-2.3-.4-.9-.4-1.8 0-2.7l1.1-2.6z' fill='%23c43b3b'/%3E%3Cpath d='M15.1 2.7l6.2 6.2' stroke='%23fff' stroke-width='1.2' stroke-linecap='round'/%3E%3C/g%3E%3C/svg%3E") 4 20, crosshair`
const RULER_THICKNESS = 24
const PREVIEW_FRAME_WIDTH_UNITS = 13
const PREVIEW_FRAME_HEIGHT_UNITS = 9
const ZOOM_BUTTON_STEP = 50
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
  totalRows: number, totalCols: number
): Array<{ row: number; col: number; color: string }> {
  const top = Math.max(0, Math.min(r1, r2))
  const bottom = Math.min(totalRows - 1, Math.max(r1, r2))
  const left = Math.max(0, Math.min(c1, c2))
  const right = Math.min(totalCols - 1, Math.max(c1, c2))
  const result: Array<{ row: number; col: number; color: string }> = []
  for (let row = top; row <= bottom; row++) {
    for (let col = left; col <= right; col++) {
      const isBorder = row === top || row === bottom || col === left || col === right
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
  totalRows: number, totalCols: number
): Array<{ row: number; col: number; color: string }> {
  const color = borderColor ?? fillColor
  if (!color) return []
  const result: Array<{ row: number; col: number; color: string }> = []
  let row = r1, col = c1
  const dr = Math.abs(r2 - r1), dc = Math.abs(c2 - c1)
  const sr = r1 < r2 ? 1 : -1, sc = c1 < c2 ? 1 : -1
  let err = dr - dc
  for (;;) {
    if (row >= 0 && row < totalRows && col >= 0 && col < totalCols) {
      result.push({ row, col, color })
    }
    if (row === r2 && col === c2) break
    const e2 = 2 * err
    if (e2 > -dc) { err -= dc; row += sr }
    if (e2 < dr) { err += dr; col += sc }
  }
  return result
}

function getSemicircleCells(
  r1: number, c1: number, r2: number, c2: number,
  fillColor: string | null, borderColor: string | null,
  totalRows: number, totalCols: number
): Array<{ row: number; col: number; color: string }> {
  const topRow = Math.min(r1, r2)
  const botRow = Math.max(r1, r2)
  const leftCol = Math.min(c1, c2)
  const rightCol = Math.max(c1, c2)
  const cx = (leftCol + rightCol) / 2
  const cy = topRow
  const width = rightCol - leftCol
  const height = botRow - topRow
  const a = width / 2 + 0.5
  const b = height + 0.5
  const result: Array<{ row: number; col: number; color: string }> = []
  for (let row = Math.max(0, topRow); row <= Math.min(totalRows - 1, botRow); row++) {
    for (let col = Math.max(0, leftCol); col <= Math.min(totalCols - 1, rightCol); col++) {
      const nx = (col + 0.5 - cx) / a
      const ny = (row + 0.5 - cy) / b
      const inside = nx * nx + ny * ny <= 1 && row >= topRow
      if (!inside) continue
      // check if border: any neighbor outside
      const neighbors = [
        [row - 1, col], [row + 1, col], [row, col - 1], [row, col + 1]
      ]
      const isBorder = row === topRow || neighbors.some(([nr, nc]) => {
        if (nr < topRow) return true
        const nnx = (nc + 0.5 - cx) / a
        const nny = (nr + 0.5 - cy) / b
        return nnx * nnx + nny * nny > 1 || nr < topRow
      })
      if (isBorder) {
        if (borderColor) result.push({ row, col, color: borderColor })
      } else {
        if (fillColor) result.push({ row, col, color: fillColor })
      }
    }
  }
  return result
}

function computeShapeCells(
  shapeType: 'box' | 'semicircle' | 'line',
  r1: number, c1: number, r2: number, c2: number,
  fillColor: string | null, borderColor: string | null,
  totalRows: number, totalCols: number
): Array<{ row: number; col: number; color: string }> {
  const cr1 = Math.max(0, Math.min(totalRows - 1, r1))
  const cc1 = Math.max(0, Math.min(totalCols - 1, c1))
  const cr2 = Math.max(0, Math.min(totalRows - 1, r2))
  const cc2 = Math.max(0, Math.min(totalCols - 1, c2))
  if (shapeType === 'box') return getBoxCells(cr1, cc1, cr2, cc2, fillColor, borderColor, totalRows, totalCols)
  if (shapeType === 'line') return getLineCells(cr1, cc1, cr2, cc2, borderColor, fillColor, totalRows, totalCols)
  return getSemicircleCells(cr1, cc1, cr2, cc2, fillColor, borderColor, totalRows, totalCols)
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
  return Math.max(100, Math.min(400, nextZoom))
}

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
  onSelectionChange,
  onPaintStart,
  onPaintCells,
  shapeType,
  shapeFillColor,
  shapeBorderColor,
  onApplyShapeCells,
}: Props) {
  if (!cells.length) return null

  const highlightSelection = toolMode === 'select'

  const containerRef = useRef<HTMLDivElement | null>(null)
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const zoomLabelRef = useRef<HTMLSpanElement | null>(null)
  const horizontalRulerTickRefs = useRef<Array<HTMLDivElement | null>>([])
  const verticalRulerTickRefs = useRef<Array<HTMLDivElement | null>>([])
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const [containerSize, setContainerSize] = useState({ width: 640, height: 520 })
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
  const paintingPointerIdRef = useRef<number | null>(null)
  const selectionPointerIdRef = useRef<number | null>(null)
  const lastPaintedCellRef = useRef<string | null>(null)
  const gestureStartZoomRef = useRef(100)
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

  useLayoutEffect(() => {
    const node = containerRef.current
    if (!node) return

    const updateSize = () => {
      setContainerSize({
        width: node.clientWidth || 640,
        height: node.clientHeight || 520,
      })
    }

    updateSize()

    const observer = new ResizeObserver(updateSize)
    observer.observe(node)

    return () => observer.disconnect()
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
    }
  }, [])

  useEffect(() => {
    if (!highlightSelection) {
      setDragSelectionRect(null)
      setSelectionRects([])
      liveSelectionRectRef.current = null
      onSelectionChange?.(null)
    }
  }, [highlightSelection, onSelectionChange])

  useEffect(() => {
    const stopPainting = () => {
      if (toolMode === 'shape' && shapeStartCellRef.current && shapeEndCell) {
        const start = shapeStartCellRef.current
        if (shapeType && onApplyShapeCells) {
          const shapeCells = computeShapeCells(
            shapeType,
            start.row, start.col,
            shapeEndCell.row, shapeEndCell.col,
            shapeFillColor ?? null,
            shapeBorderColor ?? null,
            cells.length, cells[0]?.length ?? 0
          )
          if (shapeCells.length) onApplyShapeCells(shapeCells)
        }
        shapeStartCellRef.current = null
        setShapeStartCell(null)
        setShapeEndCell(null)
      }

      if (isSelecting && dragSelectionRect) {
        const nextSelectionRects = isAddingSelection
          ? [...selectionRects, dragSelectionRect]
          : [dragSelectionRect]
        setSelectionRects(nextSelectionRects)
        onSelectionChange?.(nextSelectionRects)
        liveSelectionRectRef.current = null
      }

      setIsPainting(false)
      setIsSelecting(false)
      setIsAddingSelection(false)
      setDragSelectionRect(null)
      paintingPointerIdRef.current = null
      selectionPointerIdRef.current = null
      lastPaintedCellRef.current = null
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
  ])

  const borderStitches = Math.floor(1 * meshCount)
  const rows = cells.length
  const cols = cells[0].length
  const totalRows = rows + borderStitches * 2
  const totalCols = cols + borderStitches * 2
  const stageRows = PREVIEW_FRAME_HEIGHT_UNITS * meshCount
  const stageCols = PREVIEW_FRAME_WIDTH_UNITS * meshCount
  const availableStageWidth = Math.max(containerSize.width - RULER_THICKNESS, 160)
  const availableStageHeight = Math.max(
    containerSize.height - toolbarHeight - 8 - RULER_THICKNESS,
    160
  )
  const baseCellSize = useMemo(
    () =>
      Math.max(
        1,
        Math.min(availableStageWidth / stageCols, availableStageHeight / stageRows)
      ),
    [availableStageHeight, availableStageWidth, stageCols, stageRows]
  )

  const cellSize = Math.max(1, (baseCellSize * zoomPercent) / 100)
  const stageWidth = stageCols * cellSize
  const stageHeight = stageRows * cellSize
  const previewViewportWidth = Math.round(stageCols * baseCellSize)
  const previewViewportHeight = Math.round(stageRows * baseCellSize)
  const previewFrameWidth = previewViewportWidth + RULER_THICKNESS
  const previewFrameHeight = previewViewportHeight + RULER_THICKNESS
  const wrapperWidth = Math.max(previewViewportWidth, Math.round(stageWidth))
  const wrapperHeight = Math.max(previewViewportHeight, Math.round(stageHeight))
  const gridOriginX = Math.max(0, (wrapperWidth - Math.round(stageWidth)) / 2)
  const gridOriginY = Math.max(0, (wrapperHeight - Math.round(stageHeight)) / 2)
  const contentOriginCol = Math.max(0, Math.floor((stageCols - totalCols) / 2))
  const contentOriginRow = Math.max(0, Math.floor((stageRows - totalRows) / 2))
  const inchStepPixels = meshCount * cellSize
  const horizontalRulerTicks = useMemo(
    () =>
      Array.from({ length: PREVIEW_FRAME_WIDTH_UNITS + 1 }, (_, index) => ({
        index,
        offset: index * inchStepPixels,
      })),
    [inchStepPixels]
  )
  const verticalRulerTicks = useMemo(
    () =>
      Array.from({ length: PREVIEW_FRAME_HEIGHT_UNITS + 1 }, (_, index) => ({
        index,
        offset: index * inchStepPixels,
      })),
    [inchStepPixels]
  )
  const visibleHorizontalTicks = useMemo(
    () =>
      horizontalRulerTicks.map((tick) => ({
        ...tick,
        position: tick.offset - scrollPosition.left,
        visible:
          tick.offset - scrollPosition.left >= -32 &&
          tick.offset - scrollPosition.left <= previewViewportWidth + 32,
      })),
    [horizontalRulerTicks, previewViewportWidth, scrollPosition.left]
  )
  const visibleVerticalTicks = useMemo(
    () =>
      verticalRulerTicks.map((tick) => ({
        ...tick,
        position: tick.offset - scrollPosition.top,
        visible:
          tick.offset - scrollPosition.top >= -32 &&
          tick.offset - scrollPosition.top <= previewViewportHeight + 32,
      })),
    [previewViewportHeight, scrollPosition.top, verticalRulerTicks]
  )

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
      const cellKey = `${row}-${col}-${brushDensityRef.current}`
      if (lastPaintedCellRef.current === cellKey) return

      lastPaintedCellRef.current = cellKey
      onPaintCells(buildBrushCoords(row, col))
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

      horizontalRulerTickRefs.current.forEach((tickNode, index) => {
        if (!tickNode) return

        const position = index * meshCount * nextCellSize - scrollLeft
        tickNode.style.left = `${position}px`
        tickNode.style.display =
          position >= -32 && position <= previewViewportWidth + 32 ? 'block' : 'none'
      })

      verticalRulerTickRefs.current.forEach((tickNode, index) => {
        if (!tickNode) return

        const position = index * meshCount * nextCellSize - scrollTop
        tickNode.style.top = `${position}px`
        tickNode.style.display =
          position >= -32 && position <= previewViewportHeight + 32 ? 'block' : 'none'
      })
    },
    [baseCellSize, meshCount, previewViewportHeight, previewViewportWidth]
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

  const updateZoom = useCallback(
    (
      nextZoom: number,
      origin?: {
        clientX: number
        clientY: number
      }
    ) => {
      const viewport = viewportRef.current
      const currentZoom = zoomPercentRef.current
      const clampedZoom = clampZoom(nextZoom)
      if (!viewport || clampedZoom === currentZoom) {
        zoomPercentRef.current = clampedZoom
        setZoomPercent(clampedZoom)
        return
      }

      const rect = viewport.getBoundingClientRect()
      const anchorX = origin ? origin.clientX - rect.left : viewport.clientWidth / 2
      const anchorY = origin ? origin.clientY - rect.top : viewport.clientHeight / 2
      const currentCellSize = Math.max(1, (baseCellSize * currentZoom) / 100)
      const currentStageWidth = stageCols * currentCellSize
      const currentStageHeight = stageRows * currentCellSize
      const currentWrapperWidth = Math.max(previewViewportWidth, Math.round(currentStageWidth))
      const currentWrapperHeight = Math.max(previewViewportHeight, Math.round(currentStageHeight))
      const currentGridOriginX = Math.max(0, (currentWrapperWidth - Math.round(currentStageWidth)) / 2)
      const currentGridOriginY = Math.max(0, (currentWrapperHeight - Math.round(currentStageHeight)) / 2)
      const anchoredStageX = (viewport.scrollLeft + anchorX - currentGridOriginX) / currentCellSize
      const anchoredStageY = (viewport.scrollTop + anchorY - currentGridOriginY) / currentCellSize

      if (zoomSettleTimeoutRef.current !== null) {
        window.clearTimeout(zoomSettleTimeoutRef.current)
      }

      pendingZoomAnchorRef.current = {
        zoom: clampedZoom,
        stageX: anchoredStageX,
        stageY: anchoredStageY,
        anchorX,
        anchorY,
      }

      setIsZooming(true)
      zoomPercentRef.current = clampedZoom
      setZoomPercent(clampedZoom)
      viewport.style.overflowX = clampedZoom > 100 ? 'auto' : 'hidden'
      viewport.style.overflowY = clampedZoom > 100 ? 'auto' : 'hidden'

      if (zoomLabelRef.current) {
        zoomLabelRef.current.textContent = `${Math.round(clampedZoom)}%`
      }

      zoomSettleTimeoutRef.current = window.setTimeout(() => {
        setIsZooming(false)
        zoomSettleTimeoutRef.current = null
      }, 160)
    },
    [baseCellSize, previewViewportHeight, previewViewportWidth, stageCols, stageRows]
  )

  useLayoutEffect(() => {
    const pendingAnchor = pendingZoomAnchorRef.current
    const viewport = viewportRef.current
    if (!pendingAnchor || !viewport || pendingAnchor.zoom !== zoomPercent) return

    const maxScrollLeft = Math.max(0, wrapperWidth - previewViewportWidth)
    const maxScrollTop = Math.max(0, wrapperHeight - previewViewportHeight)
    const nextScrollLeft =
      gridOriginX + pendingAnchor.stageX * cellSize - pendingAnchor.anchorX
    const nextScrollTop =
      gridOriginY + pendingAnchor.stageY * cellSize - pendingAnchor.anchorY

    viewport.scrollLeft = Math.max(0, Math.min(maxScrollLeft, nextScrollLeft))
    viewport.scrollTop = Math.max(0, Math.min(maxScrollTop, nextScrollTop))
    updateLiveRulers(zoomPercent, viewport.scrollLeft, viewport.scrollTop)
    setScrollPosition({
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
    })
    pendingZoomAnchorRef.current = null
  }, [
    cellSize,
    gridOriginX,
    gridOriginY,
    previewViewportHeight,
    previewViewportWidth,
    updateLiveRulers,
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

  const handleCanvasPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (event.pointerType === 'touch') return
      if (highlightSelection) {
        event.preventDefault()
        selectionPointerIdRef.current = event.pointerId
        setIsAddingSelection(event.ctrlKey || event.metaKey)
        setIsSelecting(true)
        const startHit = getCellFromClientPoint(event.clientX, event.clientY, 'stage')
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
        const hit = getCellFromClientPoint(event.clientX, event.clientY)
        if (!hit) return
        event.preventDefault()
        shapeStartCellRef.current = { row: hit.row, col: hit.col }
        setShapeStartCell({ row: hit.row, col: hit.col })
        setShapeEndCell({ row: hit.row, col: hit.col })
        return
      }

      if (!activeColorRef.current) return

      const hit = getCellFromClientPoint(event.clientX, event.clientY)
      if (!hit) return

      event.preventDefault()

      onPaintStart()
      paintingPointerIdRef.current = event.pointerId
      setIsPainting(true)
      paintCell(hit.row, hit.col)
    },
    [getCellFromClientPoint, highlightSelection, toolMode, onPaintStart, paintCell]
  )

  const handleCanvasPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
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
      scheduleZoom(currentTarget + direction * magnitude, {
        clientX: event.clientX,
        clientY: event.clientY,
      })
    }

    const handleGestureStart = (event: Event) => {
      event.preventDefault()
      gestureStartZoomRef.current = zoomPercentRef.current
    }

    const handleGestureChange = (event: Event) => {
      event.preventDefault()

      const gestureEvent = event as Event & {
        clientX?: number
        clientY?: number
        scale?: number
      }
      const scale = gestureEvent.scale ?? 1
      scheduleZoom(gestureStartZoomRef.current * scale, {
        clientX: gestureEvent.clientX ?? viewport.getBoundingClientRect().left + viewport.clientWidth / 2,
        clientY: gestureEvent.clientY ?? viewport.getBoundingClientRect().top + viewport.clientHeight / 2,
      })
    }

    viewport.addEventListener('wheel', handleWheel, { passive: false })
    viewport.addEventListener('gesturestart', handleGestureStart as EventListener, {
      passive: false,
    })
    viewport.addEventListener('gesturechange', handleGestureChange as EventListener, {
      passive: false,
    })

    return () => {
      viewport.removeEventListener('wheel', handleWheel)
      viewport.removeEventListener('gesturestart', handleGestureStart as EventListener)
      viewport.removeEventListener('gesturechange', handleGestureChange as EventListener)
    }
  }, [scheduleZoom])

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

    const devicePixelRatio = isZooming ? 1 : Math.min(window.devicePixelRatio || 1, 1.25)
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
    const renderSignature = [
      wrapperWidth,
      wrapperHeight,
      cellSize,
      effectiveDisplayMode,
      activeColor ?? '',
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

      for (let row = 0; row < stageRows; row += 1) {
        for (let col = 0; col < stageCols; col += 1) {
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
            activeColor,
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
            activeColor,
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

    const devicePixelRatio = isZooming ? 1 : Math.min(window.devicePixelRatio || 1, 1.25)
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

    // Shape drag preview
    if (toolMode === 'shape' && shapeStartCell && shapeEndCell && shapeType) {
      const previewCells = computeShapeCells(
        shapeType,
        shapeStartCell.row, shapeStartCell.col,
        shapeEndCell.row, shapeEndCell.col,
        shapeFillColor ?? null,
        shapeBorderColor ?? null,
        rows, cols
      )
      for (const cell of previewCells) {
        const stageRow = cell.row + contentOriginRow + borderStitches
        const stageCol = cell.col + contentOriginCol + borderStitches
        const x = gridOriginX + stageCol * cellSize
        const y = gridOriginY + stageRow * cellSize
        context.globalAlpha = 0.7
        context.fillStyle = cell.color
        context.fillRect(x, y, cellSize, cellSize)
        context.globalAlpha = 1
        context.strokeStyle = 'rgba(0,0,0,0.25)'
        context.lineWidth = 0.5
        context.strokeRect(x, y, cellSize, cellSize)
      }
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
  ])

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
        padding: 8,
        borderRadius: 12,
        gap: 8,
        overflow: 'hidden',
      }}
    >
      <div
        ref={toolbarRef}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <strong style={{ fontSize: 14 }}>Stitch Preview</strong>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div
            style={{
              display: 'inline-grid',
              gridTemplateColumns: 'repeat(2, auto)',
              gap: 4,
              padding: 3,
              border: '1px solid #d7d7d7',
              borderRadius: 999,
              background: '#ffffff',
            }}
          >
            <button
              type="button"
              onClick={() => setDisplayMode('flat')}
              style={{
                padding: '4px 10px',
                borderRadius: 999,
                border: 'none',
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
                padding: '4px 10px',
                borderRadius: 999,
                border: 'none',
                background: displayMode === 'stitched' ? '#111' : 'transparent',
                color: displayMode === 'stitched' ? '#fff' : '#333',
              }}
            >
              Stitched
            </button>
          </div>
          <button
            type="button"
            onClick={() => scheduleZoom(zoomPercentRef.current - ZOOM_BUTTON_STEP)}
            disabled={zoomPercentRef.current <= 100}
          >
            -
          </button>
          <span ref={zoomLabelRef} style={{ minWidth: 52, textAlign: 'center', fontSize: 14 }}>
            {Math.round(zoomPercent)}%
          </span>
          <button
            type="button"
            onClick={() => scheduleZoom(zoomPercentRef.current + ZOOM_BUTTON_STEP)}
            disabled={zoomPercentRef.current >= 400}
          >
            +
          </button>
          <button type="button" onClick={() => scheduleZoom(100)} disabled={zoomPercentRef.current === 100}>
            Reset
          </button>
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
                    left: 2,
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

          <div
            ref={viewportRef}
            style={{
              gridColumn: '2 / 3',
              gridRow: '2 / 3',
              width: `${previewViewportWidth}px`,
              height: `${previewViewportHeight}px`,
              minHeight: 0,
              minWidth: 0,
              overflowX: zoomPercent > 100 ? 'auto' : 'hidden',
              overflowY: zoomPercent > 100 ? 'auto' : 'hidden',
              touchAction: 'pan-x pan-y',
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
                    cursor: activeColor ? (highlightSelection ? 'crosshair' : PAINTBRUSH_CURSOR) : 'default',
                    touchAction: 'pan-x pan-y',
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
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
