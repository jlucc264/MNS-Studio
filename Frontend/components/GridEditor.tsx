'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type Props = {
  cells: string[][]
  activeColor: string | null
  highlightSelection: boolean
  meshCount: 13 | 18
  onSelectionChange?: (selection: DesignSelectionRect | null) => void
  onPaintStart: () => void
  onPaintCells: (coords: Array<[number, number]>) => void
}

const PAINTBRUSH_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cpath d='M15.6 3.2l5.2 5.2-7.8 7.8-5.2-5.2z' fill='%23222'/%3E%3Cpath d='M6.8 11.9l5.3 5.3-1.1 2.7c-.3.8-1 1.4-1.9 1.6-2 .5-4-.4-4.8-2.3-.4-.9-.4-1.8 0-2.7l1.1-2.6z' fill='%23c43b3b'/%3E%3Cpath d='M15.1 2.7l6.2 6.2' stroke='%23fff' stroke-width='1.2' stroke-linecap='round'/%3E%3C/g%3E%3C/svg%3E") 4 20, crosshair`
const RULER_THICKNESS = 24
const PREVIEW_FRAME_WIDTH_UNITS = 13
const PREVIEW_FRAME_HEIGHT_UNITS = 9

export type DesignSelectionRect = {
  startRow: number
  startCol: number
  endRow: number
  endCol: number
}

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

  context.clearRect(x, y, cellSize, cellSize)
  context.fillStyle = color
  context.fillRect(x, y, cellSize, cellSize)

  if (dimNonSelected) {
    context.fillStyle = 'rgba(255, 255, 255, 0.62)'
    context.fillRect(x, y, cellSize, cellSize)
  }

  context.strokeStyle = 'rgba(0,0,0,0.08)'
  context.lineWidth = 0.5
  context.strokeRect(x, y, cellSize, cellSize)

  if (displayMode !== 'stitched' || !inDesign) return

  const inset = Math.max(1, Math.round(cellSize * 0.08))
  const left = x + inset
  const top = y + inset
  const width = cellSize - inset * 2
  const height = cellSize - inset * 2

  context.lineCap = 'round'

  context.strokeStyle = stitchShadow(color)
  context.lineWidth = Math.max(1.5, cellSize * 0.22)
  context.beginPath()
  context.moveTo(left + width * 0.18, top + height * 0.22)
  context.lineTo(left + width * 0.82, top + height * 0.78)
  context.stroke()

  context.strokeStyle = color
  context.lineWidth = Math.max(1.25, cellSize * 0.18)
  context.beginPath()
  context.moveTo(left + width * 0.17, top + height * 0.24)
  context.lineTo(left + width * 0.8, top + height * 0.77)
  context.stroke()

  context.strokeStyle = stitchHighlight(color)
  context.lineWidth = Math.max(0.75, cellSize * 0.05)
  context.beginPath()
  context.moveTo(left + width * 0.22, top + height * 0.25)
  context.lineTo(left + width * 0.76, top + height * 0.7)
  context.stroke()

  context.strokeStyle = stitchShadow(color)
  context.lineWidth = Math.max(1.5, cellSize * 0.22)
  context.beginPath()
  context.moveTo(left + width * 0.82, top + height * 0.22)
  context.lineTo(left + width * 0.18, top + height * 0.78)
  context.stroke()

  context.strokeStyle = stitchStroke(color)
  context.lineWidth = Math.max(1.35, cellSize * 0.2)
  context.beginPath()
  context.moveTo(left + width * 0.8, top + height * 0.23)
  context.lineTo(left + width * 0.18, top + height * 0.8)
  context.stroke()

  context.strokeStyle = stitchHighlight(color)
  context.lineWidth = Math.max(0.75, cellSize * 0.05)
  context.beginPath()
  context.moveTo(left + width * 0.76, top + height * 0.26)
  context.lineTo(left + width * 0.23, top + height * 0.75)
  context.stroke()

  context.fillStyle = color === '#FFFFFF' ? 'rgba(246, 246, 246, 0.88)' : 'rgba(255, 255, 255, 0.12)'
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
  highlightSelection,
  meshCount,
  onSelectionChange,
  onPaintStart,
  onPaintCells,
}: Props) {
  if (!cells.length) return null

  const containerRef = useRef<HTMLDivElement | null>(null)
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const [containerSize, setContainerSize] = useState({ width: 640, height: 520 })
  const [toolbarHeight, setToolbarHeight] = useState(56)
  const [zoomPercent, setZoomPercent] = useState(100)
  const [scrollPosition, setScrollPosition] = useState({ left: 0, top: 0 })
  const [displayMode, setDisplayMode] = useState<'flat' | 'stitched'>('stitched')
  const [isZooming, setIsZooming] = useState(false)
  const [brushDensity, setBrushDensity] = useState(1)
  const [isPainting, setIsPainting] = useState(false)
  const [isSelecting, setIsSelecting] = useState(false)
  const [selectionRect, setSelectionRect] = useState<DesignSelectionRect | null>(null)
  const [dragSelectionRect, setDragSelectionRect] = useState<DesignSelectionRect | null>(null)
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

  useEffect(() => {
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

  useEffect(() => {
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
    }
  }, [])

  useEffect(() => {
    if (!highlightSelection) {
      setSelectionRect(null)
      setDragSelectionRect(null)
      liveSelectionRectRef.current = null
      onSelectionChange?.(null)
    }
  }, [highlightSelection, onSelectionChange])

  useEffect(() => {
    const stopPainting = () => {
      if (isSelecting && dragSelectionRect) {
        setSelectionRect(dragSelectionRect)
        onSelectionChange?.(dragSelectionRect)
        liveSelectionRectRef.current = null
      }

      setIsPainting(false)
      setIsSelecting(false)
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
  }, [dragSelectionRect, isSelecting, onSelectionChange])

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
      horizontalRulerTicks
        .map((tick) => ({ ...tick, position: tick.offset - scrollPosition.left }))
        .filter((tick) => tick.position >= -32 && tick.position <= previewViewportWidth + 32),
    [horizontalRulerTicks, previewViewportWidth, scrollPosition.left]
  )
  const visibleVerticalTicks = useMemo(
    () =>
      verticalRulerTicks
        .map((tick) => ({ ...tick, position: tick.offset - scrollPosition.top }))
        .filter((tick) => tick.position >= -32 && tick.position <= previewViewportHeight + 32),
    [previewViewportHeight, scrollPosition.top, verticalRulerTicks]
  )

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const syncScroll = () => {
      setScrollPosition({
        left: viewport.scrollLeft,
        top: viewport.scrollTop,
      })
    }

    syncScroll()
    viewport.addEventListener('scroll', syncScroll, { passive: true })
    return () => viewport.removeEventListener('scroll', syncScroll)
  }, [zoomPercent, previewViewportHeight, previewViewportWidth])

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
        setZoomPercent(clampedZoom)
        return
      }

      const rect = viewport.getBoundingClientRect()
      const anchorX = origin ? origin.clientX - rect.left : viewport.clientWidth / 2
      const anchorY = origin ? origin.clientY - rect.top : viewport.clientHeight / 2
      const contentX = viewport.scrollLeft + anchorX
      const contentY = viewport.scrollTop + anchorY
      const zoomRatio = clampedZoom / currentZoom

      setIsZooming(true)
      if (zoomSettleTimeoutRef.current !== null) {
        window.clearTimeout(zoomSettleTimeoutRef.current)
      }
      setZoomPercent(clampedZoom)

      window.requestAnimationFrame(() => {
        const nextViewport = viewportRef.current
        if (!nextViewport) return

        nextViewport.scrollLeft = Math.max(0, contentX * zoomRatio - anchorX)
        nextViewport.scrollTop = Math.max(0, contentY * zoomRatio - anchorY)
      })

      zoomSettleTimeoutRef.current = window.setTimeout(() => {
        setIsZooming(false)
        zoomSettleTimeoutRef.current = null
      }, 140)
    },
    []
  )

  const handleCanvasPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (event.pointerType === 'touch') return
      if (highlightSelection) {
        event.preventDefault()
        selectionPointerIdRef.current = event.pointerId
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

      if (!activeColorRef.current) return

      const hit = getCellFromClientPoint(event.clientX, event.clientY)
      if (!hit) return

      event.preventDefault()

      onPaintStart()
      paintingPointerIdRef.current = event.pointerId
      setIsPainting(true)
      paintCell(hit.row, hit.col)
    },
    [getCellFromClientPoint, highlightSelection, onPaintStart, paintCell]
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

      if (!isPainting || paintingPointerIdRef.current !== event.pointerId) return

      const hit = getCellFromClientPoint(event.clientX, event.clientY)
      if (!hit) return

      paintCell(hit.row, hit.col)
    },
    [getCellFromClientPoint, highlightSelection, isPainting, isSelecting, paintCell]
  )

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return

      event.preventDefault()
      const direction = event.deltaY < 0 ? 1 : -1
      const magnitude = Math.min(32, Math.max(6, Math.abs(event.deltaY) * 0.08))
      updateZoom(zoomPercentRef.current + direction * magnitude, {
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
      updateZoom(gestureStartZoomRef.current * scale, {
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
  }, [updateZoom])

  const renderSelection = selectionRect
  const effectiveDisplayMode = isZooming && displayMode === 'stitched' ? 'flat' : displayMode

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const context = canvas.getContext('2d')
    if (!context) return

    const devicePixelRatio = Math.min(window.devicePixelRatio || 1, 1.25)
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
    const activeFocusRegion = renderSelection
    const renderSignature = [
      wrapperWidth,
      wrapperHeight,
      cellSize,
      effectiveDisplayMode,
      activeColor ?? '',
      highlightSelection,
      activeFocusRegion
        ? [
            activeFocusRegion.startRow,
            activeFocusRegion.startCol,
            activeFocusRegion.endRow,
            activeFocusRegion.endCol,
          ].join(':')
        : '',
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

          drawCanvasCell({
            context,
            activeColor,
            color,
            cellSize,
            displayMode: effectiveDisplayMode,
            highlightSelection,
            inDesign,
            isInsideFocusRegion: isWithinSelection(activeFocusRegion, sourceRow, sourceCol),
            focusRegionActive: Boolean(activeFocusRegion),
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
            cellSize,
            displayMode: effectiveDisplayMode,
            highlightSelection,
            inDesign: true,
            isInsideFocusRegion: isWithinSelection(activeFocusRegion, row, col),
            focusRegionActive: Boolean(activeFocusRegion),
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
    selectionRect,
    gridOriginX,
    gridOriginY,
    contentOriginCol,
    contentOriginRow,
    rows,
    stageCols,
    stageRows,
    wrapperHeight,
    wrapperWidth,
  ])

  useEffect(() => {
    const overlayCanvas = overlayCanvasRef.current
    if (!overlayCanvas) return

    const devicePixelRatio = Math.min(window.devicePixelRatio || 1, 1.25)
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

    const overlaySelection = dragSelectionRect ?? selectionRect
    if (!overlaySelection) return

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
  }, [
    borderStitches,
    cellSize,
    contentOriginCol,
    contentOriginRow,
    dragSelectionRect,
    gridOriginX,
    gridOriginY,
    selectionRect,
    wrapperHeight,
    wrapperWidth,
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
            onClick={() => updateZoom(zoomPercent - 25)}
            disabled={zoomPercent <= 100}
          >
            -
          </button>
          <span style={{ minWidth: 52, textAlign: 'center', fontSize: 14 }}>
            {Math.round(zoomPercent)}%
          </span>
          <button
            type="button"
            onClick={() => updateZoom(zoomPercent + 25)}
            disabled={zoomPercent >= 400}
          >
            +
          </button>
          <button type="button" onClick={() => updateZoom(100)} disabled={zoomPercent === 100}>
            Reset
          </button>
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
              color: '#333',
            }}
          >
            Brush
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={brushDensity}
              onChange={(event) => {
                setBrushDensity(Number(event.target.value))
                lastPaintedCellRef.current = null
              }}
              disabled={!activeColor}
            />
            <span style={{ minWidth: 14, textAlign: 'right' }}>{brushDensity}</span>
          </label>
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
                style={{
                  position: 'absolute',
                  left: tick.position,
                  top: 0,
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
                style={{
                  position: 'absolute',
                  top: tick.position,
                  left: 0,
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
  )
}
