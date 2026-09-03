'use client'

import { type CSSProperties, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'

type ThreadListRow = {
  hex: string
  dmc_code: string
  dmc_name: string
  count: number
  skeins: number
}

// Glyph programs over the unit square, shipped by the backend rather than
// named, so Backend/app/services/stitch_symbols.py stays the single definition
// of the symbol set. This file only has to interpret the six primitives; adding
// or reshaping a glyph needs no frontend release.
type GlyphOp =
  | ['circle', number, number, number, boolean]
  | ['rect', number, number, number, number, boolean]
  | ['poly', [number, number][], boolean]
  | ['line', number, number, number, number]
  | ['hole_circle', number, number, number]
  | ['hole_rect', number, number, number, number]

type ChartData = {
  cols: number
  rows: number
  runs: [number, number][]
  tint: number
  inset: number
  symbols: (GlyphOp[] | null)[]
}

type ThreadListPayload = {
  width_inches: number
  height_inches: number
  mesh_count: number
  colors_used: number
  total_stitches: number
  rows: ThreadListRow[]
  chart?: ChartData
}

const CHART_BLANK = -1
const CHART_OUTLINE = -2
const OUTLINE_INK = '#1a1a1a'

const page: CSSProperties = {
  minHeight: '100vh',
  maxWidth: 780,
  margin: '0 auto',
  padding: '28px 18px 60px',
  color: '#3f382f',
}

const summaryCard: CSSProperties = {
  background: '#fff',
  border: '1px solid #e7e1d8',
  borderRadius: 12,
  padding: '16px 18px',
  marginBottom: 18,
}

const rowCard: CSSProperties = {
  background: '#fff',
  border: '1px solid #e7e1d8',
  borderRadius: 12,
  padding: '14px 16px',
  marginBottom: 10,
  display: 'flex',
  alignItems: 'center',
  gap: 14,
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ]
}

/** The thread colour blended toward white, matching _chart_tint on the PDF side. */
function tintOf(hex: string, strength: number): string {
  const [r, g, b] = hexToRgb(hex)
  const wash = (c: number) => Math.round(255 - (255 - c) * strength)
  return `rgb(${wash(r)}, ${wash(g)}, ${wash(b)})`
}

/**
 * Draw one glyph into the size x size box at (x, y).
 *
 * Op coordinates run y-down and so does the canvas, so unlike the PDF renderer
 * there is no flip here. Filled shapes are filled only, never also stroked —
 * stroking them centred on the path would push half the line weight outside the
 * shape and render every heavy glyph too bold, which is exactly the bug the PDF
 * version hit.
 */
function drawGlyph(
  ctx: CanvasRenderingContext2D,
  ops: GlyphOp[],
  x: number,
  y: number,
  size: number,
  ink: string,
  hole: string,
) {
  const sx = (v: number) => x + v * size
  const sy = (v: number) => y + v * size

  ctx.save()
  ctx.lineWidth = Math.max(0.6, 0.1 * size)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = ink
  ctx.fillStyle = ink

  for (const op of ops) {
    switch (op[0]) {
      case 'circle': {
        const [, cx, cy, r, filled] = op
        ctx.beginPath()
        ctx.arc(sx(cx), sy(cy), r * size, 0, Math.PI * 2)
        if (filled) ctx.fill()
        else ctx.stroke()
        break
      }
      case 'rect': {
        const [, rx, ry, w, h, filled] = op
        if (filled) ctx.fillRect(sx(rx), sy(ry), w * size, h * size)
        else ctx.strokeRect(sx(rx), sy(ry), w * size, h * size)
        break
      }
      case 'poly': {
        const [, points, filled] = op
        ctx.beginPath()
        points.forEach(([px, py], index) => {
          if (index === 0) ctx.moveTo(sx(px), sy(py))
          else ctx.lineTo(sx(px), sy(py))
        })
        ctx.closePath()
        if (filled) ctx.fill()
        else ctx.stroke()
        break
      }
      case 'line': {
        const [, x1, y1, x2, y2] = op
        ctx.beginPath()
        ctx.moveTo(sx(x1), sy(y1))
        ctx.lineTo(sx(x2), sy(y2))
        ctx.stroke()
        break
      }
      case 'hole_circle': {
        const [, cx, cy, r] = op
        ctx.fillStyle = hole
        ctx.beginPath()
        ctx.arc(sx(cx), sy(cy), r * size, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = ink
        break
      }
      case 'hole_rect': {
        const [, rx, ry, w, h] = op
        ctx.fillStyle = hole
        ctx.fillRect(sx(rx), sy(ry), w * size, h * size)
        ctx.fillStyle = ink
        break
      }
    }
  }
  ctx.restore()
}

/** Legend swatch: the same glyph on the same tint the chart cells use. */
function GlyphSwatch({ ops, hex, tint, inset }: { ops: GlyphOp[] | null; hex: string; tint: number; inset: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const size = 34
    const ratio = window.devicePixelRatio || 1
    canvas.width = size * ratio
    canvas.height = size * ratio
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(ratio, ratio)
    const background = tintOf(hex, tint)
    ctx.fillStyle = background
    ctx.fillRect(0, 0, size, size)
    if (ops) {
      const pad = size * inset
      drawGlyph(ctx, ops, pad, pad, size - pad * 2, '#000', background)
    }
  }, [ops, hex, tint, inset])
  return (
    <canvas
      ref={ref}
      style={{ width: 34, height: 34, borderRadius: 6, border: '1px solid rgba(0,0,0,0.12)', flexShrink: 0 }}
    />
  )
}

