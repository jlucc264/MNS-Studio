'use client'

import { useRef, useState } from 'react'
import { importStitchlyFile, ImportPatternError } from '../lib/api'

// Printed decoration only — not mesh-aligned stitch data — so one fixed grid
// covers every mesh: 1.5"×1" at 18 mesh (27×18 stitches).
const GRID_COLS = 27
const GRID_ROWS = 18
const CELL_PX = 16
const EXPORT_CELL_PX = 20
const BLANK_CELL = '__BLANK__' // shared sentinel — Backend/app/services/stitch_visualizer.py BLANK_CELL

const SWATCHES = [
  '#211c15', '#ffffff', '#b0453a', '#d97a3f',
  '#d9b23f', '#6e8d67', '#4a7ba6', '#7a5ba6',
  '#8a5a3f', '#8a8177',
]

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

function makeBlankGrid(): string[][] {
  return Array.from({ length: GRID_ROWS }, () => Array(GRID_COLS).fill(BLANK_CELL))
}

function contentBounds(cells: string[][]): { r1: number; c1: number; r2: number; c2: number } | null {
  let r1 = GRID_ROWS, r2 = -1, c1 = GRID_COLS, c2 = -1
  for (let r = 0; r < cells.length; r++) {
    for (let c = 0; c < cells[r].length; c++) {
      if (cells[r][c] === BLANK_CELL) continue
      if (r < r1) r1 = r
      if (r > r2) r2 = r
      if (c < c1) c1 = c
      if (c > c2) c2 = c
    }
  }
  return r2 < 0 ? null : { r1, c1, r2, c2 }
}

