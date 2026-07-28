'use client'
import { useState, useMemo } from 'react'
import type { PaletteColor } from '../lib/api'
import { nearestShades } from '../lib/colorDistance'

const ESSENTIAL_CODES = ['310', 'BLANC']
const NEARBY_COUNT = 10
const BLANK_CELL = '__BLANK__'

type Props = {
  mode: 'add' | 'swap'
  allColors: PaletteColor[]
  paletteHexes: Set<string>
  swapFromColor?: PaletteColor
  onSelect: (color: PaletteColor) => void
  onClose: () => void
}

export function ColorBrowserModal({ mode, allColors, paletteHexes, swapFromColor, onSelect, onClose }: Props) {
  const [search, setSearch] = useState('')

  const essentials = useMemo(() => {
    return ESSENTIAL_CODES.map((code) =>
      allColors.find((c) => c.dmc_code.toUpperCase() === code.toUpperCase()) ??
      (code === 'BLANC' ? allColors.find((c) => c.hex === '#FFFFFF' || c.hex === '#ffffff') : undefined)
    ).filter(Boolean) as PaletteColor[]
  }, [allColors])

  const essentialHexes = useMemo(() => new Set(essentials.map((c) => c.hex)), [essentials])

  // Swap always starts from a known color — most swaps are "find a
  // slightly different shade of this," not "browse the whole DMC catalog,"
  // so surface the closest matches up front instead of making that a search.
  const nearby = useMemo(() => {
    // Blank isn't a real color — there's no "shade family" to compute.
    if (!swapFromColor || swapFromColor.hex === BLANK_CELL) return []
    const pool = allColors.filter((c) => !essentialHexes.has(c.hex))
    return nearestShades(swapFromColor.hex, pool, NEARBY_COUNT)
  }, [allColors, swapFromColor, essentialHexes])

  const nearbyHexes = useMemo(() => new Set(nearby.map((c) => c.hex)), [nearby])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const base = q
      ? allColors.filter((c) => c.dmc_code.toLowerCase().includes(q) || c.dmc_name.toLowerCase().includes(q))
      : allColors
    return base.filter((c) => !essentialHexes.has(c.hex) && !nearbyHexes.has(c.hex))
  }, [allColors, search, essentialHexes, nearbyHexes])

  return (
    <div
      style={{
        width: 168,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        background: '#fffdf8',
        borderLeft: '1px solid #d8d0c4',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{ padding: '10px 10px 6px', borderBottom: '1px solid #e7e1d8', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#3f382f', lineHeight: 1.3 }}>
            {mode === 'add' ? 'Add Color to Palette' : 'Replace color'}
          </div>
          <button
            onClick={onClose}
            style={{ border: 0, background: 'transparent', cursor: 'pointer', fontSize: 14, color: '#7f776d', lineHeight: 1, padding: 0, flexShrink: 0, marginLeft: 4 }}
          >
            ✕
          </button>
        </div>
        {mode === 'swap' && swapFromColor && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 2,
                background: swapFromColor.hex === BLANK_CELL ? '#fffdf8' : swapFromColor.hex,
                backgroundImage: swapFromColor.hex === BLANK_CELL
                  ? 'linear-gradient(90deg, #f1b7b0 0 45%, #f7f2ea 45% 100%)'
                  : undefined,
                display: 'inline-block',
                border: '1px solid rgba(0,0,0,0.12)',
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 10, color: '#7f776d', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {swapFromColor.hex === BLANK_CELL ? 'Blank' : `${swapFromColor.dmc_code} · ${swapFromColor.dmc_name}`}
            </span>
          </div>
        )}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
          style={{ width: '100%', padding: '5px 7px', borderRadius: 5, border: '1px solid #d5cec6', fontFamily: 'inherit', fontSize: 11, boxSizing: 'border-box', background: '#fff', color: '#3f382f', outline: 'none' }}
        />
      </div>

      {/* Everything below the search shares one scroll region, so the pinned
          Nearby/Essentials sections no longer squeeze the catalog into a sliver. */}
      <div style={{ overflow: 'auto', flex: 1, minHeight: 0, padding: '8px 10px' }}>
        {/* Nearby colors: closest shades to the color being replaced —
            swaps are usually "a bit lighter/darker," not a catalog browse */}
        {nearby.length > 0 && (
          <>
            <div style={{ fontSize: 10, fontWeight: 600, color: '#8a8177', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 6 }}>Nearby colors</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4, marginBottom: 8 }}>
              {nearby.map((color) => {
                const inPalette = paletteHexes.has(color.hex)
                return (
                  <button
                    key={color.hex}
                    onClick={() => onSelect(color)}
                    title={`${color.dmc_code} · ${color.dmc_name}`}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                      padding: '4px 2px',
                      border: inPalette ? '1.5px solid #3f382f' : '1px solid #e0d8cf',
                      borderRadius: 5,
                      background: inPalette ? '#f0ece4' : '#fff',
                      cursor: 'pointer',
                      position: 'relative',
                    }}
                  >
                    <span style={{ width: '100%', height: 28, borderRadius: 3, background: color.hex, display: 'block', border: '1px solid rgba(0,0,0,0.12)', position: 'relative' }}>
                      {inPalette && (
                        <span style={{ position: 'absolute', bottom: 1, right: 1, width: 9, height: 9, background: '#3f382f', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 6, color: '#fff', lineHeight: 1 }}>✓</span>
                      )}
                    </span>
                    <span style={{ fontSize: 9, color: '#5c4a3a', fontWeight: 600 }}>{color.dmc_code}</span>
                  </button>
                )
              })}
            </div>
            <div style={{ height: 1, background: '#e7e1d8', marginBottom: 8 }} />
          </>
        )}

        {/* Essentials: black + white */}
        {essentials.length > 0 && (
          <>
            <div style={{ fontSize: 10, fontWeight: 600, color: '#8a8177', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 6 }}>Essentials</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4, marginBottom: 8 }}>
              {essentials.map((color) => {
                const inPalette = paletteHexes.has(color.hex)
                const isWhite = color.hex === '#FFFFFF' || color.hex === '#ffffff'
                return (
                  <button
                    key={color.hex}
                    onClick={() => onSelect(color)}
                    title={`${color.dmc_code} · ${color.dmc_name}`}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                      padding: '4px 2px',
                      border: inPalette ? '1.5px solid #3f382f' : '1px solid #e0d8cf',
                      borderRadius: 5,
                      background: inPalette ? '#f0ece4' : '#fff',
                      cursor: 'pointer',
                      position: 'relative',
                    }}
                  >
                    <span style={{ width: '100%', height: 28, borderRadius: 3, background: color.hex, display: 'block', border: isWhite ? '1px solid #ccc' : '1px solid rgba(0,0,0,0.12)', position: 'relative' }}>
                      {inPalette && (
                        <span style={{ position: 'absolute', bottom: 1, right: 1, width: 9, height: 9, background: '#3f382f', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 6, color: '#fff', lineHeight: 1 }}>✓</span>
                      )}
                    </span>
                    <span style={{ fontSize: 9, color: '#5c4a3a', fontWeight: 600 }}>{color.dmc_code}</span>
                  </button>
                )
              })}
            </div>
            <div style={{ height: 1, background: '#e7e1d8', marginBottom: 8 }} />
          </>
        )}

        {/* Full catalog */}
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#8a8177', fontSize: 11, paddingTop: 16 }}>No results</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4 }}>
            {filtered.map((color) => {
              const inPalette = paletteHexes.has(color.hex)
              return (
                <button
                  key={color.hex}
                  onClick={() => onSelect(color)}
                  title={`${color.dmc_code} · ${color.dmc_name}`}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 2,
                    padding: '4px 2px',
                    border: inPalette ? '1.5px solid #3f382f' : '1px solid transparent',
                    borderRadius: 5,
                    background: inPalette ? '#f0ece4' : 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ width: '100%', height: 28, borderRadius: 3, background: color.hex, display: 'block', border: '1px solid rgba(0,0,0,0.08)', position: 'relative' }}>
                    {inPalette && (
                      <span style={{ position: 'absolute', bottom: 1, right: 1, width: 9, height: 9, background: '#3f382f', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 6, color: '#fff', lineHeight: 1 }}>✓</span>
                    )}
                  </span>
                  <span style={{ fontSize: 9, color: '#5c4a3a', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%', textAlign: 'center' }}>{color.dmc_code}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
