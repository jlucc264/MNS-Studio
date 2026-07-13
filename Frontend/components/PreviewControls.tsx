'use client'

import { useEffect } from 'react'

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

import { MAX_PRINTABLE_LONG_SIDE, MAX_PRINTABLE_SHORT_SIDE } from '../lib/api'



type Props = {
  importedAspectRatio: number | null
  settings: PreviewSettings
  lockAspectRatio: boolean
  isBlankCanvas?: boolean
  compact?: boolean
  onSettingsChange: (settings: PreviewSettings) => void
  onLockAspectRatioChange: (nextLocked: boolean) => void
  onDimensionClamped?: () => void
}

export default function PreviewControls({
  importedAspectRatio,
  settings,
  lockAspectRatio,
  isBlankCanvas = false,
  compact = false,
  onSettingsChange,
  onLockAspectRatioChange,
  onDimensionClamped,
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

    const maxHeight = widthInches > MAX_PRINTABLE_SHORT_SIDE ? MAX_PRINTABLE_SHORT_SIDE : MAX_PRINTABLE_LONG_SIDE
    const nextHeight = Number(Math.min(widthInches / importedAspectRatio, maxHeight).toFixed(2))
    if (nextHeight === heightInches) return

    onSettingsChange({
      ...settings,
      height_inches: nextHeight,
    })
  }, [heightInches, importedAspectRatio, lockAspectRatio, onSettingsChange, settings, widthInches])

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

  return (
    <div
      style={{
        display: 'grid',
        gap: compact ? 12 : 10,
        fontSize: compact ? 13 : 12,
        width: '100%',
        minWidth: 0,
        maxWidth: '100%',
      }}
    >
      {/* Source type — grayed out in blank canvas mode */}
      <div style={{ display: 'grid', gap: 4, opacity: isBlankCanvas ? 0.4 : 1, pointerEvents: isBlankCanvas ? 'none' : undefined }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: '#8a8177', textTransform: 'uppercase' }}>Source type</span>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
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
            fontSize: compact ? 13 : 12,
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
          {sourceType === 'graphic_art'
            ? 'For screenshots, logos, and sign art where crisp structure matters.'
            : 'For regular photos and artwork.'}
        </p>
      </div>

      {/* Orientation toggle — blank canvas only */}
      {isBlankCanvas && (
        <div style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: '#8a8177', textTransform: 'uppercase' }}>Orientation</span>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 3,
              padding: 3,
              border: '1px solid #d7d0c8',
              borderRadius: 10,
              background: '#f0ece5',
            }}
          >
            {([
              { label: 'Landscape', landscape: true },
              { label: 'Portrait', landscape: false },
            ] as const).map(({ label, landscape }) => {
              const isActive = landscape ? widthInches >= heightInches : widthInches < heightInches
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => {
                    if (isActive) return
                    onSettingsChange({ ...settings, width_inches: heightInches, height_inches: widthInches })
                  }}
                  style={{
                    padding: '6px 4px',
                    border: 'none',
                    borderRadius: 7,
                    fontFamily: 'inherit',
                    fontSize: compact ? 13 : 12,
                    fontWeight: 600,
                    cursor: isActive ? 'default' : 'pointer',
                    background: isActive ? '#fff' : 'transparent',
                    color: isActive ? '#3f382f' : '#8a8177',
                    boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: compact ? '1fr' : 'repeat(2, minmax(0, 1fr))',
          gap: 8,
          alignItems: 'start',
          width: '100%',
          minWidth: 0,
        }}
      >
        <label style={{ display: 'grid', gap: 3, minWidth: 0, opacity: isBlankCanvas ? 0.4 : 1, pointerEvents: isBlankCanvas ? 'none' : undefined }}>
          <span>Import Width</span>
          <input
            type="number"
            min="1"
            max={MAX_PRINTABLE_LONG_SIDE}
            step="0.5"
            value={widthInches}
            onChange={(e) => {
              const newWidth = Math.max(1, Math.min(Number(e.target.value), MAX_PRINTABLE_LONG_SIDE))
              const maxHeight = newWidth > MAX_PRINTABLE_SHORT_SIDE ? MAX_PRINTABLE_SHORT_SIDE : MAX_PRINTABLE_LONG_SIDE
              const newHeight = lockAspectRatio && importedAspectRatio
                ? Math.min(Number((newWidth / importedAspectRatio).toFixed(2)), maxHeight)
                : Math.min(heightInches, maxHeight)
              if (Number(e.target.value) > MAX_PRINTABLE_LONG_SIDE || heightInches > maxHeight) onDimensionClamped?.()
              onSettingsChange({ ...settings, width_inches: Number(newWidth.toFixed(2)), height_inches: Number(newHeight.toFixed(2)) })
            }}
            style={controlStyle}
          />
        </label>

        <label style={{ display: 'grid', gap: 3, minWidth: 0, opacity: isBlankCanvas ? 0.4 : 1, pointerEvents: isBlankCanvas ? 'none' : undefined }}>
          <span>Import Height</span>
          <input
            type="number"
            min="1"
            max={MAX_PRINTABLE_LONG_SIDE}
            step="0.5"
            value={heightInches}
            onChange={(e) => {
              const newHeight = Math.max(1, Math.min(Number(e.target.value), MAX_PRINTABLE_LONG_SIDE))
              const maxWidth = newHeight > MAX_PRINTABLE_SHORT_SIDE ? MAX_PRINTABLE_SHORT_SIDE : MAX_PRINTABLE_LONG_SIDE
              const newWidth = lockAspectRatio && importedAspectRatio
                ? Math.min(Number((newHeight * importedAspectRatio).toFixed(2)), maxWidth)
                : Math.min(widthInches, maxWidth)
              if (Number(e.target.value) > MAX_PRINTABLE_LONG_SIDE || widthInches > maxWidth) onDimensionClamped?.()
              onSettingsChange({ ...settings, width_inches: Number(newWidth.toFixed(2)), height_inches: Number(newHeight.toFixed(2)) })
            }}
            style={controlStyle}
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
            style={controlStyle}
          >
            <option value={13}>13 mesh</option>
            <option value={18}>18 mesh</option>
          </select>
        </label>

        <label style={{ display: 'grid', gap: 3, minWidth: 0, opacity: isBlankCanvas ? 0.4 : 1, pointerEvents: isBlankCanvas ? 'none' : undefined }}>
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
            style={controlStyle}
          >
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="super_high">Super high</option>
            <option value="super_super_high">Super super high</option>
          </select>
        </label>
      </div>


      <div
        style={{
          display: 'grid',
          gridTemplateColumns: compact ? '1fr' : 'repeat(2, minmax(0, 1fr))',
          gap: compact ? 9 : 8,
          minWidth: 0,
        }}
      >
        <label style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: compact ? 13 : 11.5, lineHeight: 1.2, minWidth: 0, opacity: isBlankCanvas ? 0.4 : 1, pointerEvents: isBlankCanvas ? 'none' : undefined }}>
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

        <label style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: compact ? 13 : 11.5, lineHeight: 1.2, minWidth: 0 }}>
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
