'use client'

import { useRef, useState } from 'react'

const PAD_WIDTH = 300
const PAD_HEIGHT = 200
const STROKE_COLOR = '#211c15'
const STROKE_WIDTH = 3

const btnSecondary = {
  padding: '9px 18px',
  border: '1px solid #d7d0c8',
  borderRadius: 8,
  fontFamily: 'inherit',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  background: '#fff',
  color: '#3f382f',
} as const

const btnPrimary = {
  padding: '10px 20px',
  borderRadius: 8,
  border: '1px solid #5c7856',
  background: '#6e8d67',
  color: '#fff',
  fontFamily: 'inherit',
  fontSize: 14,
  fontWeight: 700,
  cursor: 'pointer',
} as const

function cropToContent(canvas: HTMLCanvasElement): HTMLCanvasElement | null {
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)

  let minX = width, maxX = -1, minY = height, maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3]
      if (alpha > 0) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null

  const cropped = document.createElement('canvas')
  cropped.width = maxX - minX + 1
  cropped.height = maxY - minY + 1
  const croppedCtx = cropped.getContext('2d')
  if (!croppedCtx) return null
  croppedCtx.putImageData(ctx.getImageData(minX, minY, cropped.width, cropped.height), 0, 0)
  return cropped
}

export function SignaturePad({
  onSave,
  saving,
}: {
  onSave: (blob: Blob) => void | Promise<void>
  saving?: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawingRef = useRef(false)
  const lastPointRef = useRef<{ x: number; y: number } | null>(null)
  const [isEmpty, setIsEmpty] = useState(true)

  function getContext() {
    const canvas = canvasRef.current
    return canvas ? canvas.getContext('2d') : null
  }

  function pointFromEvent(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    }
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    const ctx = getContext()
    if (!canvas || !ctx) return
    canvas.setPointerCapture(event.pointerId)
    drawingRef.current = true
    lastPointRef.current = pointFromEvent(event)
    setIsEmpty(false)
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return
    const ctx = getContext()
    const last = lastPointRef.current
    if (!ctx || !last) return
    const point = pointFromEvent(event)
    ctx.strokeStyle = STROKE_COLOR
    ctx.lineWidth = STROKE_WIDTH
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(last.x, last.y)
    ctx.lineTo(point.x, point.y)
    ctx.stroke()
    lastPointRef.current = point
  }

  function handlePointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    drawingRef.current = false
    lastPointRef.current = null
    canvasRef.current?.releasePointerCapture(event.pointerId)
  }

  function handleClear() {
    const canvas = canvasRef.current
    const ctx = getContext()
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setIsEmpty(true)
  }

  function handleSave() {
    const canvas = canvasRef.current
    if (!canvas) return
    const cropped = cropToContent(canvas)
    if (!cropped) return
    cropped.toBlob((blob) => {
      if (blob) onSave(blob)
    }, 'image/png')
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <canvas
        ref={canvasRef}
        width={PAD_WIDTH}
        height={PAD_HEIGHT}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          width: '100%',
          maxWidth: PAD_WIDTH,
          aspectRatio: `${PAD_WIDTH} / ${PAD_HEIGHT}`,
          background: '#fffdf8',
          border: '1px solid #d7d0c8',
          borderRadius: 8,
          touchAction: 'none',
          cursor: 'crosshair',
        }}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={handleClear} style={btnSecondary} disabled={isEmpty}>
          Clear
        </button>
        <button
          type="button"
          onClick={handleSave}
          style={{ ...btnPrimary, opacity: isEmpty || saving ? 0.65 : 1 }}
          disabled={isEmpty || saving}
        >
          {saving ? 'Saving…' : 'Save signature'}
        </button>
      </div>
    </div>
  )
}