function decodeRuns(chart: ChartData): Int16Array {
  const cells = new Int16Array(chart.cols * chart.rows).fill(CHART_BLANK)
  let at = 0
  for (const [index, length] of chart.runs) {
    cells.fill(index, at, at + length)
    at += length
  }
  return cells
}

const MIN_SCALE = 1
const MAX_SCALE = 48
// Below this many pixels per cell a glyph is a smudge, so the chart draws as
// flat colour instead. Keeps a zoomed-out view of a big design fast and honest
// about what it is showing.
const GLYPH_MIN_SCALE = 7

function ChartViewer({ chart, rows, selected }: { chart: ChartData; rows: ThreadListRow[]; selected: number | null }) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const cellsRef = useRef<Int16Array | null>(null)
  const viewRef = useRef({ scale: 8, x: 0, y: 0 })
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchRef = useRef<{ distance: number; scale: number } | null>(null)
  const frameRef = useRef(0)
  const [ready, setReady] = useState(false)

  if (cellsRef.current === null) cellsRef.current = decodeRuns(chart)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const cells = cellsRef.current
    if (!canvas || !cells) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const ratio = window.devicePixelRatio || 1
    const width = canvas.width / ratio
    const height = canvas.height / ratio
    const { scale, x: originX, y: originY } = viewRef.current

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.fillStyle = '#faf7f3'
    ctx.fillRect(0, 0, width, height)

    const firstCol = Math.max(0, Math.floor(-originX / scale))
    const firstRow = Math.max(0, Math.floor(-originY / scale))
    const lastCol = Math.min(chart.cols - 1, Math.ceil((width - originX) / scale))
    const lastRow = Math.min(chart.rows - 1, Math.ceil((height - originY) / scale))
    const withGlyphs = scale >= GLYPH_MIN_SCALE
    const pad = scale * chart.inset

    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let col = firstCol; col <= lastCol; col += 1) {
        const index = cells[row * chart.cols + col]
        if (index === CHART_BLANK) continue
        const px = originX + col * scale
        const py = originY + row * scale
        const dimmed = selected !== null && index !== selected

        if (index === CHART_OUTLINE) {
          ctx.fillStyle = dimmed ? '#d8d4cd' : OUTLINE_INK
          ctx.fillRect(px, py, scale, scale)
          continue
        }
        const entry = rows[index]
        if (!entry) continue
        if (selected !== null) {
          // Selection answers "where does this colour go", so the chosen cells
          // take the real thread colour while the rest wash out. Tint against
          // tint was too close to read at a glance — the whole chart just
          // looked faded, with no visible answer.
          ctx.fillStyle = dimmed ? tintOf(entry.hex, chart.tint * 0.26) : entry.hex
          ctx.fillRect(px, py, scale, scale)
          continue
        }
        const background = tintOf(entry.hex, chart.tint)
        ctx.fillStyle = background
        ctx.fillRect(px, py, scale, scale)
        if (withGlyphs) {
          const ops = chart.symbols[index]
          if (ops) drawGlyph(ctx, ops, px + pad, py + pad, scale - pad * 2, '#000', background)
        }
      }
    }

    if (scale >= 4) {
      ctx.strokeStyle = 'rgba(0,0,0,0.14)'
      ctx.lineWidth = 0.5
      ctx.beginPath()
      for (let col = firstCol; col <= lastCol + 1; col += 1) {
        const px = Math.round(originX + col * scale) + 0.5
        ctx.moveTo(px, Math.max(0, originY))
        ctx.lineTo(px, Math.min(height, originY + chart.rows * scale))
      }
      for (let row = firstRow; row <= lastRow + 1; row += 1) {
        const py = Math.round(originY + row * scale) + 0.5
        ctx.moveTo(Math.max(0, originX), py)
        ctx.lineTo(Math.min(width, originX + chart.cols * scale), py)
      }
      ctx.stroke()
    }

    // Every tenth rule heavier, so a position can be found by counting tens.
    ctx.strokeStyle = 'rgba(0,0,0,0.42)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let col = firstCol - (firstCol % 10); col <= lastCol + 1; col += 10) {
      const px = Math.round(originX + col * scale) + 0.5
      ctx.moveTo(px, Math.max(0, originY))
      ctx.lineTo(px, Math.min(height, originY + chart.rows * scale))
    }
    for (let row = firstRow - (firstRow % 10); row <= lastRow + 1; row += 10) {
      const py = Math.round(originY + row * scale) + 0.5
      ctx.moveTo(Math.max(0, originX), py)
      ctx.lineTo(Math.min(width, originX + chart.cols * scale), py)
    }
    ctx.stroke()
  }, [chart, rows, selected])

  const schedule = useCallback(() => {
    if (frameRef.current) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0
      draw()
    })
  }, [draw])

  const fit = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ratio = window.devicePixelRatio || 1
    const width = canvas.width / ratio
    const height = canvas.height / ratio
    const scale = Math.max(MIN_SCALE, Math.min(width / chart.cols, height / chart.rows))
    viewRef.current = {
      scale,
      x: (width - chart.cols * scale) / 2,
      y: (height - chart.rows * scale) / 2,
    }
    schedule()
  }, [chart, schedule])

  // Size the backing store to the box, in device pixels.
  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const resize = () => {
      const ratio = window.devicePixelRatio || 1
      const rect = wrap.getBoundingClientRect()
      canvas.width = Math.max(1, Math.round(rect.width * ratio))
      canvas.height = Math.max(1, Math.round(rect.height * ratio))
      schedule()
    }
    resize()
    fit()
    setReady(true)
    const observer = new ResizeObserver(resize)
    observer.observe(wrap)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (ready) schedule()
  }, [selected, ready, schedule])

  const zoomAt = useCallback(
    (factor: number, clientX: number, clientY: number) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const px = clientX - rect.left
      const py = clientY - rect.top
      const view = viewRef.current
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor))
      const applied = next / view.scale
      // Keep the cell under the cursor pinned while the scale changes.
      view.x = px - (px - view.x) * applied
      view.y = py - (py - view.y) * applied
      view.scale = next
      schedule()
    },
    [schedule],
  )

  // Non-passive so the page does not scroll while zooming the chart.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      zoomAt(Math.exp(-event.deltaY * 0.0016), event.clientX, event.clientY)
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
  }

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const pointers = pointersRef.current
    const previous = pointers.get(event.pointerId)
    if (!previous) return
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (pointers.size === 1) {
      viewRef.current.x += event.clientX - previous.x
      viewRef.current.y += event.clientY - previous.y
      pinchRef.current = null
      schedule()
      return
    }
    if (pointers.size === 2) {
      const [a, b] = Array.from(pointers.values())
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      if (!pinchRef.current) {
        pinchRef.current = { distance, scale: viewRef.current.scale }
        return
      }
      const factor = distance / pinchRef.current.distance
      const target = pinchRef.current.scale * factor
      zoomAt(target / viewRef.current.scale, (a.x + b.x) / 2, (a.y + b.y) / 2)
    }
  }

  const endPointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(event.pointerId)
    if (pointersRef.current.size < 2) pinchRef.current = null
  }

  return (
    <div style={{ marginBottom: 18 }}>
      <div
        ref={wrapRef}
        style={{
          position: 'relative',
          height: 'min(62vh, 520px)',
          background: '#faf7f3',
          border: '1px solid #e7e1d8',
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none', cursor: 'grab' }}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={fit} style={buttonStyle}>
          Fit
        </button>
        <button
          type="button"
          onClick={() => {
            const canvas = canvasRef.current
            if (!canvas) return
            const rect = canvas.getBoundingClientRect()
            zoomAt(1.4, rect.left + rect.width / 2, rect.top + rect.height / 2)
          }}
          style={buttonStyle}
        >
          Zoom in
        </button>
        <button
          type="button"
          onClick={() => {
            const canvas = canvasRef.current
            if (!canvas) return
            const rect = canvas.getBoundingClientRect()
            zoomAt(1 / 1.4, rect.left + rect.width / 2, rect.top + rect.height / 2)
          }}
          style={buttonStyle}
        >
          Zoom out
        </button>
        <span style={{ fontSize: 12, color: '#8a8177' }}>
          {chart.cols} × {chart.rows} stitches — drag to move, pinch or scroll to zoom
        </span>
      </div>
    </div>
  )
}

const buttonStyle: CSSProperties = {
  background: '#fff',
  border: '1px solid #d7d0c8',
  borderRadius: 8,
  padding: '6px 12px',
  fontSize: 13,
  color: '#3f382f',
  cursor: 'pointer',
}

function ThreadListPage() {
  const searchParams = useSearchParams()
  const src = searchParams.get('src')
  const [data, setData] = useState<ThreadListPayload | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<number | null>(null)

  useEffect(() => {
    if (!src) {
      setError('No color list was linked here.')
      setLoading(false)
      return
    }
    let cancelled = false
    fetch(src)
      .then((res) => {
        if (!res.ok) throw new Error()
        return res.json()
      })
      .then((json: ThreadListPayload) => {
        if (!cancelled) setData(json)
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load this color list. It may have expired.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [src])

  const chart = data?.chart

  return (
    <div style={page}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1, color: '#7A817A', textTransform: 'uppercase' }}>
          MNS Studio
        </div>
        <h1 style={{ margin: '4px 0 0', fontSize: 24 }}>{chart ? 'Stitch chart & thread list' : 'Thread shopping list'}</h1>
        <p style={{ margin: '6px 0 0', fontSize: 14, color: '#6f675f', lineHeight: 1.5 }}>
          {chart
            ? 'Tap a color below to see exactly where it goes. DMC codes and names are listed for the thread store.'
            : 'DMC codes and names for this design — take this to a thread store or search these codes online.'}
        </p>
      </div>

      {loading && <p style={{ color: '#8a8177', fontSize: 14 }}>Loading…</p>}
      {error && <p style={{ color: '#b0453a', fontSize: 14 }}>{error}</p>}

      {data && (
        <>
          {chart && <ChartViewer chart={chart} rows={data.rows} selected={selected} />}

          <div style={summaryCard}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
              <div><strong>Size</strong> — {data.width_inches}&quot; × {data.height_inches}&quot;</div>
              <div><strong>Mesh</strong> — {data.mesh_count}</div>
              <div><strong>Colors</strong> — {data.colors_used}</div>
              <div><strong>Stitches</strong> — {data.total_stitches.toLocaleString()}</div>
            </div>
          </div>

          <p style={{ fontSize: 12, color: '#8a8177', margin: '0 0 12px' }}>
            {chart && selected !== null
              ? 'Showing one color — tap it again to see them all.'
              : "Skein counts are estimates — buy an extra skein of anything you're unsure about."}
          </p>

          {data.rows.map((row, index) => {
            const isSelected = selected === index
            return (
              <div
                key={row.dmc_code}
                onClick={chart ? () => setSelected(isSelected ? null : index) : undefined}
                style={{
                  ...rowCard,
                  cursor: chart ? 'pointer' : 'default',
                  borderColor: isSelected ? '#6e8d67' : '#e7e1d8',
                  boxShadow: isSelected ? '0 0 0 2px rgba(110,141,103,0.28)' : 'none',
                }}
              >
                {chart && (
                  <GlyphSwatch ops={chart.symbols[index] ?? null} hex={row.hex} tint={chart.tint} inset={chart.inset} />
                )}
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 6,
                    background: row.hex,
                    border: '1px solid rgba(0,0,0,0.12)',
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>DMC {row.dmc_code}</div>
                  <div style={{ fontSize: 13, color: '#6f675f' }}>{row.dmc_name}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{row.skeins} {row.skeins === 1 ? 'skein' : 'skeins'}</div>
                  <div style={{ fontSize: 12, color: '#8a8177' }}>{row.count.toLocaleString()} stitches</div>
                </div>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

export default function ThreadListPageWrapper() {
  return (
    <Suspense>
      <ThreadListPage />
    </Suspense>
  )
}
