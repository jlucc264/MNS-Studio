'use client'

import { useEffect, useMemo, useState } from 'react'
import { type FontSize, type FontFamily, type TextOrientation, getFontMeta, isRasterFamily, RASTER_FONTS } from '../lib/bitmapFonts'
import { colorDistance } from '../lib/colorDistance'

type PaletteColor = {
  hex: string
  dmc_code: string
  dmc_name: string
}

type Props = {
  colors: PaletteColor[]
  activeDesignColors: PaletteColor[]
  selectionColors?: PaletteColor[]
  activeColor: string | null
  colorCountsByHex?: Record<string, number>
  toolMode: 'paint' | 'select' | 'shape' | 'merge' | 'text' | 'eyedropper' | 'fill' | 'measure'
  onToolModeChange: (mode: 'paint' | 'select' | 'shape' | 'merge' | 'text' | 'eyedropper' | 'fill' | 'measure') => void
  textFontSize: FontSize
  onTextFontSizeChange: (size: FontSize) => void
  textFontFamily: FontFamily
  onTextFontFamilyChange: (family: FontFamily) => void
  textOrientation: TextOrientation
  onTextOrientationChange: (orientation: TextOrientation) => void
  textBold: boolean
  onTextBoldChange: (v: boolean) => void
  textItalic: boolean
  onTextItalicChange: (v: boolean) => void
  textOutline: boolean
  onTextOutlineChange: (v: boolean) => void
  brushDensity: number
  onBrushDensityChange: (value: number) => void
  measurementCount?: number
  onClearMeasurements?: () => void
  hasSelectedRegion: boolean
  selectedRegionCount: number
  onApplyColorToSelection: (hex: string) => void
  onClearSelection: () => void
  hasClipboard: boolean
  hasFloatingStamp: boolean
  isImportPickerOpen: boolean
  onCutSelection: () => void
  onCopySelection: () => void
  onPasteClipboard: () => void
  onImportProject: () => void
  onStampNudge: (direction: 'up' | 'down' | 'left' | 'right') => void
  onRotateStamp: () => void
  onFlipStamp: (axis: 'horizontal' | 'vertical') => void
  onPlaceStamp: () => void
  onCancelStamp: () => void
  hasActiveTextBox: boolean
  onPlaceText: () => void
  onCancelText: () => void
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
  // Phone landscape has too little height for the normal fixed-header
  // plus independently-scrolling-middle layout — the header/tool rows
  // alone can exceed the available space, and content past them is
  // clipped with no way to reach it since the root hides overflow. This
  // lets the whole panel scroll as one unit inside its scrollable
  // ancestor instead of clipping.
  scrollWholePanel?: boolean
}

const BLANK_CELL = '__BLANK__'

