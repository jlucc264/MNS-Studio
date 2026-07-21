'use client'

import { BELT_HEIGHT_INCHES, BELT_MESH_COUNT, BELT_MIN_LENGTH_IN, BELT_MAX_LENGTH_IN, BELT_PANT_SIZES, beltLengthForPantSize } from '../lib/api'
import { type PreviewSettings } from './PreviewControls'

type Props = {
  settings: PreviewSettings
  compact?: boolean
  onSettingsChange: (settings: PreviewSettings) => void
}

// Nearest pant size for the dropdown's selected value — the length may not
// land exactly on `size + 4"` after a manual override, so pick the closest.
function nearestPantSize(lengthInches: number): number {
  return BELT_PANT_SIZES.reduce((best, size) =>
    Math.abs(beltLengthForPantSize(size) - lengthInches) < Math.abs(beltLengthForPantSize(best) - lengthInches)
      ? size
      : best,
  BELT_PANT_SIZES[0])
}

export default function BeltControls({ settings, compact = false, onSettingsChange }: Props) {
  const lengthInches = settings.width_inches

  const controlStyle = {
    fontSize: compact ? 13 : 11.5,
    padding: compact ? '7px 9px' : '4px 6px',
    minWidth: 0,
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid #d7d0c8',
    borderRadius: 6,
    background: '#fffdf8',
    color: '#3f382f',
    fontFamily: 'inherit',
  } as const

  function setLength(next: number) {
    const clamped = Math.max(BELT_MIN_LENGTH_IN, Math.min(next, BELT_MAX_LENGTH_IN))
    onSettingsChange({
      ...settings,
      width_inches: Number(clamped.toFixed(2)),
      height_inches: BELT_HEIGHT_INCHES,
      mesh_count: BELT_MESH_COUNT,
    })
  }

  return (
    <div style={{ display: 'grid', gap: compact ? 12 : 10, fontSize: compact ? 13 : 12, width: '100%', minWidth: 0 }}>
      <p style={{ margin: 0, fontSize: 11, color: '#8a8177', lineHeight: 1.35 }}>
        A long, narrow strip sized to a waist measurement. Stitched length defaults to waist size − 4" —
        height and mesh are fixed.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
        <label style={{ display: 'grid', gap: 3, minWidth: 0 }}>
          <span>Waist size</span>
          <select
            value={nearestPantSize(lengthInches)}
            onChange={(e) => setLength(beltLengthForPantSize(Number(e.target.value)))}
            style={controlStyle}
          >
            {BELT_PANT_SIZES.map((size) => (
              <option key={size} value={size}>{`${size}" waist`}</option>
            ))}
          </select>
        </label>

        <label style={{ display: 'grid', gap: 3, minWidth: 0 }}>
          <span>Stitched length</span>
          <input
            type="number"
            min={BELT_MIN_LENGTH_IN}
            max={BELT_MAX_LENGTH_IN}
            step="0.5"
            value={lengthInches}
            onChange={(e) => setLength(Number(e.target.value))}
            style={controlStyle}
          />
          <span style={{ fontSize: 10, color: '#8a8177' }}>Waist − 4" — edit for an exact length</span>
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
        <div style={{ display: 'grid', gap: 3, minWidth: 0, opacity: 0.6 }}>
          <span>Height</span>
          <div style={controlStyle}>{BELT_HEIGHT_INCHES}"</div>
        </div>
        <div style={{ display: 'grid', gap: 3, minWidth: 0, opacity: 0.6 }}>
          <span>Mesh</span>
          <div style={controlStyle}>{BELT_MESH_COUNT} mesh</div>
        </div>
      </div>

      <label style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: compact ? 13 : 11.5, lineHeight: 1.2, minWidth: 0 }}>
        <input
          type="checkbox"
          checked={settings.show_grid}
          onChange={(e) => onSettingsChange({ ...settings, show_grid: e.target.checked })}
        />
        Show grid
      </label>
    </div>
  )
}
