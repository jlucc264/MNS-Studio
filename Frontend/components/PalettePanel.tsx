'use client'

import { ChangeEvent, useMemo, useState } from 'react'

type PaletteColor = {
  hex: string
  dmc_code: string
  dmc_name: string
}

type Props = {
  colors: PaletteColor[]
  activeColor: string | null
  enabledColorHexes: string[]
  colorCountsByHex?: Record<string, number>
  highlightSelection: boolean
  selectedRegionCount: number
  removalMode: 'fill' | 'blank'
  selectionMergeSuggestions: PaletteColor[]
  selectionOtherColors: PaletteColor[]
  onApplyColorToSelection: (hex: string) => void
  onClearSelection: () => void
  onSelect: (color: PaletteColor) => void
  onHighlightSelectionChange: (value: boolean) => void
  onToggleColorEnabled: (hex: string, enabled: boolean) => void
  onEnableAll: () => void
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
  activeColor,
  enabledColorHexes,
  colorCountsByHex = {},
  highlightSelection,
  selectedRegionCount,
  removalMode,
  selectionMergeSuggestions,
  selectionOtherColors,
  onApplyColorToSelection,
  onClearSelection,
  onSelect,
  onHighlightSelectionChange,
  onToggleColorEnabled,
  onEnableAll,
  onRemovalModeChange,
  moreColors,
}: Props) {
  const [showOtherColors, setShowOtherColors] = useState(false)
  const [showSelectionOtherColors, setShowSelectionOtherColors] = useState(false)

  const suggestedMoreColors = useMemo(() => {
    if (!colors.length || !moreColors.length) return []

    const byHex = new Map<string, PaletteColor>()

    colors.forEach((baseColor) => {
      const nearest = [...moreColors]
        .sort((left, right) => colorDistance(baseColor.hex, left.hex) - colorDistance(baseColor.hex, right.hex))
        .slice(0, 4)

      nearest.forEach((color) => {
        if (!byHex.has(color.hex)) {
          byHex.set(color.hex, color)
        }
      })
    })

    return Array.from(byHex.values()).slice(0, 10)
  }, [colors, moreColors])

  const fallbackSelectionSuggestions = useMemo(() => {
    if (!activeColor) return []

    return [...colors, ...moreColors]
      .filter((color) => color.hex !== activeColor)
      .sort((left, right) => colorDistance(activeColor, left.hex) - colorDistance(activeColor, right.hex))
      .slice(0, 6)
  }, [activeColor, colors, moreColors])

  if (!colors.length && !moreColors.length) return null

  function handleMoreColorChange(event: ChangeEvent<HTMLSelectElement>) {
    const selectedValue = event.target.value
    setShowOtherColors(selectedValue === 'other')
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateRows: 'auto auto auto auto minmax(0, 1fr)',
        gap: 10,
        width: '100%',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        alignContent: 'start',
      }}
    >
      <h3 style={{ margin: 0 }}>Paint palette</h3>

      <div
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <button type="button" onClick={onEnableAll}>
          Turn all on
        </button>
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 13,
            color: '#333',
          }}
        >
          <input
            type="checkbox"
            checked={highlightSelection}
            onChange={(event) => onHighlightSelectionChange(event.target.checked)}
            disabled={!activeColor}
          />
          Highlight selected
        </label>
        {moreColors.length > 0 && (
          <select
            value={showOtherColors ? 'other' : ''}
            onChange={handleMoreColorChange}
            style={{ minWidth: 140, maxWidth: '100%' }}
          >
            <option value="">Other colors</option>
            <option value="other">Show DMC suggestions</option>
          </select>
        )}
      </div>

      {showOtherColors && suggestedMoreColors.length > 0 && (
        <div
          style={{
            display: 'grid',
            gap: 8,
            padding: 8,
            border: '1px solid #ddd',
            borderRadius: 8,
            background: '#fafafa',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <strong style={{ fontSize: 14 }}>Suggested DMC shades</strong>
            <span style={{ fontSize: 12, color: '#666' }}>Based on the uploaded photo</span>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              gap: 6,
            }}
          >
            {[...SPECIAL_COLORS, ...suggestedMoreColors].map((color) => {
              const selected = activeColor === color.hex

              return (
                <button
                  key={`suggested-${color.hex}`}
                  type="button"
                  onClick={() => onSelect(color)}
                  title={`${color.dmc_code} - ${color.dmc_name}`}
                  style={{
                    display: 'grid',
                    justifyItems: 'center',
                    gap: 4,
                    padding: 6,
                    border: selected ? '2px solid black' : '1px solid #bbb',
                    borderRadius: 8,
                    background: 'white',
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 4,
                      background: color.hex,
                      border: color.hex === '#FFFFFF' ? '1px solid #999' : '1px solid #222',
                    }}
                  />
                  <span style={{ fontSize: 11, lineHeight: 1.1 }}>{color.dmc_code}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gap: 6, padding: 8, border: '1px solid #ddd', borderRadius: 8 }}>
        <strong style={{ fontSize: 14 }}>When colors are turned off</strong>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
          <input
            type="radio"
            name="removal-mode"
            checked={removalMode === 'fill'}
            onChange={() => onRemovalModeChange('fill')}
          />
          Fill with nearby colors
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
          <input
            type="radio"
            name="removal-mode"
            checked={removalMode === 'blank'}
            onChange={() => onRemovalModeChange('blank')}
          />
          Remove fully to blank/white
        </label>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 6,
          minHeight: 0,
          alignContent: 'start',
          overflow: 'auto',
          paddingRight: 2,
        }}
      >
        {colors.map((color) => {
          const selected = activeColor === color.hex
          const enabled = enabledColorHexes.includes(color.hex)
          const showSelectionTray = selected && selectedRegionCount > 0
          const visibleSelectionSuggestions =
            selectionMergeSuggestions.length > 0 ? selectionMergeSuggestions : fallbackSelectionSuggestions

          return (
            <div
              key={`${color.dmc_code}-${color.hex}`}
              style={{
                display: 'grid',
                gap: 8,
                border: selected ? '2px solid black' : '1px solid #ccc',
                background: enabled ? (selected ? '#f5f5f5' : 'white') : '#f0f0f0',
                borderRadius: 8,
                padding: 6,
                opacity: enabled ? 1 : 0.7,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                }}
              >
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(event) => onToggleColorEnabled(color.hex, event.target.checked)}
                  aria-label={`${enabled ? 'Turn off' : 'Turn on'} ${color.dmc_code}`}
                />
                <button
                  type="button"
                  onClick={() => onSelect(color)}
                  title={`${color.dmc_code} - ${color.dmc_name}`}
                  style={{
                    flex: 1,
                    height: 28,
                    backgroundColor: color.hex,
                    border: selected ? '2px solid #111' : '1px solid #ccc',
                    borderRadius: 6,
                    cursor: 'pointer',
                  }}
                />
              </div>

              {showSelectionTray && (
                <div
                  style={{
                    display: 'grid',
                    gap: 6,
                    paddingTop: 2,
                    borderTop: '1px solid rgba(0,0,0,0.08)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                    }}
                  >
                    <div style={{ fontSize: 11, color: '#555' }}>Replace with</div>
                    <button
                      type="button"
                      onClick={onClearSelection}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        padding: 0,
                        fontSize: 11,
                        color: '#666',
                        cursor: 'pointer',
                      }}
                    >
                      Clear
                    </button>
                  </div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                      gap: 6,
                    }}
                  >
                    {visibleSelectionSuggestions.map((suggestion) => (
                      <button
                        key={`selection-merge-${suggestion.hex}`}
                        type="button"
                        title={`${suggestion.dmc_code} - ${suggestion.dmc_name}`}
                        onClick={() => onApplyColorToSelection(suggestion.hex)}
                        style={{
                          height: 26,
                          backgroundColor: suggestion.hex,
                          border: '1px solid #bbb',
                          borderRadius: 6,
                          cursor: 'pointer',
                        }}
                      />
                    ))}
                  </div>
                  {selectionOtherColors.length > 0 && (
                    <div style={{ display: 'grid', gap: 4 }}>
                      <button
                        type="button"
                        onClick={() => setShowSelectionOtherColors((current) => !current)}
                        style={{
                          justifySelf: 'start',
                          border: '1px solid #d0d0d0',
                          background: '#fff',
                          borderRadius: 6,
                          padding: '4px 8px',
                          fontSize: 11,
                          cursor: 'pointer',
                        }}
                      >
                        {showSelectionOtherColors ? 'Hide' : 'Other colors'}
                      </button>
                      {showSelectionOtherColors && (
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                            gap: 6,
                            maxHeight: 112,
                            overflow: 'auto',
                            paddingRight: 2,
                          }}
                        >
                          {selectionOtherColors.map((otherColor) => (
                            <button
                              key={`selection-other-${otherColor.hex}`}
                              type="button"
                              title={`${otherColor.dmc_code} - ${otherColor.dmc_name}`}
                              onClick={() => onApplyColorToSelection(otherColor.hex)}
                              style={{
                                height: 24,
                                backgroundColor: otherColor.hex,
                                border: '1px solid #bbb',
                                borderRadius: 6,
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
  )
}
