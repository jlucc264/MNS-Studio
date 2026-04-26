'use client'

import { useEffect, useState } from 'react'

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

const MAX_PRINTABLE_SHORT_SIDE = 7
const MAX_PRINTABLE_LONG_SIDE = 9.5

function formatOneDecimal(value: number) {
  return value.toFixed(1)
}

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
  actualColorCount: number
  lockAspectRatio: boolean
  onSettingsChange: (settings: PreviewSettings) => void
  onLockAspectRatioChange: (nextLocked: boolean) => void
}

export default function PreviewControls({
  importedAspectRatio,
  settings,
  actualColorCount,
  lockAspectRatio,
  onSettingsChange,
  onLockAspectRatioChange,
}: Props) {
  const {
    width_inches: widthInches,
    height_inches: heightInches,
    mesh_count: meshCount,
    show_grid: showGrid,
    clean_background: cleanBackground,
    contrast_level: contrastLevel,
    source_type: sourceType,
  } = settings

  const borderInches = 1
  const canvasWidthInches = widthInches + borderInches * 2
  const canvasHeightInches = heightInches + borderInches * 2

  const stitchWidth = Math.round(widthInches * meshCount)
  const stitchHeight = Math.round(heightInches * meshCount)

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
        gap: 6,
        fontSize: 11.5,
        width: '100%',
        minWidth: 0,
        maxWidth: '100%',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 6,
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
            max="9.5"
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
            max="9.5"
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

      <div
        style={{
          display: 'flex',
          gap: 14,
          flexWrap: 'wrap',
          alignItems: 'center',
          minWidth: 0,
        }}
      >
        <label style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 11.5, lineHeight: 1.1 }}>
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

        <label style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 11.5, lineHeight: 1.1 }}>
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

        <label style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 11.5, lineHeight: 1.1 }}>
            <input
              type="checkbox"
              checked={cleanBackground}
              onChange={(e) =>
                onSettingsChange({
                  ...settings,
                  clean_background: e.target.checked,
                })
              }
            />
            Clean background
        </label>
      </div>

      <div
        style={{
          fontSize: 11.5,
          color: '#555',
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 4,
          paddingTop: 2,
          borderTop: '1px solid #e4e4e4',
          width: '100%',
          minWidth: 0,
        }}
      >
        <div>
          <strong>Design:</strong> {formatOneDecimal(widthInches)}" x {formatOneDecimal(heightInches)}"
        </div>
        <div>
          <strong>Canvas:</strong> {formatOneDecimal(canvasWidthInches)}" x {formatOneDecimal(canvasHeightInches)}"
        </div>
        <div>
          <strong>Stitches:</strong> {stitchWidth} x {stitchHeight}
        </div>
        <div>
          <strong>Actual colors:</strong> {actualColorCount}
        </div>
      </div>
      <div
        style={{
          display: 'grid',
          gap: 4,
          paddingTop: 6,
          borderTop: '1px solid #e4e4e4',
          fontSize: 11.5,
          color: '#666',
        }}
      >
        <div>
          <strong>
            {sourceType === 'stitched_photo'
              ? 'Stitched photo:'
              : sourceType === 'graphic_art'
                ? 'Graphic / screenshot art:'
                : 'Photo:'}
          </strong>{' '}
          {sourceType === 'stitched_photo'
            ? 'Best for photographed needlepoint, canvas texture, and thread-defined text or borders.'
            : sourceType === 'graphic_art'
              ? 'Best for screenshots, logos, sign art, and stitched reference images where crisp structure matters more than photo realism.'
              : 'Best for regular photos, artwork, logos, and cleaner source images.'}
        </div>
        <div>
          {sourceType === 'stitched_photo'
            ? 'Start with fewer colors and only turn Clean background on when canvas tones are stealing the palette.'
            : sourceType === 'graphic_art'
              ? 'Use this when Photo blurs detail and Stitched photo over-simplifies. Clean background can help on some screenshots, but keep it optional.'
              : 'Use Clean background when bright neutral backgrounds are crowding out the main subject.'}
        </div>
      </div>
    </div>
  )
}
