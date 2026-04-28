'use client'

import { ChangeEvent, useEffect, useMemo, useState } from 'react'

type PaletteColor = {
  hex: string
  dmc_code: string
  dmc_name: string
}

type Props = {
  colors: PaletteColor[]
  colorCount: number
  activeColor: string | null
  enabledColorHexes: string[]
  colorCountsByHex?: Record<string, number>
  toolMode: 'paint' | 'select'
  onToolModeChange: (mode: 'paint' | 'select') => void
  brushDensity: number
  onBrushDensityChange: (value: number) => void
  hasSelectedRegion: boolean
  selectedRegionCount: number
  removalMode: 'fill' | 'blank'
  selectionMergeSuggestions: PaletteColor[]
  selectionOtherColors: PaletteColor[]
  onApplyColorToSelection: (hex: string) => void
  onClearSelection: () => void
  onEyedropperSelection: () => void
  onSelect: (color: PaletteColor) => void
  onToggleColorEnabled: (hex: string, enabled: boolean) => void
  onEnableAll: () => void
  onColorCountChange: (nextCount: number) => void
  onAutoReduceToCount: (targetCount: number) => void
  onRemovalModeChange: (mode: 'fill' | 'blank') => void
  moreColors: PaletteColor[]
}

const SPECIAL_COLORS: PaletteColor[] = [
  { hex: '#FFFFFF', dmc_code: 'BLANC', dmc_name: 'White' },
  { hex: '#000000', dmc_code: '310', dmc_name: 'Black' },
]

function hexToRgb(hex: string) {
  const cleaned = hex.replace('#', '')
  return [
    Number.parseInt(cleaned.slice(0, 2), 16),
    Number.parseInt(cleaned.slice(2, 4), 16),
    Number.parseInt(cleaned.slice(4, 6), 16),
  ] as const
}