export function SignatureGridEditor({
  onSave,
  saving,
}: {
  // grid is the cropped stitch data (hex colors + BLANK_CELL), sent
  // alongside the PNG so the print pipeline can render it stitch-for-stitch
  // instead of resampling the image — see pdf_generator.py's SignatureAsset.
  onSave: (blob: Blob, grid: string[][]) => void | Promise<void>
  saving?: boolean
}) {
  const [cells, setCells] = useState<string[][]>(makeBlankGrid)
  const [activeColor, setActiveColor] = useState(SWATCHES[0])
  const [tool, setTool] = useState<'pencil' | 'eraser'>('pencil')
  const [importError, setImportError] = useState('')
  const paintingRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const isEmpty = !contentBounds(cells)

  function paintCell(row: number, col: number) {
    const color = tool === 'eraser' ? BLANK_CELL : activeColor
    setCells((current) => {
      if (current[row][col] === color) return current
      const next = current.map((r) => [...r])
      next[row][col] = color
      return next
    })
  }

  function handlePointerDown(row: number, col: number) {
    paintingRef.current = true
    paintCell(row, col)
  }

  function handlePointerEnter(row: number, col: number) {
    if (paintingRef.current) paintCell(row, col)
  }

  function stopPainting() {
    paintingRef.current = false
  }

  function handleClear() {
    setCells(makeBlankGrid())
  }

  async function handleImportFile(file: File) {
    setImportError('')
    try {
      const result = await importStitchlyFile(file)
      if (result.stitch_width > GRID_COLS || result.stitch_height > GRID_ROWS) {
        setImportError(
          `This design is ${result.stitch_width}×${result.stitch_height} stitches — too large for a signature ` +
          `(max ${GRID_COLS}×${GRID_ROWS}). Try a smaller chart or crop it down first.`
        )
        return
      }
      const rowOffset = Math.floor((GRID_ROWS - result.stitch_height) / 2)
      const colOffset = Math.floor((GRID_COLS - result.stitch_width) / 2)
      const next = makeBlankGrid()
      for (let r = 0; r < result.stitch_height; r++) {
        for (let c = 0; c < result.stitch_width; c++) {
          next[rowOffset + r][colOffset + c] = result.cells[r][c]
        }
      }
      setCells(next)
    } catch (err) {
      setImportError(
        err instanceof ImportPatternError ? err.message : 'Could not read this file.'
      )
    }
  }

  function handleSave() {
    const bounds = contentBounds(cells)
    if (!bounds) return
    const w = bounds.c2 - bounds.c1 + 1
    const h = bounds.r2 - bounds.r1 + 1

    const canvas = document.createElement('canvas')
    canvas.width = w * EXPORT_CELL_PX
    canvas.height = h * EXPORT_CELL_PX
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingEnabled = false
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const color = cells[bounds.r1 + r][bounds.c1 + c]
        if (color === BLANK_CELL) continue
        ctx.fillStyle = color
        ctx.fillRect(c * EXPORT_CELL_PX, r * EXPORT_CELL_PX, EXPORT_CELL_PX, EXPORT_CELL_PX)
      }
    }
    const croppedGrid = cells.slice(bounds.r1, bounds.r2 + 1).map((row) => row.slice(bounds.c1, bounds.c2 + 1))
    canvas.toBlob((blob) => {
      if (blob) onSave(blob, croppedGrid)
    }, 'image/png')
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div
        onPointerUp={stopPainting}
        onPointerLeave={stopPainting}
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${GRID_COLS}, ${CELL_PX}px)`,
          gridTemplateRows: `repeat(${GRID_ROWS}, ${CELL_PX}px)`,
          width: 'fit-content',
          border: '1px solid #d7d0c8',
          borderRadius: 8,
          overflow: 'hidden',
          touchAction: 'none',
          background:
            'repeating-conic-gradient(#f0ece5 0% 25%, #fffdf8 0% 50%) 0 0 / 12px 12px',
        }}
      >
        {cells.map((row, r) =>
          row.map((color, c) => (
            <div
              key={`${r}-${c}`}
              onPointerDown={() => handlePointerDown(r, c)}
              onPointerEnter={() => handlePointerEnter(r, c)}
              style={{
                width: CELL_PX,
                height: CELL_PX,
                background: color === BLANK_CELL ? 'transparent' : color,
                cursor: 'crosshair',
                boxSizing: 'border-box',
                borderRight: c === GRID_COLS - 1 ? 'none' : '1px solid rgba(0,0,0,0.05)',
                borderBottom: r === GRID_ROWS - 1 ? 'none' : '1px solid rgba(0,0,0,0.05)',
              }}
            />
          ))
        )}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {SWATCHES.map((hex) => (
          <button
            key={hex}
            type="button"
            onClick={() => { setTool('pencil'); setActiveColor(hex) }}
            title={hex}
            style={{
              width: 22,
              height: 22,
              borderRadius: 5,
              border: activeColor === hex && tool === 'pencil' ? '2px solid #3f382f' : '1px solid #d7d0c8',
              background: hex,
              cursor: 'pointer',
              padding: 0,
            }}
          />
        ))}
        <input
          type="color"
          value={activeColor}
          onChange={(e) => { setTool('pencil'); setActiveColor(e.target.value) }}
          title="Custom color"
          style={{ width: 26, height: 26, padding: 0, border: '1px solid #d7d0c8', borderRadius: 5, cursor: 'pointer' }}
        />
        <button
          type="button"
          onClick={() => setTool('eraser')}
          style={{
            ...btnSecondary,
            padding: '5px 10px',
            fontSize: 13,
            border: tool === 'eraser' ? '2px solid #3f382f' : '1px solid #d7d0c8',
          }}
        >
          Eraser
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={handleClear} style={btnSecondary} disabled={isEmpty}>
          Clear
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          style={btnSecondary}
        >
          Import Stitchly
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".stitchly,image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleImportFile(file)
            e.target.value = ''
          }}
        />
        <button
          type="button"
          onClick={handleSave}
          style={{ ...btnPrimary, opacity: isEmpty || saving ? 0.65 : 1 }}
          disabled={isEmpty || saving}
        >
          {saving ? 'Saving…' : 'Save signature'}
        </button>
      </div>
      {importError && <p style={{ margin: 0, fontSize: 13, color: '#b0453a' }}>{importError}</p>}
    </div>
  )
}
