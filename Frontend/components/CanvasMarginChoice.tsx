'use client'

import {
  CANVAS_MARGIN_INCHES,
  formatCents,
  getCanvasForDesign,
  printGalleryTotalCents,
  printOwnTotalCents,
  tierDowngradeMarginInches,
} from '../lib/api'

type Props = {
  widthInches: number
  heightInches: number
  /** Gallery prints carry the creator markup, so the two prices differ. */
  pricing: 'own' | 'gallery'
  value: boolean
  onChange: (tierDowngrade: boolean) => void
  compact?: boolean
}

/** Formats a margin for display. Downgrade margins are the largest that fit the
 *  lower tier, so they're rarely round numbers (1.925") — two decimals, with
 *  trailing zeros trimmed, keeps 1.9" from reading as a different offer than
 *  the 1.90" actually printed. */
function formatMargin(inches: number): string {
  return `${inches.toFixed(2).replace(/0$/, '').replace(/\.$/, '')}″`
}

/** The buyer's choice between the standard border and one roll tier down.
 *
 * A design whose short side sits just above a tier boundary pays for a whole
 * tier of canvas it barely uses. Rather than nudge the designer to resize —
 * a design's size is a design decision, not a pricing one — we show the buyer
 * both prices and let them decide how much unstitched border is worth.
 *
 * Renders nothing when the design doesn't sit near a boundary, which is most
 * of them. The margin shown here is derived by the same function the server
 * prices with; the server never accepts a margin from the client, only the
 * boolean.
 */
export default function CanvasMarginChoice({
  widthInches,
  heightInches,
  pricing,
  value,
  onChange,
  compact = false,
}: Props) {
  const downgradeMargin = tierDowngradeMarginInches(widthInches, heightInches)
  if (downgradeMargin === null) return null

  const total = (marginInches?: number) => {
    const canvas = getCanvasForDesign(widthInches, heightInches, marginInches)
    return pricing === 'gallery' ? printGalleryTotalCents(canvas) : printOwnTotalCents(canvas)
  }
  const standardCents = total()
  const downgradeCents = total(downgradeMargin)
  const savingCents = standardCents - downgradeCents

  // The offer only exists because it saves money. If a rounding edge ever made
  // the narrower canvas cost the same or more, showing it would be asking the
  // buyer to give up border for nothing.
  if (savingCents <= 0) return null

  const downgradeCanvas = getCanvasForDesign(widthInches, heightInches, downgradeMargin)
  const downgradeRoll = Math.min(downgradeCanvas.canvasW, downgradeCanvas.canvasH)

  const options = [
    {
      downgrade: false,
      label: `${formatMargin(CANVAS_MARGIN_INCHES)} border (standard)`,
      note: 'Full unstitched margin for blocking and framing.',
      cents: standardCents,
    },
    {
      downgrade: true,
      label: `${formatMargin(downgradeMargin)} border`,
      note: `Slightly narrower edge; fits the ${downgradeRoll}″ roll. Saves ${formatCents(savingCents)}.`,
      cents: downgradeCents,
    },
  ]

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: compact ? '8px 10px' : '10px 12px',
        border: '1px solid #e4ddd5',
        borderRadius: 10,
        background: '#faf7f3',
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: '#3f382f' }}>Canvas border</div>
      {options.map((option) => {
        const selected = option.downgrade === value
        return (
          <label
            key={String(option.downgrade)}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: compact ? '6px 8px' : '8px 10px',
              borderRadius: 8,
              border: `1px solid ${selected ? '#6e8d67' : '#e0d8cf'}`,
              background: selected ? '#f2f5f0' : '#fff',
              cursor: 'pointer',
            }}
          >
            <input
              type="radio"
              checked={selected}
              onChange={() => onChange(option.downgrade)}
              style={{ marginTop: 2, accentColor: '#6e8d67', flexShrink: 0 }}
            />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#3f382f' }}>{option.label}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#3f382f', whiteSpace: 'nowrap' }}>
                  {formatCents(option.cents)}
                </span>
              </span>
              <span style={{ display: 'block', fontSize: 11, color: '#8a8177', lineHeight: 1.4, marginTop: 2 }}>
                {option.note}
              </span>
            </span>
          </label>
        )
      })}
    </div>
  )
}