export default function PalettePanel({
  colors,
  activeDesignColors,
  selectionColors = [],
  activeColor,
  colorCountsByHex = {},
  toolMode,
  onToolModeChange,
  textFontSize,
  onTextFontSizeChange,
  textFontFamily,
  onTextFontFamilyChange,
  textOrientation,
  onTextOrientationChange,
  textBold,
  onTextBoldChange,
  textItalic,
  onTextItalicChange,
  textOutline,
  onTextOutlineChange,
  brushDensity,
  onBrushDensityChange,
  measurementCount = 0,
  onClearMeasurements,
  hasSelectedRegion,
  selectedRegionCount,
  onApplyColorToSelection,
  onClearSelection,
  hasClipboard,
  hasFloatingStamp,
  isImportPickerOpen,
  onCutSelection,
  onCopySelection,
  onPasteClipboard,
  onImportProject,
  onStampNudge,
  onRotateStamp,
  onFlipStamp,
  onPlaceStamp,
  onCancelStamp,
  hasActiveTextBox,
  onPlaceText,
  onCancelText,
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
  scrollWholePanel,
}: Props) {
  const [hoveredSwatchHex, setHoveredSwatchHex] = useState<string | null>(null)
  const [selectSubMode, setSelectSubMode] = useState<'color' | 'stamp'>('color')

  useEffect(() => {
    if (hasFloatingStamp) setSelectSubMode('stamp')
  }, [hasFloatingStamp])



  const fallbackSelectionSuggestions = useMemo(() => {
    // Blank isn't a real color, so distance-based "nearest shade" doesn't
    // apply — Browse all colors is the only sensible way to fill it.
    if (!activeColor || activeColor === BLANK_CELL) return []
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
  const isFillTab = toolMode === 'fill'
  // Paint, Fill and the eyedropper are one pill: they share the same colour
  // configuration block, and five pills did not fit the row comfortably.
  // Brush vs bucket is a sub-toggle inside that block.
  const isPaintTab = toolMode === 'paint' || toolMode === 'fill' || toolMode === 'eyedropper'

  return (
    <div
      style={
        scrollWholePanel
          ? { display: 'flex', flexDirection: 'column', gap: 10, minHeight: '100%' }
          : { display: 'flex', flexDirection: 'column', gap: 10, height: '100%', minHeight: 0, overflow: 'hidden' }
      }
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
          onClick={() => onToolModeChange(isShapeTab ? 'shape' : isMergeTab ? 'merge' : isTextTab ? 'text' : isFillTab ? 'fill' : 'paint')}
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
          {/* Paint | Measure | Shape | Text sub-toggle */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 3,
              padding: 3,
              border: '1px solid #d7d0c8',
              borderRadius: 999,
              background: '#f0ece5',
            }}
          >
            <button
              type="button"
              // Leave the brush/bucket sub-toggle where the user set it, but
              // still act as the way out of the eyedropper, which is a
              // transient state within this pill rather than a chosen one.
              onClick={() => { if (toolMode !== 'paint' && !isFillTab) onToolModeChange('paint') }}
              style={{
                ...pill,
                background: isPaintTab ? '#6e8d67' : 'transparent',
                color: isPaintTab ? '#fff' : '#8a8177',
                fontSize: 11,
              }}
            >
              ✏ Paint
            </button>
            <button
              type="button"
              onClick={() => onToolModeChange('measure')}
              style={{
                ...pill,
                background: toolMode === 'measure' ? '#6e8d67' : 'transparent',
                color: toolMode === 'measure' ? '#fff' : '#8a8177',
                fontSize: 11,
              }}
            >
              ↔ Measure
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

          {/* Measure mode */}
          {toolMode === 'measure' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div
                style={{
                  fontSize: 12, color: '#8a8177', padding: '6px 10px',
                  borderRadius: 8, border: '1px solid #e4ddd5', background: '#faf7f3',
                  lineHeight: 1.5,
                }}
              >
                <strong>Drag</strong> on canvas to measure. Measurements stay up while you work in other tools. <strong>Tap a line</strong> to show its size; <strong>×</strong> on the label removes it.
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 12, color: '#8a8177' }}>
                  {measurementCount === 0
                    ? 'No measurements'
                    : `${measurementCount} measurement${measurementCount === 1 ? '' : 's'}`}
                </span>
                <button
                  type="button"
                  onClick={onClearMeasurements}
                  disabled={measurementCount === 0}
                  style={{
                    border: '1px solid #d5cec6',
                    borderRadius: 8,
                    padding: '5px 10px',
                    background: '#fff',
                    color: measurementCount === 0 ? '#bdb5ab' : '#b0453a',
                    fontSize: 11,
                    fontWeight: 600,
                    fontFamily: 'inherit',
                    cursor: measurementCount === 0 ? 'default' : 'pointer',
                  }}
                >
                  Clear all
                </button>
              </div>
            </div>
          )}

          {/* Text mode */}
          {isTextTab && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Font family — stitch fonts are hand-tuned bitmaps, display
                  fonts are real TTFs rasterized onto the grid at 16+ stitches */}
              <select
                value={textFontFamily}
                onChange={(e) => onTextFontFamilyChange(e.target.value as FontFamily)}
                style={{
                  padding: '8px 10px',
                  border: '1px solid #d7d0c8',
                  borderRadius: 10,
                  background: '#fff',
                  fontFamily: 'inherit',
                  fontSize: 13,
                  color: '#3f382f',
                  cursor: 'pointer',
                }}
              >
                <optgroup label="Stitch fonts">
                  <option value="sans">Sans</option>
                  <option value="serif">Serif</option>
                  <option value="script">Script (monogram)</option>
                </optgroup>
                <optgroup label="Display fonts">
                  {RASTER_FONTS.map((font) => (
                    <option key={font.id} value={font.id}>{font.label}</option>
                  ))}
                </optgroup>
              </select>

              {/* Font size selector — labels come from the actual glyph grid,
                  deduped because some families (script) share one drawn size */}
              {(() => {
                const sizeOptions = (['small', 'medium', 'large'] as const).filter((size, i, all) => {
                  const m = getFontMeta(size, textFontFamily)
                  return all.findIndex((other) => {
                    const om = getFontMeta(other, textFontFamily)
                    return om.width === m.width && om.height === m.height
                  }) === i
                })
                const active = getFontMeta(textFontSize, textFontFamily)
                return (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: `repeat(${sizeOptions.length}, 1fr)`,
                      gap: 3,
                      padding: 3,
                      border: '1px solid #d7d0c8',
                      borderRadius: 999,
                      background: '#f0ece5',
                    }}
                  >
                    {sizeOptions.map((size) => {
                      const m = getFontMeta(size, textFontFamily)
                      const isActive = m.width === active.width && m.height === active.height
                      return (
                        <button
                          key={size}
                          type="button"
                          onClick={() => onTextFontSizeChange(size)}
                          style={{
                            ...pill,
                            background: isActive ? '#3f382f' : 'transparent',
                            color: isActive ? '#fff' : '#8a8177',
                            fontSize: 11,
                          }}
                        >
                          {isRasterFamily(textFontFamily) ? `${m.height} tall` : `${m.width}×${m.height}`}
                        </button>
                      )
                    })}
                  </div>
                )
              })()}

              {/* Orientation: horizontal, stacked, rotated down/up */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 1fr 1fr',
                  gap: 3,
                  padding: 3,
                  border: '1px solid #d7d0c8',
                  borderRadius: 999,
                  background: '#f0ece5',
                }}
              >
                {([
                  { value: 'horizontal', label: '→', title: 'Horizontal' },
                  { value: 'stacked', label: '↓', title: 'Stacked — upright letters, top to bottom' },
                  { value: 'down', label: '↻', title: 'Rotated 90° — reads downward' },
                  { value: 'up', label: '↺', title: 'Rotated 90° — reads upward' },
                ] as const).map(({ value, label, title }) => (
                  <button
                    key={value}
                    type="button"
                    title={title}
                    onClick={() => onTextOrientationChange(value)}
                    style={{
                      ...pill,
                      background: textOrientation === value ? '#3f382f' : 'transparent',
                      color: textOrientation === value ? '#fff' : '#8a8177',
                      fontSize: 12,
                    }}
                  >
                    {label}
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

              {hasActiveTextBox && (
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 5 }}>
                  <button
                    type="button"
                    onClick={onPlaceText}
                    style={{
                      border: '1px solid #5c7856',
                      borderRadius: 8,
                      background: '#6e8d67',
                      color: '#fff',
                      padding: '10px 8px',
                      fontFamily: 'inherit',
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    ✓ Place
                  </button>
                  <button
                    type="button"
                    onClick={onCancelText}
                    style={{
                      border: '1px solid #d5cec6',
                      borderRadius: 8,
                      background: '#fff',
                      color: '#6f665b',
                      padding: '10px 8px',
                      fontFamily: 'inherit',
                      fontSize: 13,
                      cursor: 'pointer',
                    }}
                  >
                    ✕ Cancel
                  </button>
                </div>
              )}

              {/* Instructions */}
              <div
                style={{
                  fontSize: 12, color: '#8a8177', padding: '6px 10px',
                  borderRadius: 8, border: '1px solid #e4ddd5', background: '#faf7f3',
                  lineHeight: 1.5,
                }}
              >
                <strong>Drag</strong> on canvas to define the box, then type. <strong>Drag the box</strong> to reposition, or click outside and back in to keep editing. Press <strong>Enter</strong> or <strong>Place</strong> to stamp, <strong>Esc</strong> or <strong>Cancel</strong> to discard.
              </div>
            </div>
          )}

          {/* Paint mode: brush/bucket + active color + brush size */}
          {(toolMode === 'paint' || toolMode === 'fill') && (
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
                    fontSize: 11,
                    background: toolMode === 'paint' ? '#3f382f' : 'transparent',
                    color: toolMode === 'paint' ? '#fff' : '#8a8177',
                  }}
                >
                  ✏ Brush
                </button>
                <button
                  type="button"
                  onClick={() => onToolModeChange('fill')}
                  style={{
                    ...pill,
                    fontSize: 11,
                    background: isFillTab ? '#3f382f' : 'transparent',
                    color: isFillTab ? '#fff' : '#8a8177',
                  }}
                >
                  ◍ Bucket
                </button>
              </div>
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
              {/* Bucket floods a whole region, so brush size means nothing to it */}
              {!isFillTab && (
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
              )}
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
          {(toolMode === 'paint' || toolMode === 'eyedropper' || toolMode === 'fill') && (
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minHeight: 0, overflow: 'auto' }}>
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 3, padding: 3, border: '1px solid #d7d0c8', borderRadius: 999, background: '#f0ece5', flexShrink: 0 }}>
            {(['color', 'stamp'] as const).map((mode) => {
              const selected = selectSubMode === mode && !isImportPickerOpen
              return (
              <button
                key={mode}
                type="button"
                onClick={() => setSelectSubMode(mode)}
                style={{
                  ...pill,
                  background: selected ? '#6e8d67' : 'transparent',
                  color: selected ? '#fff' : '#8a8177',
                  fontSize: 11,
                  textTransform: 'capitalize',
                }}
              >
                {mode === 'color' ? '◉ Color' : '✂ Cut / Paste'}
              </button>
              )
            })}
            <button
              type="button"
              onClick={onImportProject}
              disabled={hasFloatingStamp}
              title={hasFloatingStamp ? 'Place or cancel the current stamp first' : undefined}
              style={{
                ...pill,
                background: isImportPickerOpen ? '#6e8d67' : 'transparent',
                color: hasFloatingStamp ? '#c4bcb1' : isImportPickerOpen ? '#fff' : '#8a8177',
                fontSize: 11,
                cursor: hasFloatingStamp ? 'not-allowed' : 'pointer',
              }}
            >
              ⤵ Import
            </button>
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
              : hasFloatingStamp
                ? <span>Drag the floating stamp on the canvas (or use the arrows), rotate or flip it, then Place to commit.</span>
                : <span>Select a region, then Cut or Copy it. Paste drops the last cut/copied stitches back onto the canvas.</span>
            }
            {(hasSelectedRegion || activeColor) && (
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
                {hasSelectedRegion
                  ? `✕ Clear selection (${selectedRegionCount} stitches)`
                  : '✕ Clear highlight'}
              </button>
            )}
          </div>

          {/* Cut / Copy / Paste controls */}
          {selectSubMode === 'stamp' && !hasFloatingStamp && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 5, flexShrink: 0 }}>
              {[
                { label: '✂ Cut', onClick: onCutSelection, disabled: !hasSelectedRegion },
                { label: '⧉ Copy', onClick: onCopySelection, disabled: !hasSelectedRegion },
                { label: '⇩ Paste', onClick: onPasteClipboard, disabled: !hasClipboard },
              ].map(({ label, onClick, disabled }) => (
                <button
                  key={label}
                  type="button"
                  onClick={onClick}
                  disabled={disabled}
                  style={{
                    border: '1px solid #d5cec6',
                    borderRadius: 8,
                    background: disabled ? '#f5f2ee' : '#fff',
                    color: disabled ? '#b0a89e' : '#3f382f',
                    padding: '9px 8px',
                    fontFamily: 'inherit',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: disabled ? 'not-allowed' : 'pointer',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* Floating stamp controls */}
          {selectSubMode === 'stamp' && hasFloatingStamp && (
            <div style={{ display: 'grid', gap: 8, flexShrink: 0 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 5 }}>
                {[
                  { label: '↻ Rotate', onClick: onRotateStamp },
                  { label: '⇋ Flip H', onClick: () => onFlipStamp('horizontal') },
                  { label: '⇵ Flip V', onClick: () => onFlipStamp('vertical') },
                ].map(({ label, onClick }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={onClick}
                    style={{
                      border: '1px solid #d5cec6',
                      borderRadius: 8,
                      background: '#fff',
                      color: '#3f382f',
                      padding: '9px 6px',
                      fontFamily: 'inherit',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 36px)', gridTemplateRows: 'repeat(3, 36px)', gap: 4, justifyContent: 'center' }}>
                {[
                  { dir: 'up' as const, label: '↑', col: 2, row: 1 },
                  { dir: 'left' as const, label: '←', col: 1, row: 2 },
                  { dir: 'right' as const, label: '→', col: 3, row: 2 },
                  { dir: 'down' as const, label: '↓', col: 2, row: 3 },
                ].map(({ dir, label, col, row }) => (
                  <button
                    key={dir}
                    type="button"
                    onClick={() => onStampNudge(dir)}
                    style={{
                      gridColumn: col,
                      gridRow: row,
                      width: 36,
                      height: 36,
                      border: '1px solid #d5cec6',
                      borderRadius: 8,
                      background: '#fff',
                      color: '#3f382f',
                      fontSize: 16,
                      cursor: 'pointer',
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
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 5 }}>
                <button
                  type="button"
                  onClick={onPlaceStamp}
                  style={{
                    border: '1px solid #5c7856',
                    borderRadius: 8,
                    background: '#6e8d67',
                    color: '#fff',
                    padding: '10px 8px',
                    fontFamily: 'inherit',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  ✓ Place
                </button>
                <button
                  type="button"
                  onClick={onCancelStamp}
                  style={{
                    border: '1px solid #d5cec6',
                    borderRadius: 8,
                    background: '#fff',
                    color: '#6f665b',
                    padding: '10px 8px',
                    fontFamily: 'inherit',
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  ✕ Cancel
                </button>
              </div>
            </div>
          )}

          {selectSubMode === 'color' && (() => {
            const showSelectionColors = hasSelectedRegion && selectionColors.length > 0
            const colorsToList = showSelectionColors ? selectionColors : orderedActiveDesignColors
            return (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 11, color: '#8a8177', flexShrink: 0 }}>
              {showSelectionColors ? 'Colors in selection' : 'All colors in design'}
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
            {colorsToList.map((color) => {
              const selected = activeColor === color.hex
              const isBlank = color.hex === BLANK_CELL
              const visibleSuggestions = fallbackSelectionSuggestions
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
                      title={isBlank ? 'Blank cells' : `${color.dmc_code} – ${color.dmc_name}`}
                      style={{
                        flex: 1,
                        height: 26,
                        backgroundColor: isBlank ? '#fffdf8' : color.hex,
                        backgroundImage: isBlank
                          ? 'linear-gradient(90deg, #f1b7b0 0 45%, #f7f2ea 45% 100%)'
                          : undefined,
                        border: selected ? '2px solid #111' : '1px solid #ccc',
                        borderRadius: 5,
                        cursor: 'pointer',
                      }}
                    />
                    {!isBlank && (
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
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: '#8a8177', lineHeight: 1 }}>{isBlank ? 'Blank' : color.dmc_code}</div>

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
                          <div key={`suggestion-${suggestion.hex}`} style={{ display: 'grid', gap: 2 }}>
                            <button
                              type="button"
                              title={`${suggestion.dmc_code} – ${suggestion.dmc_name}`}
                              onClick={() => onApplyColorToSelection(suggestion.hex)}
                              style={{
                                height: 34,
                                width: '100%',
                                backgroundColor: suggestion.hex,
                                border: '1px solid #bbb',
                                borderRadius: 6,
                                cursor: 'pointer',
                                padding: 0,
                              }}
                            />
                            <div
                              style={{
                                fontSize: 8,
                                color: '#8a8177',
                                lineHeight: 1,
                                textAlign: 'center',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {suggestion.dmc_code}
                            </div>
                          </div>
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
            </div>
          </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}