function colorDistance(a: string, b: string) {
  const [ar, ag, ab] = hexToRgb(a)
  const [br, bg, bb] = hexToRgb(b)
  return Math.sqrt((ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2)
}

export default function PalettePanel({
  colors,
  colorCount,
  activeColor,
  enabledColorHexes,
  colorCountsByHex = {},
  toolMode,
  onToolModeChange,
  brushDensity,
  onBrushDensityChange,
  hasSelectedRegion,
  selectedRegionCount,
  removalMode,
  selectionMergeSuggestions,
  selectionOtherColors,
  onApplyColorToSelection,
  onClearSelection,
  onEyedropperSelection,
  onSelect,
  onToggleColorEnabled,
  onEnableAll,
  onColorCountChange,
  onAutoReduceToCount,
  onRemovalModeChange,
  moreColors,
}: Props) {
  const [showOtherColors, setShowOtherColors] = useState(false)
  const [showSelectionOtherColors, setShowSelectionOtherColors] = useState(false)
  const [autoReduceTarget, setAutoReduceTarget] = useState(12)

  const allOtherColors = useMemo(() => {
    const byHex = new Map<string, PaletteColor>()
    ;[...SPECIAL_COLORS, ...moreColors].forEach((color) => {
      if (!byHex.has(color.hex)) byHex.set(color.hex, color)
    })
    return Array.from(byHex.values())
  }, [moreColors])

  const fallbackSelectionSuggestions = useMemo(() => {
    if (!activeColor) return []
    return [...colors]
      .filter((color) => color.hex !== activeColor)
      .sort((a, b) => colorDistance(activeColor, a.hex) - colorDistance(activeColor, b.hex))
      .slice(0, 6)
  }, [activeColor, colors])

  useEffect(() => {
    if (!colors.length) return
    setAutoReduceTarget((current) => Math.max(2, Math.min(colors.length, current)))
  }, [colors.length])

  const orderedColors = useMemo(() => {
    const enabledSet = new Set(enabledColorHexes)
    return [...colors].sort((a, b) => {
      const aEnabled = enabledSet.has(a.hex) ? 1 : 0
      const bEnabled = enabledSet.has(b.hex) ? 1 : 0
      if (aEnabled !== bEnabled) return bEnabled - aEnabled
      const aCount = colorCountsByHex[a.hex] ?? 0
      const bCount = colorCountsByHex[b.hex] ?? 0
      if (aCount !== bCount) return bCount - aCount
      return a.dmc_code.localeCompare(b.dmc_code, undefined, { numeric: true })
    })
  }, [colorCountsByHex, colors, enabledColorHexes])

  const activeColorInfo = useMemo(
    () => colors.find((c) => c.hex === activeColor) ?? null,
    [activeColor, colors]
  )

  if (!colors.length && !moreColors.length) return null

  const pill = {
    padding: '6px 0',
    border: 'none',
    fontFamily: 'inherit',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    borderRadius: 999,
  } as const

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {/* Tool toggle */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 3,
          padding: 3,
          border: '1px solid #d7d0c8',
          borderRadius: 999,
          background: '#f0ece5',
        }}
      >
        <button
          type="button"
          onClick={() => onToolModeChange('paint')}
          style={{
            ...pill,
            background: toolMode === 'paint' ? '#3f382f' : 'transparent',
            color: toolMode === 'paint' ? '#fff' : '#8a8177',
          }}
        >
          ✏ Paint
        </button>
        <button
          type="button"
          onClick={() => onToolModeChange('select')}
          style={{
            ...pill,
            background: toolMode === 'select' ? '#3f382f' : 'transparent',
            color: toolMode === 'select' ? '#fff' : '#8a8177',
          }}
        >
          ⬚ Select
        </button>
      </div>

      {/* Paint mode: active color + brush size */}
      {toolMode === 'paint' && (
        <div
          style={{
            display: 'grid',
            gap: 6,
            padding: '8px 10px',
            borderRadius: 10,
            border: '1px solid #e4ddd5',
            background: '#faf7f3',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: 6,
                background: activeColor ?? '#ddd',
                border: activeColor === '#FFFFFF' ? '1px solid #ccc' : '1px solid rgba(0,0,0,0.18)',
                flexShrink: 0,
              }}
            />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, color: '#8a8177' }}>Active brush color</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#3f382f' }}>
                {activeColorInfo
                  ? `${activeColorInfo.dmc_code} – ${activeColorInfo.dmc_name}`
                  : activeColor === '#FFFFFF'
                    ? 'BLANC – White'
                    : activeColor
                      ? activeColor
                      : 'None selected'}
              </div>
            </div>
          </div>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              color: '#6f665b',
            }}
          >
            <span style={{ flexShrink: 0 }}>Brush size</span>
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={brushDensity}
              onChange={(event) => onBrushDensityChange(Number(event.target.value))}
              disabled={!activeColor}
              style={{ flex: 1 }}
            />
            <span style={{ minWidth: 14, textAlign: 'right', fontWeight: 600 }}>{brushDensity}</span>
          </label>
        </div>
      )}

      {/* Select mode: hint */}
      {toolMode === 'select' && (
        <div
          style={{
            display: 'grid',
            gap: 6,
            padding: '8px 10px',
            borderRadius: 10,
            border: '1px solid #e4ddd5',
            background: '#faf7f3',
            fontSize: 12,
            color: '#6f665b',
            lineHeight: 1.4,
          }}
        >
          <span>Drag on the canvas to select a region of the active color, then replace it below.</span>
          {hasSelectedRegion && (
            <button
              type="button"
              onClick={onClearSelection}
              style={{
                justifySelf: 'start',
                border: '1px solid #d0c9bf',
                background: '#fff',
                borderRadius: 6,
                padding: '3px 8px',
                fontSize: 11,
                fontFamily: 'inherit',
                cursor: 'pointer',
              }}
            >
              Clear selection ({selectedRegionCount} stitches)
            </button>
          )}
        </div>
      )}

      {/* Color budget + auto reduce */}
      <div style={{ display: 'grid', gap: 6 }}>
        <label style={{ display: 'grid', gap: 3, fontSize: 13, color: '#3f382f' }}>
          <span style={{ fontWeight: 600 }}>Color budget: {colorCount}</span>
          <input
            type="range"
            min={2}
            max={128}
            step={1}
            value={colorCount}
            onChange={(event) => onColorCountChange(Number(event.target.value))}
            style={{ width: '100%' }}
          />
        </label>

        {colors.length > 2 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#6f665b' }}>
            <span style={{ flexShrink: 0 }}>Auto reduce to</span>
            <input
              type="number"
              min={2}
              max={colors.length}
              step={1}
              value={autoReduceTarget}
              onChange={(event) =>
                setAutoReduceTarget(Math.max(2, Math.min(colors.length, Number(event.target.value) || 2)))
              }
              style={{ width: 48, padding: '3px 6px', borderRadius: 6, border: '1px solid #d0c9bf', fontFamily: 'inherit', fontSize: 12 }}
            />
            <button
              type="button"
              onClick={() => onAutoReduceToCount(autoReduceTarget)}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: '1px solid #d0c9bf',
                background: '#fff',
                fontFamily: 'inherit',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Reduce
            </button>
          </div>
        )}
      </div>

      {/* Color grid section */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexShrink: 0 }}>
          <span style={{ fontSize: 12, color: '#8a8177' }}>{colors.length} colors</span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              type="button"
              onClick={onEnableAll}
              style={{
                padding: '3px 8px',
                borderRadius: 6,
                border: '1px solid #d0c9bf',
                background: '#fff',
                fontFamily: 'inherit',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              Turn all on
            </button>
            {allOtherColors.length > 0 && (
              <select
                value={showOtherColors ? 'other' : ''}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => setShowOtherColors(e.target.value === 'other')}
                style={{
                  padding: '3px 6px',
                  borderRadius: 6,
                  border: '1px solid #d0c9bf',
                  background: '#fff',
                  fontFamily: 'inherit',
                  fontSize: 11,
                }}
              >
                <option value="">+ Add color</option>
                <option value="other">All DMC colors</option>
              </select>
            )}
          </div>
        </div>

        {/* Removal mode */}
        <div style={{ display: 'flex', gap: 12, fontSize: 12, color: '#6f665b', flexShrink: 0 }}>
          <span style={{ flexShrink: 0 }}>When off:</span>
          <label style={{ display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="radio"
              name="removal-mode"
              checked={removalMode === 'fill'}
              onChange={() => onRemovalModeChange('fill')}
            />
            Fill nearby
          </label>
          <label style={{ display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="radio"
              name="removal-mode"
              checked={removalMode === 'blank'}
              onChange={() => onRemovalModeChange('blank')}
            />
            Blank
          </label>
        </div>

        {/* Other DMC colors expanded */}
        {showOtherColors && allOtherColors.length > 0 && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              gap: 5,
              maxHeight: 140,
              overflow: 'auto',
              padding: '6px',
              border: '1px solid #e4ddd5',
              borderRadius: 8,
              background: '#faf7f3',
              flexShrink: 0,
            }}
          >
            {allOtherColors.map((color) => (
              <button
                key={`other-${color.hex}`}
                type="button"
                onClick={() => onSelect(color)}
                title={`${color.dmc_code} – ${color.dmc_name}`}
                style={{
                  display: 'grid',
                  justifyItems: 'center',
                  gap: 3,
                  padding: 4,
                  border: activeColor === color.hex ? '2px solid #3f382f' : '1px solid #ccc',
                  borderRadius: 6,
                  background: 'white',
                  cursor: 'pointer',
                }}
              >
                <div
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 3,
                    background: color.hex,
                    border: color.hex === '#FFFFFF' ? '1px solid #bbb' : 'none',
                  }}
                />
                <span style={{ fontSize: 10, lineHeight: 1 }}>{color.dmc_code}</span>
              </button>
            ))}
          </div>
        )}

        {/* Color swatches */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 5,
            alignContent: 'start',
            overflow: 'auto',
            paddingRight: 2,
          }}
        >
          {orderedColors.map((color) => {
            const selected = activeColor === color.hex
            const enabled = enabledColorHexes.includes(color.hex)
            const showSelectionTray = selected && hasSelectedRegion && toolMode === 'select'
            const visibleSuggestions =
              selectionMergeSuggestions.length > 0 ? selectionMergeSuggestions : fallbackSelectionSuggestions

            return (
              <div
                key={`${color.dmc_code}-${color.hex}`}
                style={{
                  display: 'grid',
                  gap: 6,
                  border: selected ? '2px solid #3f382f' : '1px solid #d5cec6',
                  background: enabled ? (selected ? '#f5f3ef' : 'white') : '#f0ece5',
                  borderRadius: 8,
                  padding: '5px 6px',
                  opacity: enabled ? 1 : 0.65,
                }}
              >
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(event) => onToggleColorEnabled(color.hex, event.target.checked)}
                    aria-label={`${enabled ? 'Turn off' : 'Turn on'} ${color.dmc_code}`}
                  />
                  <button
                    type="button"
                    onClick={() => onSelect(color)}
                    title={`${color.dmc_code} – ${color.dmc_name}`}
                    style={{
                      flex: 1,
                      height: 26,
                      backgroundColor: color.hex,
                      border: selected ? '2px solid #111' : '1px solid #ccc',
                      borderRadius: 5,
                      cursor: 'pointer',
                    }}
                  />
                </div>
                <div style={{ fontSize: 10, color: '#8a8177', lineHeight: 1, paddingLeft: 20 }}>
                  {color.dmc_code}
                </div>

                {showSelectionTray && (
                  <div
                    style={{
                      display: 'grid',
                      gap: 5,
                      paddingTop: 4,
                      borderTop: '1px solid rgba(0,0,0,0.08)',
                    }}
                  >
                    <div style={{ fontSize: 10, color: '#6f665b' }}>Replace with</div>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                        gap: 4,
                      }}
                    >
                      {visibleSuggestions.map((suggestion) => (
                        <button
                          key={`suggestion-${suggestion.hex}`}
                          type="button"
                          title={`${suggestion.dmc_code} – ${suggestion.dmc_name}`}
                          onClick={() => onApplyColorToSelection(suggestion.hex)}
                          style={{
                            height: 22,
                            backgroundColor: suggestion.hex,
                            border: '1px solid #bbb',
                            borderRadius: 4,
                            cursor: 'pointer',
                          }}
                        />
                      ))}
                    </div>

                    {selectionOtherColors.length > 0 && (
                      <div style={{ display: 'grid', gap: 3 }}>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            onClick={() => setShowSelectionOtherColors((c) => !c)}
                            style={{
                              border: '1px solid #d0c9bf',
                              background: '#fff',
                              borderRadius: 5,
                              padding: '2px 7px',
                              fontSize: 10,
                              fontFamily: 'inherit',
                              cursor: 'pointer',
                            }}
                          >
                            {showSelectionOtherColors ? 'Hide' : 'Other colors'}
                          </button>
                          {showSelectionOtherColors && (
                            <button
                              type="button"
                              onClick={onEyedropperSelection}
                              style={{
                                border: '1px solid #d0c9bf',
                                background: '#fff',
                                borderRadius: 5,
                                padding: '2px 7px',
                                fontSize: 10,
                                fontFamily: 'inherit',
                                cursor: 'pointer',
                              }}
                            >
                              Eyedropper
                            </button>
                          )}
                        </div>
                        {showSelectionOtherColors && (
                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                              gap: 4,
                              maxHeight: 100,
                              overflow: 'auto',
                            }}
                          >
                            {selectionOtherColors.map((c) => (
                              <button
                                key={`sel-other-${c.hex}`}
                                type="button"
                                title={`${c.dmc_code} – ${c.dmc_name}`}
                                onClick={() => onApplyColorToSelection(c.hex)}
                                style={{
                                  height: 20,
                                  backgroundColor: c.hex,
                                  border: '1px solid #bbb',
                                  borderRadius: 4,
                                  cursor: 'pointer',
                                }}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
