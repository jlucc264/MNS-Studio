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
  colorCountsByHex?: Record<string, number>
  toolMode: 'paint' | 'select' | 'shape'
  onToolModeChange: (mode: 'paint' | 'select' | 'shape') => void
  brushDensity: number
  onBrushDensityChange: (value: number) => void
  hasSelectedRegion: boolean
  selectedRegionCount: number
  selectionMergeSuggestions: PaletteColor[]
  selectionOtherColors: PaletteColor[]
  onApplyColorToSelection: (hex: string) => void
  onClearSelection: () => void
  onEyedropperSelection: () => void
  onSelect: (color: PaletteColor) => void
  onSelectBlankCanvas: () => void
  moreColors: PaletteColor[]
  shapeType: 'box' | 'semicircle' | 'line'
  onShapeTypeChange: (type: 'box' | 'semicircle' | 'line') => void
  shapeFillColor: string | null
  onShapeFillColorChange: (color: string | null) => void
  shapeBorderColor: string | null
  onShapeBorderColorChange: (color: string | null) => void
}

const SPECIAL_COLORS: PaletteColor[] = [
  { hex: '#FFFFFF', dmc_code: 'BLANC', dmc_name: 'White' },
  { hex: '#000000', dmc_code: '310', dmc_name: 'Black' },
]
const BLANK_CELL = '__BLANK__'

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
  colorCountsByHex = {},
  toolMode,
  onToolModeChange,
  brushDensity,
  onBrushDensityChange,
  hasSelectedRegion,
  selectedRegionCount,
  selectionMergeSuggestions,
  selectionOtherColors,
  onApplyColorToSelection,
  onClearSelection,
  onEyedropperSelection,
  onSelect,
  onSelectBlankCanvas,
  moreColors,
  shapeType,
  onShapeTypeChange,
  shapeFillColor,
  onShapeFillColorChange,
  shapeBorderColor,
  onShapeBorderColorChange,
}: Props) {
  const [showOtherColors, setShowOtherColors] = useState(false)
  const [showSelectionOtherColors, setShowSelectionOtherColors] = useState(false)

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

  const orderedColors = useMemo(() => {
    return [...colors].sort((a, b) => {
      const aCount = colorCountsByHex[a.hex] ?? 0
      const bCount = colorCountsByHex[b.hex] ?? 0
      if (aCount !== bCount) return bCount - aCount
      return a.dmc_code.localeCompare(b.dmc_code, undefined, { numeric: true })
    })
  }, [colorCountsByHex, colors])

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

  const isSelectTab = toolMode === 'select'
  const isCreateTab = !isSelectTab
  const isShapeTab = toolMode === 'shape'

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
      {/* Top-level tab row: Create | Select */}
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
          onClick={() => onToolModeChange(isShapeTab ? 'shape' : 'paint')}
          style={{
            ...pill,
            background: isCreateTab ? '#3f382f' : 'transparent',
            color: isCreateTab ? '#fff' : '#8a8177',
          }}
        >
          Create
        </button>
        <button
          type="button"
          onClick={() => onToolModeChange('select')}
          style={{
            ...pill,
            background: isSelectTab ? '#3f382f' : 'transparent',
            color: isSelectTab ? '#fff' : '#8a8177',
          }}
        >
          Select
        </button>
      </div>

      {/* Create tab content */}
      {isCreateTab && (
        <>
          {/* Paint | Shape sub-toggle */}
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
                background: toolMode === 'paint' ? '#6e8d67' : 'transparent',
                color: toolMode === 'paint' ? '#fff' : '#8a8177',
              }}
            >
              ✏ Paint
            </button>
            <button
              type="button"
              onClick={() => onToolModeChange('shape')}
              style={{
                ...pill,
                background: isShapeTab ? '#6e8d67' : 'transparent',
                color: isShapeTab ? '#fff' : '#8a8177',
              }}
            >
              ◻ Shape
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
                    background: activeColor === BLANK_CELL ? '#fffdf8' : activeColor ?? '#ddd',
                    border: activeColor === '#FFFFFF' ? '1px solid #ccc' : '1px solid rgba(0,0,0,0.18)',
                    flexShrink: 0,
                  }}
                />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: '#8a8177' }}>Active brush color</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#3f382f' }}>
                    {activeColorInfo
                      ? `${activeColorInfo.dmc_code} – ${activeColorInfo.dmc_name}`
                      : activeColor === BLANK_CELL
                        ? 'Blank canvas'
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

          {/* Paint sub-tab: color grid */}
          {toolMode === 'paint' && (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {/* Header row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: '#8a8177' }}>{colors.length} colors</span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
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
                      maxWidth: '100%',
                      minWidth: 0,
                    }}
                  >
                    <option value="">+ Add color</option>
                    <option value="other">All DMC colors</option>
                  </select>
                )}
              </div>
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
              {/* Eraser first */}
              <div
                style={{
                  display: 'grid',
                  gap: 6,
                  border: activeColor === BLANK_CELL ? '2px solid #3f382f' : '1px solid #d5cec6',
                  background: activeColor === BLANK_CELL ? '#f5f3ef' : 'white',
                  borderRadius: 8,
                  padding: '5px 6px',
                }}
              >
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={onSelectBlankCanvas}
                    title="Eraser - paint blank canvas"
                    style={{
                      flex: 1,
                      height: 26,
                      border: activeColor === BLANK_CELL ? '2px solid #111' : '1px solid #ccc',
                      borderRadius: 5,
                      background: '#fffdf8',
                      cursor: 'pointer',
                      display: 'grid',
                      placeItems: 'center',
                      padding: 0,
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: 18,
                        height: 11,
                        borderRadius: 3,
                        border: '1px solid #6f665b',
                        background: 'linear-gradient(90deg, #f1b7b0 0 45%, #f7f2ea 45% 100%)',
                        transform: 'rotate(-18deg)',
                        boxShadow: '0 1px 0 rgba(0,0,0,0.12)',
                      }}
                    />
                  </button>
                </div>
                <div style={{ fontSize: 10, color: '#8a8177', lineHeight: 1 }}>
                  Eraser
                </div>
              </div>

              {orderedColors.map((color) => {
                const selected = activeColor === color.hex
                const showSelectionTray = false
                const visibleSuggestions =
                  selectionMergeSuggestions.length > 0 ? selectionMergeSuggestions : fallbackSelectionSuggestions

                return (
                  <div
                    key={`${color.dmc_code}-${color.hex}`}
                    style={{
                      display: 'grid',
                      gap: 6,
                      gridColumn: showSelectionTray ? '1 / -1' : undefined,
                      border: selected ? '2px solid #3f382f' : '1px solid #d5cec6',
                      background: selected ? '#f5f3ef' : 'white',
                      borderRadius: 8,
                      padding: '5px 6px',
                    }}
                  >
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
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
                    <div style={{ fontSize: 10, color: '#8a8177', lineHeight: 1 }}>
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
                        <div style={{ fontSize: 10, color: '#6f665b' }}>
                          Replace {hasSelectedRegion ? `${selectedRegionCount} selected stitches` : 'all matching stitches'} with
                        </div>
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
                            gap: 6,
                          }}
                        >
                          <button
                            type="button"
                            title="Null / blank canvas"
                            onClick={() => onApplyColorToSelection(BLANK_CELL)}
                            style={{
                              height: 34,
                              border: '1px solid #b8aea3',
                              borderRadius: 6,
                              background:
                                'linear-gradient(135deg, #fffdf8 0%, #fffdf8 42%, #b23428 43%, #b23428 57%, #fffdf8 58%, #fffdf8 100%)',
                              color: '#b23428',
                              fontFamily: 'inherit',
                              fontSize: 13,
                              fontWeight: 800,
                              cursor: 'pointer',
                            }}
                          >
                            X
                          </button>
                          {visibleSuggestions.map((suggestion) => (
                            <button
                              key={`suggestion-${suggestion.hex}`}
                              type="button"
                              title={`${suggestion.dmc_code} – ${suggestion.dmc_name}`}
                              onClick={() => onApplyColorToSelection(suggestion.hex)}
                              style={{
                                height: 34,
                                backgroundColor: suggestion.hex,
                                border: '1px solid #bbb',
                                borderRadius: 6,
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
                                  gridTemplateColumns: 'repeat(8, minmax(0, 1fr))',
                                  gap: 6,
                                  maxHeight: 150,
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
                                      height: 28,
                                      backgroundColor: c.hex,
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
          )}

          {/* Shape sub-tab content */}
          {isShapeTab && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minHeight: 0, overflow: 'hidden' }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 1fr',
                  gap: 3,
                  padding: 3,
                  border: '1px solid #d7d0c8',
                  borderRadius: 999,
                  background: '#f0ece5',
                }}
              >
                {(['box', 'semicircle', 'line'] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => onShapeTypeChange(type)}
                    style={{
                      ...pill,
                      background: shapeType === type ? '#3f382f' : 'transparent',
                      color: shapeType === type ? '#fff' : '#8a8177',
                      fontSize: 11,
                    }}
                  >
                    {type === 'box' ? 'Box' : type === 'semicircle' ? 'Arc' : 'Line'}
                  </button>
                ))}
              </div>

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
                <div style={{ fontSize: 11, fontWeight: 600, color: '#6f665b' }}>Fill color</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  <button
                    type="button"
                    onClick={() => onShapeFillColorChange(null)}
                    title="No fill"
                    style={{
                      width: 26, height: 26, borderRadius: 5, padding: 0, flexShrink: 0, cursor: 'pointer',
                      border: shapeFillColor === null ? '2px solid #3f382f' : '1px solid #bbb',
                      background: 'linear-gradient(135deg, #fffdf8 0%, #fffdf8 42%, #b23428 43%, #b23428 57%, #fffdf8 58%, #fffdf8 100%)',
                    }}
                  />
                  {orderedColors.map((color) => (
                    <button
                      key={`fill-${color.hex}`}
                      type="button"
                      onClick={() => onShapeFillColorChange(color.hex)}
                      title={`${color.dmc_code} – ${color.dmc_name}`}
                      style={{
                        width: 26, height: 26, borderRadius: 5, padding: 0, flexShrink: 0, cursor: 'pointer',
                        border: shapeFillColor === color.hex ? '2px solid #3f382f' : '1px solid #bbb',
                        background: color.hex,
                      }}
                    />
                  ))}
                </div>
              </div>

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
                <div style={{ fontSize: 11, fontWeight: 600, color: '#6f665b' }}>Border color</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  <button
                    type="button"
                    onClick={() => onShapeBorderColorChange(null)}
                    title="No border"
                    style={{
                      width: 26, height: 26, borderRadius: 5, padding: 0, flexShrink: 0, cursor: 'pointer',
                      border: shapeBorderColor === null ? '2px solid #3f382f' : '1px solid #bbb',
                      background: 'linear-gradient(135deg, #fffdf8 0%, #fffdf8 42%, #b23428 43%, #b23428 57%, #fffdf8 58%, #fffdf8 100%)',
                    }}
                  />
                  {orderedColors.map((color) => (
                    <button
                      key={`border-${color.hex}`}
                      type="button"
                      onClick={() => onShapeBorderColorChange(color.hex)}
                      title={`${color.dmc_code} – ${color.dmc_name}`}
                      style={{
                        width: 26, height: 26, borderRadius: 5, padding: 0, flexShrink: 0, cursor: 'pointer',
                        border: shapeBorderColor === color.hex ? '2px solid #3f382f' : '1px solid #bbb',
                        background: color.hex,
                      }}
                    />
                  ))}
                </div>
              </div>

              <div
                style={{
                  fontSize: 12,
                  color: '#8a8177',
                  padding: '6px 10px',
                  borderRadius: 8,
                  border: '1px solid #e4ddd5',
                  background: '#faf7f3',
                  lineHeight: 1.4,
                }}
              >
                Drag on the canvas to place shape
              </div>
            </div>
          )}
        </>
      )}

      {/* Select tab */}
      {isSelectTab && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
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
              flexShrink: 0,
            }}
          >
            <span>Choose a palette color to replace it everywhere, or drag a smaller region first.</span>
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
              const visibleSuggestions =
                selectionMergeSuggestions.length > 0 ? selectionMergeSuggestions : fallbackSelectionSuggestions

              return (
                <div
                  key={`sel-${color.dmc_code}-${color.hex}`}
                  style={{
                    display: 'grid',
                    gap: 6,
                    gridColumn: selected ? '1 / -1' : undefined,
                    border: selected ? '2px solid #3f382f' : '1px solid #d5cec6',
                    background: selected ? '#f5f3ef' : 'white',
                    borderRadius: 8,
                    padding: '5px 6px',
                  }}
                >
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
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
                  <div style={{ fontSize: 10, color: '#8a8177', lineHeight: 1 }}>{color.dmc_code}</div>

                  {selected && (
                    <div style={{ display: 'grid', gap: 5, paddingTop: 4, borderTop: '1px solid rgba(0,0,0,0.08)' }}>
                      <div style={{ fontSize: 10, color: '#6f665b' }}>
                        Replace {hasSelectedRegion ? `${selectedRegionCount} selected stitches` : 'all matching stitches'} with
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 6 }}>
                        <button
                          type="button"
                          title="Null / blank canvas"
                          onClick={() => onApplyColorToSelection(BLANK_CELL)}
                          style={{
                            height: 34,
                            border: '1px solid #b8aea3',
                            borderRadius: 6,
                            background: 'linear-gradient(135deg, #fffdf8 0%, #fffdf8 42%, #b23428 43%, #b23428 57%, #fffdf8 58%, #fffdf8 100%)',
                            color: '#b23428',
                            fontFamily: 'inherit',
                            fontSize: 13,
                            fontWeight: 800,
                            cursor: 'pointer',
                          }}
                        >
                          X
                        </button>
                        {visibleSuggestions.map((suggestion) => (
                          <button
                            key={`suggestion-${suggestion.hex}`}
                            type="button"
                            title={`${suggestion.dmc_code} – ${suggestion.dmc_name}`}
                            onClick={() => onApplyColorToSelection(suggestion.hex)}
                            style={{
                              height: 34,
                              backgroundColor: suggestion.hex,
                              border: '1px solid #bbb',
                              borderRadius: 6,
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
                                gridTemplateColumns: 'repeat(8, minmax(0, 1fr))',
                                gap: 6,
                                maxHeight: 150,
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
                                    height: 28,
                                    backgroundColor: c.hex,
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
      )}
    </div>
  )
}
