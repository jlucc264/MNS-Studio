'use client'

import { useMemo, useState } from 'react'
import { type FontSize, type FontFamily } from '../lib/bitmapFonts'

type PaletteColor = {
  hex: string
  dmc_code: string
  dmc_name: string
}

type Props = {
  colors: PaletteColor[]
  activeDesignColors: PaletteColor[]
  activeColor: string | null
  colorCountsByHex?: Record<string, number>
  toolMode: 'paint' | 'select' | 'shape' | 'merge' | 'text' | 'eyedropper'
  onToolModeChange: (mode: 'paint' | 'select' | 'shape' | 'merge' | 'text' | 'eyedropper') => void
  textFontSize: FontSize
  onTextFontSizeChange: (size: FontSize) => void
  textFontFamily: FontFamily
  onTextFontFamilyChange: (family: FontFamily) => void
  textBold: boolean
  onTextBoldChange: (v: boolean) => void
  textItalic: boolean
  onTextItalicChange: (v: boolean) => void
  textOutline: boolean
  onTextOutlineChange: (v: boolean) => void
  brushDensity: number
  onBrushDensityChange: (value: number) => void
  hasSelectedRegion: boolean
  selectedRegionCount: number
  selectionMergeSuggestions: PaletteColor[]
  onApplyColorToSelection: (hex: string) => void
  onClearSelection: () => void
  onMoveSelection: (direction: 'up' | 'down' | 'left' | 'right') => void
  onSelect: (color: PaletteColor) => void
  onSelectBlankCanvas: () => void
  moreColors: PaletteColor[]
  onOpenAddBrowser: () => void
  onOpenSwapBrowser: (color: PaletteColor) => void
  onOpenFillBrowser: () => void
  onOpenBorderBrowser: () => void
  onMergeColor: (color: PaletteColor) => void
  onMergeColorInSelection: (color: PaletteColor) => void
  onResetPalette: () => void
  shapeType: 'box' | 'semicircle' | 'line'
  onShapeTypeChange: (type: 'box' | 'semicircle' | 'line') => void
  arcFlipped: boolean
  onArcFlippedChange: (flipped: boolean) => void
  arcFullCircle: boolean
  onArcFullCircleChange: (full: boolean) => void
  shapeFillColor: string | null
  onShapeFillColorChange: (color: string | null) => void
  shapeBorderColor: string | null
  onShapeBorderColorChange: (color: string | null) => void
  shapeBorderSize: number
  onShapeBorderSizeChange: (size: number) => void
}

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
  activeDesignColors,
  activeColor,
  colorCountsByHex = {},
  toolMode,
  onToolModeChange,
  textFontSize,
  onTextFontSizeChange,
  textFontFamily,
  onTextFontFamilyChange,
  textBold,
  onTextBoldChange,
  textItalic,
  onTextItalicChange,
  textOutline,
  onTextOutlineChange,
  brushDensity,
  onBrushDensityChange,
  hasSelectedRegion,
  selectedRegionCount,
  selectionMergeSuggestions,
  onApplyColorToSelection,
  onClearSelection,
  onMoveSelection,
  onSelect,
  onSelectBlankCanvas,
  moreColors,
  onOpenAddBrowser,
  onOpenSwapBrowser,
  onOpenFillBrowser,
  onOpenBorderBrowser,
  onMergeColor,
  onMergeColorInSelection,
  onResetPalette,
  shapeType,
  onShapeTypeChange,
  arcFlipped,
  onArcFlippedChange,
  arcFullCircle,
  onArcFullCircleChange,
  shapeFillColor,
  onShapeFillColorChange,
  shapeBorderColor,
  onShapeBorderColorChange,
  shapeBorderSize,
  onShapeBorderSizeChange,
}: Props) {
  const [hoveredSwatchHex, setHoveredSwatchHex] = useState<string | null>(null)
  const [selectSubMode, setSelectSubMode] = useState<'color' | 'move'>('color')



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

  const orderedActiveDesignColors = useMemo(() => {
    return [...activeDesignColors].sort((a, b) => {
      const aCount = colorCountsByHex[a.hex] ?? 0
      const bCount = colorCountsByHex[b.hex] ?? 0
      if (aCount !== bCount) return bCount - aCount
      return a.dmc_code.localeCompare(b.dmc_code, undefined, { numeric: true })
    })
  }, [colorCountsByHex, activeDesignColors])

  const shapePickerColors = useMemo(() => {
    const activeHexes = new Set(orderedActiveDesignColors.map((c) => c.hex))
    return [...orderedActiveDesignColors, ...orderedColors.filter((c) => !activeHexes.has(c.hex))]
  }, [orderedActiveDesignColors, orderedColors])

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
  const isMergeTab = toolMode === 'merge'
  const isTextTab = toolMode === 'text'

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
          onClick={() => onToolModeChange(isShapeTab ? 'shape' : isMergeTab ? 'merge' : isTextTab ? 'text' : 'paint')}
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
          {/* Paint | Shape | Text sub-toggle */}
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
            <button
              type="button"
              onClick={() => onToolModeChange('paint')}
              style={{
                ...pill,
                background: toolMode === 'paint' ? '#6e8d67' : 'transparent',
                color: toolMode === 'paint' ? '#fff' : '#8a8177',
                fontSize: 11,
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
                fontSize: 11,
              }}
            >
              ◻ Shape
            </button>
            <button
              type="button"
              onClick={() => onToolModeChange('text')}
              style={{
                ...pill,
                background: isTextTab ? '#6e8d67' : 'transparent',
                color: isTextTab ? '#fff' : '#8a8177',
                fontSize: 11,
              }}
            >
              Aa Text
            </button>
          </div>

          {/* Text mode */}
          {isTextTab && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Font size selector */}
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
                {(['small', 'medium', 'large'] as const).map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => onTextFontSizeChange(size)}
                    style={{
                      ...pill,
                      background: textFontSize === size ? '#3f382f' : 'transparent',
                      color: textFontSize === size ? '#fff' : '#8a8177',
                      fontSize: 11,
                    }}
                  >
                    {size === 'small' ? '3×5' : size === 'medium' ? '5×7' : '8×13'}
                  </button>
                ))}
              </div>

              {/* Font family toggle */}
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
                {(['sans', 'serif'] as const).map((family) => (
                  <button
                    key={family}
                    type="button"
                    onClick={() => onTextFontFamilyChange(family)}
                    style={{
                      ...pill,
                      background: textFontFamily === family ? '#3f382f' : 'transparent',
                      color: textFontFamily === family ? '#fff' : '#8a8177',
                      fontSize: 11,
                    }}
                  >
                    {family === 'sans' ? 'Sans' : 'Serif'}
                  </button>
                ))}
              </div>

              {/* Style toggles: Bold, Italic, Outline */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
                {([
                  { label: 'B', title: 'Bold', active: textBold, onClick: () => onTextBoldChange(!textBold), style: { fontWeight: 700 } },
                  { label: 'I', title: 'Italic', active: textItalic, onClick: () => onTextItalicChange(!textItalic), style: { fontStyle: 'italic' } },
                  { label: '⬜', title: 'Outline', active: textOutline, onClick: () => onTextOutlineChange(!textOutline), style: {} },
                ] as const).map(({ label, title, active, onClick, style }) => (
                  <button
                    key={title}
                    type="button"
                    title={title}
                    onClick={onClick}
                    style={{
                      ...pill,
                      padding: '6px 4px',
                      border: active ? '2px solid #3f382f' : '1px solid #d7d0c8',
                      background: active ? '#3f382f' : '#f0ece5',
                      color: active ? '#fff' : '#8a8177',
                      fontSize: 12,
                      ...style,
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Active color indicator */}
              <div
                style={{
                  display: 'grid',
                  gap: 6,
                  padding: '8px 10px',
                  borderRadius: 10,
                  border: !activeColor ? '1px solid #c94f42' : '1px solid #e4ddd5',
                  background: !activeColor ? '#fff7f5' : '#faf7f3',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div
                    style={{
                      width: 26, height: 26, borderRadius: 6, flexShrink: 0,
                      background: activeColor === BLANK_CELL ? '#fffdf8' : activeColor ?? '#ddd',
                      border: activeColor === '#FFFFFF' ? '1px solid #ccc' : '1px solid rgba(0,0,0,0.18)',
                    }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: '#8a8177' }}>Text color</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: !activeColor ? '#b23428' : '#3f382f' }}>
                      {activeColor && activeColor !== BLANK_CELL
                        ? (colors.find((c) => c.hex === activeColor)
                            ? `${colors.find((c) => c.hex === activeColor)!.dmc_code} – ${colors.find((c) => c.hex === activeColor)!.dmc_name}`
                            : activeColor)
                        : 'None selected'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Instructions */}
              <div
                style={{
                  fontSize: 12, color: '#8a8177', padding: '6px 10px',
                  borderRadius: 8, border: '1px solid #e4ddd5', background: '#faf7f3',
                  lineHeight: 1.5,
                }}
              >
                <strong>Drag</strong> on canvas to define the box, then type. <strong>Drag the box</strong> to reposition before stamping. Press <strong>Enter</strong> to stamp or <strong>Esc</strong> to cancel.
              </div>
            </div>
          )}

          {/* Paint mode: active color + brush size */}
          {toolMode === 'paint' && (
            <div
              style={{
                display: 'grid',
                gap: 6,
                padding: '8px 10px',
                borderRadius: 10,
                border: !activeColor ? '1px solid #c94f42' : '1px solid #e4ddd5',
                background: !activeColor ? '#fff7f5' : '#faf7f3',
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
                  <div style={{ fontSize: 13, fontWeight: 600, color: !activeColor ? '#b23428' : '#3f382f' }}>
                    {activeColorInfo
                      ? `${activeColorInfo.dmc_code} – ${activeColorInfo.dmc_name}`
                      : activeColor === BLANK_CELL
                        ? 'Eraser'
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

          {/* Merge mode card */}
          {isMergeTab && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minHeight: 0 }}>
              <div
                style={{
                  display: 'grid',
                  gap: 6,
                  padding: '8px 10px',
                  borderRadius: 10,
                  border: '1px solid #e4ddd5',
                  background: '#faf7f3',
                  flexShrink: 0,
                }}
              >
                <div style={{ fontSize: 12, color: '#6f665b' }}>Drag to blend stitches into their nearest palette color</div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#6f665b' }}>
                  <span style={{ flexShrink: 0 }}>Brush size</span>
                  <input
                    type="range"
                    min={1}
                    max={5}
                    step={1}
                    value={brushDensity}
                    onChange={(event) => onBrushDensityChange(Number(event.target.value))}
                    style={{ flex: 1 }}
                  />
                  <span style={{ minWidth: 14, textAlign: 'right', fontWeight: 600 }}>{brushDensity}</span>
                </label>
              </div>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#8a8177', letterSpacing: '0.05em', textTransform: 'uppercase', flexShrink: 0 }}>Palette</div>
              <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(34px, 1fr))', gap: 4 }}>
                  {orderedColors.map((color) => (
                    <div
                      key={color.hex}
                      title={`${color.dmc_code} – ${color.dmc_name}`}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 2,
                        padding: '4px 2px',
                        borderRadius: 5,
                        border: '1px solid #e0d8cf',
                      }}
                    >
                      <span style={{ width: '100%', height: 22, borderRadius: 3, background: color.hex, display: 'block', border: color.hex === '#FFFFFF' ? '1px solid #ccc' : '1px solid rgba(0,0,0,0.1)' }} />
                      <span style={{ fontSize: 8, color: '#8a8177', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%', textAlign: 'center' }}>{color.dmc_code}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Paint sub-tab: color grid */}
          {(toolMode === 'paint' || toolMode === 'eyedropper') && (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {/* Eraser row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, flexShrink: 0 }}>
              {/* Eraser */}
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
                <div style={{ fontSize: 10, color: '#8a8177', lineHeight: 1 }}>Eraser</div>
              </div>

              {/* Reset palette */}
              <div
                style={{
                  display: 'grid',
                  gap: 6,
                  border: '1px solid #d5cec6',
                  background: 'white',
                  borderRadius: 8,
                  padding: '5px 6px',
                  cursor: 'pointer',
                }}
                onClick={onResetPalette}
              >
                <div
                  style={{
                    flex: 1,
                    height: 26,
                    border: '1px solid #ccc',
                    borderRadius: 5,
                    background: '#fffdf8',
                    display: 'grid',
                    placeItems: 'center',
                    color: '#5f574e',
                    fontSize: 13,
                    lineHeight: 1,
                  }}
                >
                  ↺
                </div>
                <div style={{ fontSize: 10, color: '#8a8177', lineHeight: 1 }}>Reset palette</div>
              </div>
            </div>


            {/* On canvas — active colors pinned section */}
            {orderedActiveDesignColors.length > 0 && (
              <>
                <div style={{ fontSize: 10, fontWeight: 600, color: '#8a8177', letterSpacing: '0.05em', textTransform: 'uppercase', flexShrink: 0 }}>On canvas</div>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 4,
                    flexShrink: 0,
                  }}
                >
                  {orderedActiveDesignColors.map((color) => (
                    <button
                      key={`active-${color.hex}`}
                      type="button"
                      onClick={() => onSelect(color)}
                      title={`${color.dmc_code} – ${color.dmc_name}`}
                      style={{
                        width: 26, height: 26, borderRadius: 5, padding: 0, flexShrink: 0, cursor: 'pointer',
                        border: activeColor === color.hex ? '2px solid #3f382f' : '1px solid #bbb',
                        background: color.hex,
                      }}
                    />
                  ))}
                </div>
              </>
            )}

            {/* Palette header + Eyedropper + Browse buttons */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#8a8177', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Your palette</div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  type="button"
                  onClick={() => onToolModeChange(toolMode === 'eyedropper' ? 'paint' : 'eyedropper')}
                  title="Sample a color from the source image"
                  style={{ border: `1px solid ${toolMode === 'eyedropper' ? '#6e8d67' : '#d5cec6'}`, borderRadius: 5, padding: '2px 7px', background: toolMode === 'eyedropper' ? '#6e8d67' : '#fff', color: toolMode === 'eyedropper' ? '#fff' : '#3f382f', fontSize: 10, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}
                >⌖</button>
                <button
                  type="button"
                  onClick={onOpenAddBrowser}
                  style={{ border: '1px solid #d5cec6', borderRadius: 5, padding: '2px 7px', background: '#fff', color: '#3f382f', fontSize: 10, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}
                >Browse →</button>
              </div>
            </div>

            {/* Color swatches — palette colors below */}
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

                return (
                  <div
                    key={`${color.dmc_code}-${color.hex}`}
                    style={{
                      display: 'grid',
                      gap: 6,
                      border: selected ? '2px solid #3f382f' : '1px solid #d5cec6',
                      background: selected ? '#f5f3ef' : 'white',
                      borderRadius: 8,
                      padding: '5px 6px',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(color)}
                      title={`${color.dmc_code} – ${color.dmc_name}`}
                      style={{
                        height: 26,
                        backgroundColor: color.hex,
                        border: selected ? '2px solid #111' : '1px solid #ccc',
                        borderRadius: 5,
                        cursor: 'pointer',
                      }}
                    />
                    <div style={{ fontSize: 10, color: '#8a8177', lineHeight: 1 }}>
                      {color.dmc_code}
                    </div>
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

              {/* Arc controls */}
              {shapeType === 'semicircle' && !arcFullCircle && (
                <button
                  type="button"
                  title="Flip arc axis 90°"
                  onClick={() => onArcFlippedChange(!arcFlipped)}
                  style={{
                    ...pill,
                    padding: '6px 10px',
                    border: '1px solid #d7d0c8',
                    background: arcFlipped ? '#3f382f' : '#f0ece5',
                    color: arcFlipped ? '#fff' : '#3f382f',
                    fontSize: 12,
                    alignSelf: 'stretch',
                  }}
                >
                  ↻ Flip axis
                </button>
              )}
              {shapeType === 'semicircle' && (
                <button
                  type="button"
                  title="Toggle full circle"
                  onClick={() => onArcFullCircleChange(!arcFullCircle)}
                  style={{
                    ...pill,
                    padding: '6px 10px',
                    border: '1px solid #d7d0c8',
                    background: arcFullCircle ? '#3f382f' : '#f0ece5',
                    color: arcFullCircle ? '#fff' : '#3f382f',
                    fontSize: 12,
                    alignSelf: 'stretch',
                  }}
                >
                  ◯ Full circle
                </button>
              )}

              {shapeType !== 'line' && <div
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
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={() => onShapeFillColorChange(BLANK_CELL)}
                    title="Erase — removes stitches inside shape"
                    style={{
                      width: 26, height: 26, borderRadius: 5, padding: 0, flexShrink: 0, cursor: 'pointer',
                      border: shapeFillColor === BLANK_CELL ? '2px solid #3f382f' : '1px solid #bbb',
                      background: '#fffdf8', display: 'grid', placeItems: 'center',
                    }}
                  >
                    <span style={{ width: 16, height: 9, borderRadius: 2, border: '1px solid #6f665b', background: 'linear-gradient(90deg, #f1b7b0 0 45%, #f7f2ea 45% 100%)', transform: 'rotate(-18deg)', display: 'block', boxShadow: '0 1px 0 rgba(0,0,0,0.1)' }} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onShapeFillColorChange(null)}
                    title="No fill — leave stitches inside unchanged"
                    style={{
                      width: 26, height: 26, borderRadius: 5, padding: 0, flexShrink: 0, cursor: 'pointer',
                      border: shapeFillColor === null ? '2px solid #3f382f' : '1px solid #bbb',
                      background: '#fffdf8', display: 'grid', placeItems: 'center',
                    }}
                  >
                    <span style={{ width: 14, height: 14, borderRadius: 2, border: '1.5px dashed #9a9287', display: 'block' }} />
                  </button>
                  {shapePickerColors.map((color) => (
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
                  <button
                    type="button"
                    onClick={onOpenFillBrowser}
                    title="Browse all colors"
                    style={{
                      width: 26, height: 26, borderRadius: 5, padding: 0, flexShrink: 0, cursor: 'pointer',
                      border: '1px solid #bbb', background: '#fffdf8', color: '#5f574e',
                      fontSize: 18, fontWeight: 300, lineHeight: 1, display: 'grid', placeItems: 'center',
                    }}
                  >+</button>
                </div>
              </div>}

              <div
                style={{
                  display: 'grid',
                  gap: 6,
                  padding: '8px 10px',
                  borderRadius: 10,
                  border: '1px solid #e4ddd5',
                  background: '#faf7f3',
                  marginTop: 6,
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 600, color: '#6f665b' }}>{shapeType === 'line' ? 'Fill color' : 'Border color'}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={() => onShapeBorderColorChange(BLANK_CELL)}
                    title="Erase — removes stitches along border"
                    style={{
                      width: 26, height: 26, borderRadius: 5, padding: 0, flexShrink: 0, cursor: 'pointer',
                      border: shapeBorderColor === BLANK_CELL ? '2px solid #3f382f' : '1px solid #bbb',
                      background: '#fffdf8', display: 'grid', placeItems: 'center',
                    }}
                  >
                    <span style={{ width: 16, height: 9, borderRadius: 2, border: '1px solid #6f665b', background: 'linear-gradient(90deg, #f1b7b0 0 45%, #f7f2ea 45% 100%)', transform: 'rotate(-18deg)', display: 'block', boxShadow: '0 1px 0 rgba(0,0,0,0.1)' }} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onShapeBorderColorChange(null)}
                    title={shapeType === 'line' ? 'No fill' : 'No border'}
                    style={{
                      width: 26, height: 26, borderRadius: 5, padding: 0, flexShrink: 0, cursor: 'pointer',
                      border: shapeBorderColor === null ? '2px solid #3f382f' : '1px solid #bbb',
                      background: '#fffdf8', display: 'grid', placeItems: 'center',
                    }}
                  >
                    <span style={{ width: 14, height: 14, borderRadius: 2, border: '1.5px dashed #9a9287', display: 'block' }} />
                  </button>
                  {shapePickerColors.map((color) => (
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
                  <button
                    type="button"
                    onClick={onOpenBorderBrowser}
                    title="Browse all colors"
                    style={{
                      width: 26, height: 26, borderRadius: 5, padding: 0, flexShrink: 0, cursor: 'pointer',
                      border: '1px solid #bbb', background: '#fffdf8', color: '#5f574e',
                      fontSize: 18, fontWeight: 300, lineHeight: 1, display: 'grid', placeItems: 'center',
                    }}
                  >+</button>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#6f665b' }}>
                  <span style={{ flexShrink: 0 }}>{shapeType === 'line' ? 'Line size' : 'Border size'}</span>
                  <input
                    type="range"
                    min={1}
                    max={4}
                    step={1}
                    value={shapeBorderSize}
                    onChange={(e) => onShapeBorderSizeChange(Number(e.target.value))}
                    disabled={shapeBorderColor === null}
                    style={{ flex: 1 }}
                  />
                  <span style={{ minWidth: 14, textAlign: 'right', fontWeight: 600 }}>{shapeBorderSize}</span>
                </label>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  fontSize: 12,
                  color: '#8a8177',
                  padding: '6px 10px',
                  borderRadius: 8,
                  border: '1px solid #e4ddd5',
                  background: '#faf7f3',
                  lineHeight: 1.4,
                }}
              >
                <span>Drag on canvas to place</span>
                <button
                  type="button"
                  onClick={onResetPalette}
                  title="Reset palette to original"
                  style={{
                    border: '1px solid #d5cec6', borderRadius: 5, padding: '2px 7px',
                    background: '#fff', color: '#6f665b', fontSize: 10, fontFamily: 'inherit',
                    cursor: 'pointer', flexShrink: 0, lineHeight: 1.4,
                  }}
                >↺ Reset</button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Select tab */}
      {isSelectTab && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/* Sub-tab toggle */}
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            {(['color', 'move'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setSelectSubMode(mode)}
                style={{
                  flex: 1,
                  padding: '5px 0',
                  borderRadius: 7,
                  border: '1px solid',
                  borderColor: selectSubMode === mode ? '#5c7856' : '#d5cec6',
                  background: selectSubMode === mode ? '#6e8d67' : '#fff',
                  color: selectSubMode === mode ? '#fff' : '#6f665b',
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                }}
              >
                {mode}
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
              fontSize: 12,
              color: '#6f665b',
              lineHeight: 1.4,
              flexShrink: 0,
            }}
          >
            {selectSubMode === 'color'
              ? <span>Choose a color to highlight all active cells, or select a region first. Can select multiple regions by holding down CTRL.</span>
              : <span>Select a region, then use the arrows to shift it one cell at a time. Cells moved off the edge are discarded.</span>
            }
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

          {/* Move controls */}
          {selectSubMode === 'move' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 36px)', gridTemplateRows: 'repeat(3, 36px)', gap: 4, justifyContent: 'center', flexShrink: 0, paddingTop: 4 }}>
              {[
                { dir: 'up' as const, label: '↑', col: 2, row: 1 },
                { dir: 'left' as const, label: '←', col: 1, row: 2 },
                { dir: 'right' as const, label: '→', col: 3, row: 2 },
                { dir: 'down' as const, label: '↓', col: 2, row: 3 },
              ].map(({ dir, label, col, row }) => (
                <button
                  key={dir}
                  type="button"
                  onClick={() => onMoveSelection(dir)}
                  disabled={!hasSelectedRegion}
                  style={{
                    gridColumn: col,
                    gridRow: row,
                    width: 36,
                    height: 36,
                    border: '1px solid #d5cec6',
                    borderRadius: 8,
                    background: hasSelectedRegion ? '#fff' : '#f5f2ee',
                    color: hasSelectedRegion ? '#3f382f' : '#b0a89e',
                    fontSize: 16,
                    cursor: hasSelectedRegion ? 'pointer' : 'not-allowed',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: 'inherit',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {selectSubMode === 'color' && <div
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
            {orderedActiveDesignColors.map((color) => {
              const selected = activeColor === color.hex
              const visibleSuggestions =
                selectionMergeSuggestions.length > 0 ? selectionMergeSuggestions : fallbackSelectionSuggestions
              const hovered = hoveredSwatchHex === color.hex

              return (
                <div
                  key={`sel-${color.dmc_code}-${color.hex}`}
                  onMouseEnter={() => setHoveredSwatchHex(color.hex)}
                  onMouseLeave={() => setHoveredSwatchHex(null)}
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
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
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
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); hasSelectedRegion ? onMergeColorInSelection(color) : onMergeColor(color) }}
                      title={hasSelectedRegion ? 'Merge selected stitches into nearest color' : 'Merge all into nearest color'}
                      style={{
                        flexShrink: 0,
                        width: 18,
                        height: 26,
                        border: '1px solid #d5cec6',
                        borderRadius: 4,
                        background: hovered ? '#f0ece4' : 'transparent',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 11,
                        color: hovered ? '#3f382f' : 'transparent',
                        transition: 'color 0.1s, background 0.1s',
                        padding: 0,
                      }}
                    >
                      ⊕
                    </button>
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
                          title="Erase stitches"
                          onClick={() => onApplyColorToSelection(BLANK_CELL)}
                          style={{
                            height: 34,
                            border: '1px solid #d5cec6',
                            borderRadius: 6,
                            background: '#fffdf8',
                            cursor: 'pointer',
                            display: 'grid',
                            placeItems: 'center',
                          }}
                        >
                          <span style={{ width: 16, height: 9, borderRadius: 2, border: '1px solid #6f665b', background: 'linear-gradient(90deg, #f1b7b0 0 45%, #f7f2ea 45% 100%)', transform: 'rotate(-18deg)', display: 'block', boxShadow: '0 1px 0 rgba(0,0,0,0.1)' }} />
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
                        <button
                          type="button"
                          title="Browse all colors"
                          onClick={() => onOpenSwapBrowser(color)}
                          style={{
                            height: 34,
                            border: '1px solid #bbb',
                            borderRadius: 6,
                            background: '#fffdf8',
                            color: '#5f574e',
                            fontSize: 18,
                            fontWeight: 300,
                            lineHeight: 1,
                            display: 'grid',
                            placeItems: 'center',
                            cursor: 'pointer',
                            padding: 0,
                          }}
                        >+</button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>}
        </div>
      )}
    </div>
  )
}
