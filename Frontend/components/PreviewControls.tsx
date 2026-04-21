'use client'

import { useEffect, useState } from 'react'

export type PreviewSettings = {
  width_inches: number
  height_inches: number
  mesh_count: 13 | 18
  color_count: number
  show_grid: boolean
  contrast_level: 'low' | 'normal' | 'high' | 'super_high' | 'super_super_high'
  source_type: 'photo' | 'stitched_photo'
}

const MAX_PRINTABLE_SHORT_SIDE = 7
const MAX_PRINTABLE_LONG_SIDE = 9.5
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
}

export default function PreviewControls({
  importedAspectRatio,
  settings,
  lockAspectRatio,
  onSettingsChange,
  onLockAspectRatioChange,
}: Props) {
  const {
    width_inches: widthInches,
    height_inches: heightInches,
    mesh_count: meshCount,
    color_count: colorCount,
    show_grid: showGrid,
    contrast_level: contrastLevel,
  } = settings

  const borderInches = 1
  const maxColorCount = 64
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
          gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
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
          <span>Colors</span>
          <input
            type="number"
            min="2"
            max={maxColorCount}
            value={colorCount}
            onChange={(e) =>
              onSettingsChange({
                ...settings,
                color_count: Math.min(maxColorCount, Number(e.target.value)),
              })
            }
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
      </div>

      <div
        style={{
          fontSize: 11.5,
          color: '#555',
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 4,
          paddingTop: 2,
          borderTop: '1px solid #e4e4e4',
          width: '100%',
          minWidth: 0,
        }}
      >
        <div>
          <strong>Design:</strong> {widthInches}" x {heightInches}"
        </div>
        <div>
          <strong>Canvas:</strong> {canvasWidthInches}" x {canvasHeightInches}"
        </div>
        <div>
          <strong>Stitches:</strong> {stitchWidth} x {stitchHeight}
        </div>
      </div>
      {settings.source_type === 'stitched_photo' ? (
        <div style={{ fontSize: 11.5, color: '#666' }}>
          Stitched photo mode still tends to work best with fewer colors, but it is no longer capped.
        </div>
      ) : null}
    </div>
  )
}
