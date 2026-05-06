'use client'

import { useEffect } from 'react'
import type { ContentBounds } from '../lib/api'
import { getCanvasForDesign, formatCents } from '../lib/api'

export type PreviewSettings = {
  width_inches: number
  height_inches: number
  mesh_count: 13 | 18
  color_count: number
  show_grid: boolean
  clean_background: boolean
  simplify_colors: boolean
  strengthen_dark_detail: boolean
  preserve_accents: boolean
  contrast_level: 'low' | 'normal' | 'high' | 'super_high' | 'super_super_high'
  source_type: 'photo' | 'stitched_photo' | 'graphic_art'
}

const MAX_PRINTABLE_SHORT_SIDE = 6
const MAX_PRINTABLE_LONG_SIDE = 10


function clampToPrintableArea(width: number, height: number) {
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)
  const fitsPortrait =
    safeWidth <= MAX_PRINTABLE_SHORT_SIDE && safeHeight <= MAX_PRINTABLE_LONG_SIDE
  const fitsLandscape =
    safeWidth <= MAX_PRINTABLE_LONG_SIDE && safeHeight <= MAX_PRINTABLE_SHORT_SIDE

  if (fitsPortrait || fitsLandscape) {
    return {
      width: Number(safeWidth.toFixed(2)),
      height: Number(safeHeight.toFixed(2)),
    }
  }

  const portraitScale = Math.min(
    MAX_PRINTABLE_SHORT_SIDE / safeWidth,
    MAX_PRINTABLE_LONG_SIDE / safeHeight
  )
  const landscapeScale = Math.min(
    MAX_PRINTABLE_LONG_SIDE / safeWidth,
    MAX_PRINTABLE_SHORT_SIDE / safeHeight
  )
  const scale = Math.max(portraitScale, landscapeScale)

  return {
    width: Number((safeWidth * scale).toFixed(2)),
    height: Number((safeHeight * scale).toFixed(2)),
  }
}

type Props = {
  importedAspectRatio: number | null
  settings: PreviewSettings
  lockAspectRatio: boolean
  onSettingsChange: (settings: PreviewSettings) => void
  onLockAspectRatioChange: (nextLocked: boolean) => void
  contentBounds: ContentBounds | null
}

