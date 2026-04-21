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
const CANVAS_PADDING = 16

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
  isSelectedInRegion,
  row,
  selectedRegionActive,
  col,
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
  isSelectedInRegion: boolean
  row: number
  selectedRegionActive: boolean
  col: number
  x: number
  y: number
}) {
  const selectedMatch = Boolean(
    highlightSelection &&
      activeColor &&
      inDesign &&
      color === activeColor &&
      (!selectedRegionActive || isSelectedInRegion)
  )
  const dimNonSelected = Boolean(
    highlightSelection &&
      activeColor &&
      inDesign &&
      (color !== activeColor || (selectedRegionActive && color === activeColor && !isSelectedInRegion))
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
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const [containerWidth, setContainerWidth] = useState(640)
  const [viewportHeight, setViewportHeight] = useState(520)
  const [zoomPercent, setZoomPercent] = useState(100)
  const [displayMode, setDisplayMode] = useState<'flat' | 'stitched'>('stitched')
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
  const selectionFrameRef = useRef<number | null>(null)

  useEffect(() => {
    const node = containerRef.current
    if (!node) return

    const updateWidth = () => {
      setContainerWidth(node.clientWidth || 640)
    }

    updateWidth()

    const observer = new ResizeObserver(updateWidth)
    observer.observe(node)

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const node = viewportRef.current
    if (!node) return

    const updateHeight = () => {
      setViewportHeight(node.clientHeight || Math.round(window.innerHeight * 0.7))
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

  const baseCellSize = useMemo(() => {
    const usableWidth = Math.max(containerWidth - 72, 120)
    const usableHeight = Math.max(viewportHeight - 72, 120)
    const widthFit = Math.floor(usableWidth / totalCols)
    const heightFit = Math.floor(usableHeight / totalRows)

    return Math.max(2, Math.min(12, widthFit, heightFit))
  }, [containerWidth, totalCols, totalRows, viewportHeight])

  const cellSize = Math.max(2, Math.round((baseCellSize * zoomPercent) / 100))
  const gridWidth = totalCols * cellSize
  const gridHeight = totalRows * cellSize
  const wrapperWidth = Math.max(containerWidth, gridWidth + CANVAS_PADDING * 2)
  const wrapperHeight = Math.max(viewportHeight, gridHeight + CANVAS_PADDING * 2)
  const gridOriginX = Math.round((wrapperWidth - gridWidth) / 2)
  const gridOriginY = Math.round((wrapperHeight - gridHeight) / 2)

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

  const getDesignCellFromClientPoint = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current
      if (!canvas) return null

      const rect = canvas.getBoundingClientRect()
      const localX = clientX - rect.left
      const localY = clientY - rect.top

      const gridCol = Math.floor((localX - gridOriginX) / cellSize)
      const gridRow = Math.floor((localY - gridOriginY) / cellSize)

      if (gridCol < borderStitches || gridCol >= borderStitches + cols) return null
      if (gridRow < borderStitches || gridRow >= borderStitches + rows) return null

      return {
        row: gridRow - borderStitches,
        col: gridCol - borderStitches,
      }
    },
    [borderStitches, cellSize, cols, gridOriginX, gridOriginY, rows]
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

      setZoomPercent(clampedZoom)

      window.requestAnimationFrame(() => {
        const nextViewport = viewportRef.current
        if (!nextViewport) return

        nextViewport.scrollLeft = Math.max(0, contentX * zoomRatio - anchorX)
        nextViewport.scrollTop = Math.max(0, contentY * zoomRatio - anchorY)
      })
    },
    []
  )

  const handleCanvasPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (event.pointerType === 'touch') return
      if (!activeColorRef.current) return

      const hit = getDesignCellFromClientPoint(event.clientX, event.clientY)
      if (!hit) return

      event.preventDefault()
      if (highlightSelection) {
        selectionPointerIdRef.current = event.pointerId
        setIsSelecting(true)
        const nextRect = {
          startRow: hit.row,
          startCol: hit.col,
          endRow: hit.row,
          endCol: hit.col,
        }
        liveSelectionRectRef.current = nextRect
        setDragSelectionRect(nextRect)
        return
      }

      onPaintStart()
      paintingPointerIdRef.current = event.pointerId
      setIsPainting(true)
      paintCell(hit.row, hit.col)
    },
    [getDesignCellFromClientPoint, highlightSelection, onPaintStart, paintCell]
  )

  const handleCanvasPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (highlightSelection && isSelecting && selectionPointerIdRef.current === event.pointerId) {
        const hit = getDesignCellFromClientPoint(event.clientX, event.clientY)
        if (!hit) return

        const current = liveSelectionRectRef.current
        if (!current) return
        if (current.endRow == hit.row && current.endCol === hit.col) return

        liveSelectionRectRef.current = {
          ...current,
          endRow: hit.row,
          endCol: hit.col,
        }

        if (selectionFrameRef.current !== null) return

        selectionFrameRef.current = window.requestAnimationFrame(() => {
          selectionFrameRef.current = null
          setDragSelectionRect(liveSelectionRectRef.current)
        })
        return
      }

      if (!isPainting || paintingPointerIdRef.current !== event.pointerId) return

      const hit = getDesignCellFromClientPoint(event.clientX, event.clientY)
      if (!hit) return

      paintCell(hit.row, hit.col)
    },
    [getDesignCellFromClientPoint, highlightSelection, isPainting, isSelecting, paintCell]
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

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const context = canvas.getContext('2d')
    if (!context) return

    const devicePixelRatio = Math.min(window.devicePixelRatio || 1, 1.5)
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
    const renderSignature = [
      wrapperWidth,
      wrapperHeight,
      cellSize,
      displayMode,
      activeColor ?? '',
      highlightSelection,
      selectionRect
        ? [selectionRect.startRow, selectionRect.startCol, selectionRect.endRow, selectionRect.endCol].join(':')
        : '',
      gridOriginX,
      gridOriginY,
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

      for (let row = 0; row < totalRows; row += 1) {
        for (let col = 0; col < totalCols; col += 1) {
          const sourceRow = row - borderStitches
          const sourceCol = col - borderStitches
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
            displayMode,
            highlightSelection,
            inDesign,
            isSelectedInRegion: isWithinSelection(selectionRect, sourceRow, sourceCol),
            row: sourceRow,
            selectedRegionActive: Boolean(selectionRect),
            col: sourceCol,
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

          const x = gridOriginX + (col + borderStitches) * cellSize
          const y = gridOriginY + (row + borderStitches) * cellSize

          drawCanvasCell({
            context,
            activeColor,
            color: cells[row][col],
            cellSize,
            displayMode,
            highlightSelection,
            inDesign: true,
            isSelectedInRegion: isWithinSelection(selectionRect, row, col),
            row,
            selectedRegionActive: Boolean(selectionRect),
            col,
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
    displayMode,
    activeColor,
    highlightSelection,
    selectionRect,
    dragSelectionRect,
    gridOriginX,
    gridOriginY,
    rows,
    totalCols,
    totalRows,
    wrapperHeight,
    wrapperWidth,
  ])

  useEffect(() => {
    const overlayCanvas = overlayCanvasRef.current
    if (!overlayCanvas) return

    const devicePixelRatio = Math.min(window.devicePixelRatio || 1, 1.5)
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
    const x = gridOriginX + (left + borderStitches) * cellSize
    const y = gridOriginY + (top + borderStitches) * cellSize
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
        height: '100%',
        minHeight: 0,
        minWidth: 0,
        maxWidth: '100%',
        boxSizing: 'border-box',
        background: '#f7f7f7',
        padding: 8,
        borderRadius: 12,
        gap: 8,
        overflow: 'hidden',
      }}
    >
      <div
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
          <span style={{ minWidth: 52, textAlign: 'center', fontSize: 14 }}>{zoomPercent}%</span>
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
        ref={viewportRef}
        style={{
          width: '100%',
          height: '100%',
          minHeight: 0,
          overflowX: zoomPercent > 100 ? 'auto' : 'hidden',
          overflowY: zoomPercent > 100 ? 'auto' : 'hidden',
          background: '#ffffff',
          borderRadius: 8,
          touchAction: 'pan-x pan-y',
          overscrollBehavior: 'contain',
          WebkitOverflowScrolling: 'touch',
          border: '1px solid #e4e4e4',
        }}
      >
        <div
          style={{
            minWidth: '100%',
            minHeight: '100%',
            width: `${wrapperWidth}px`,
            height: `${wrapperHeight}px`,
            boxSizing: 'border-box',
            display: 'grid',
            justifyContent: 'center',
            alignContent: 'center',
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
  )
}