export default function PreviewControls({
  importedAspectRatio,
  settings,
  lockAspectRatio,
  onSettingsChange,
  onLockAspectRatioChange,
  contentBounds,
}: Props) {
  const {
    width_inches: widthInches,
    height_inches: heightInches,
    mesh_count: meshCount,
    show_grid: showGrid,
    contrast_level: contrastLevel,
    source_type: sourceType,
  } = settings

  useEffect(() => {
    if (!lockAspectRatio || !importedAspectRatio) return

    const nextHeight = Number((widthInches / importedAspectRatio).toFixed(2))
    if (nextHeight === heightInches) return

    onSettingsChange({
      ...settings,
      height_inches: nextHeight,
    })
  }, [heightInches, importedAspectRatio, lockAspectRatio, onSettingsChange, settings, widthInches])

  return (
    <div
      style={{
        display: 'grid',
        gap: 10,
        fontSize: 12,
        width: '100%',
        minWidth: 0,
        maxWidth: '100%',
      }}
    >
      {/* Source type */}
      <div style={{ display: 'grid', gap: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: '#8a8177', textTransform: 'uppercase' }}>Source type</span>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 3,
            padding: 3,
            border: '1px solid #d7d0c8',
            borderRadius: 10,
            background: '#f0ece5',
          }}
        >
          {(
            [
              { value: 'photo', label: 'Photo' },
              { value: 'stitched_photo', label: 'Stitched' },
              { value: 'graphic_art', label: 'Graphic' },
            ] as const
          ).map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => onSettingsChange({ ...settings, source_type: value })}
              style={{
                padding: '6px 4px',
                border: 'none',
                borderRadius: 7,
                fontFamily: 'inherit',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                background: sourceType === value ? '#fff' : 'transparent',
                color: sourceType === value ? '#3f382f' : '#8a8177',
                boxShadow: sourceType === value ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <p style={{ margin: 0, fontSize: 11, color: '#8a8177', lineHeight: 1.35 }}>
          {sourceType === 'stitched_photo'
            ? 'For photographed needlepoint where fabric or canvas colors interfere.'
            : sourceType === 'graphic_art'
              ? 'For screenshots, logos, and sign art where crisp structure matters.'
              : 'For regular photos and artwork.'}
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 8,
          alignItems: 'start',
          width: '100%',
          minWidth: 0,
        }}
      >
        <label style={{ display: 'grid', gap: 3, minWidth: 0 }}>
          <span>Width</span>
          <input
            type="number"
            min="1"
            max="10"
            step="0.5"
            value={widthInches}
            onChange={(e) => {
              const newWidth = Number(e.target.value)
              if (lockAspectRatio && importedAspectRatio) {
                const clamped = clampToPrintableArea(newWidth, newWidth / importedAspectRatio)
                onSettingsChange({
                  ...settings,
                  width_inches: clamped.width,
                  height_inches: clamped.height,
                })
                return
              }

              const clamped = clampToPrintableArea(newWidth, heightInches)
              onSettingsChange({
                ...settings,
                width_inches: clamped.width,
                height_inches: clamped.height,
              })
            }}
            style={{
              fontSize: 11.5,
              padding: '4px 6px',
              minWidth: 0,
              width: '100%',
              boxSizing: 'border-box',
            }}
          />
        </label>

        <label style={{ display: 'grid', gap: 3, minWidth: 0 }}>
          <span>Height</span>
          <input
            type="number"
            min="1"
            max="10"
            step="0.5"
            value={heightInches}
            onChange={(e) => {
              const newHeight = Number(e.target.value)
              if (lockAspectRatio && importedAspectRatio) {
                const clamped = clampToPrintableArea(newHeight * importedAspectRatio, newHeight)
                onSettingsChange({
                  ...settings,
                  width_inches: clamped.width,
                  height_inches: clamped.height,
                })
                return
              }

              const clamped = clampToPrintableArea(widthInches, newHeight)
              onSettingsChange({
                ...settings,
                width_inches: clamped.width,
                height_inches: clamped.height,
              })
            }}
            style={{
              fontSize: 11.5,
              padding: '4px 6px',
              minWidth: 0,
              width: '100%',
              boxSizing: 'border-box',
            }}
          />
        </label>

        <label style={{ display: 'grid', gap: 3, minWidth: 0 }}>
          <span>Mesh</span>
          <select
            value={meshCount}
            onChange={(e) =>
              onSettingsChange({
                ...settings,
                mesh_count: Number(e.target.value) as 13 | 18,
              })
            }
            style={{
              fontSize: 11.5,
              padding: '4px 6px',
              minWidth: 0,
              width: '100%',
              boxSizing: 'border-box',
            }}
          >
            <option value={13}>13 mesh</option>
            <option value={18}>18 mesh</option>
          </select>
        </label>

        <label style={{ display: 'grid', gap: 3, minWidth: 0 }}>
          <span>Contrast</span>
          <select
            value={contrastLevel}
            onChange={(e) =>
              onSettingsChange({
                ...settings,
                contrast_level: e.target.value as
                  | 'low'
                  | 'normal'
                  | 'high'
                  | 'super_high'
                  | 'super_super_high',
              })
            }
            style={{
              fontSize: 11.5,
              padding: '4px 6px',
              minWidth: 0,
              width: '100%',
              boxSizing: 'border-box',
            }}
          >
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="super_high">Super high</option>
            <option value="super_super_high">Super super high</option>
          </select>
        </label>
      </div>

      {contentBounds && (() => {
        const canvas = getCanvasForDesign(contentBounds.width_inches, contentBounds.height_inches)
        return (
          <div style={{ fontSize: 11, color: '#6b7f66', background: '#f0f4ee', border: '1px solid #c8d8c4', borderRadius: 8, padding: '7px 10px', lineHeight: 1.4 }}>
            <span style={{ fontWeight: 700 }}>Content area:</span> {contentBounds.width_inches}" × {contentBounds.height_inches}"
            {canvas && (
              <span style={{ color: '#8a8177' }}> — fits a <strong style={{ color: '#3f382f' }}>{canvas.label}"</strong> canvas ({formatCents(canvas.priceCents)})</span>
            )}
          </div>
        )
      })()}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 8,
          minWidth: 0,
        }}
      >
        <label style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 11.5, lineHeight: 1.1, minWidth: 0 }}>
            <input
              type="checkbox"
              checked={lockAspectRatio}
              onChange={(e) => {
                const nextChecked = e.target.checked
                onLockAspectRatioChange(nextChecked)

                if (nextChecked && importedAspectRatio) {
                  onSettingsChange({
                    ...settings,
                    height_inches: Number((widthInches / importedAspectRatio).toFixed(2)),
                  })
                }
              }}
            />
            Lock ratio
        </label>

        <label style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 11.5, lineHeight: 1.1, minWidth: 0 }}>
            <input
              type="checkbox"
              checked={showGrid}
              onChange={(e) =>
                onSettingsChange({
                  ...settings,
                  show_grid: e.target.checked,
                })
              }
            />
            Show grid
        </label>
      </div>

    </div>
  )
}
