'use client'

type Props = {
  open: boolean
  onClose: () => void
}

const SECTION_CARD_STYLE = {
  display: 'grid',
  gap: 8,
  padding: 14,
  border: '1px solid #e5e5e5',
  borderRadius: 12,
  background: '#fafafa',
} as const

export default function GuideDialog({ open, onClose }: Props) {
  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: 'rgba(10, 10, 10, 0.35)',
      }}
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 'min(920px, 100%)',
          maxHeight: 'min(88vh, 920px)',
          overflow: 'auto',
          display: 'grid',
          gap: 14,
          padding: 18,
          borderRadius: 18,
          border: '1px solid #d8d8d8',
          background: '#ffffff',
          boxShadow: '0 18px 48px rgba(0,0,0,0.16)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'start',
            gap: 12,
          }}
        >
          <div style={{ display: 'grid', gap: 6 }}>
            <h2 style={{ margin: 0, fontSize: 24, lineHeight: 1.05 }}>How MNS Studio works</h2>
            <div style={{ fontSize: 14, color: '#555', lineHeight: 1.4 }}>
              Bring your own image, choose the source mode that matches it, generate with a high
              color budget, then clean up the palette and finalize the printable PDF.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: '1px solid #d0d0d0',
              background: '#fff',
              borderRadius: 10,
              padding: '8px 12px',
              font: 'inherit',
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 12,
          }}
        >
          <div style={SECTION_CARD_STYLE}>
            <strong>1. Import</strong>
            <div style={{ fontSize: 13.5, color: '#555', lineHeight: 1.45 }}>
              Upload a file or paste a direct image URL. Screenshots are fine, but they usually
              benefit from `Graphic / screenshot art`.
            </div>
          </div>
          <div style={SECTION_CARD_STYLE}>
            <strong>2. Generate high</strong>
            <div style={{ fontSize: 13.5, color: '#555', lineHeight: 1.45 }}>
              Start with a large color budget like `128` so small accents have a chance to survive
              the first pass.
            </div>
          </div>
          <div style={SECTION_CARD_STYLE}>
            <strong>3. Reduce intentionally</strong>
            <div style={{ fontSize: 13.5, color: '#555', lineHeight: 1.45 }}>
              Use `Auto reduce to` in the palette to trim the actual colors without manually
              turning off dozens of swatches.
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 12,
          }}
        >
          <div style={SECTION_CARD_STYLE}>
            <strong>Source modes</strong>
            <div style={{ fontSize: 13.5, color: '#555', lineHeight: 1.45 }}>
              `Photo` is best for regular images and cases where softer text continuity helps.
            </div>
            <div style={{ fontSize: 13.5, color: '#555', lineHeight: 1.45 }}>
              `Stitched photo` is best for photos of finished stitched work when canvas/fabric is
              interfering.
            </div>
            <div style={{ fontSize: 13.5, color: '#555', lineHeight: 1.45 }}>
              `Graphic / screenshot art` is best for screenshots, sign art, logos, and stitched
              reference graphics.
            </div>
          </div>

          <div style={SECTION_CARD_STYLE}>
            <strong>Best workflows</strong>
            <div style={{ fontSize: 13.5, color: '#555', lineHeight: 1.45 }}>
              Screenshot or sign art: `use graphic art`, `preserve accents on`, generate at `128`,
              then auto reduce.
            </div>
            <div style={{ fontSize: 13.5, color: '#555', lineHeight: 1.45 }}>
              Regular photo: `use photo`, `simplify colors on` if it feels noisy, then tune
              contrast.
            </div>
            <div style={{ fontSize: 13.5, color: '#555', lineHeight: 1.45 }}>
              Photographed stitched work: `use stitched photo`, try `clean background on` only if
              neutrals are stealing the palette.
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 12,
          }}
        >
          <div style={SECTION_CARD_STYLE}>
            <strong>Useful chat commands</strong>
            <div style={{ fontSize: 13.5, color: '#555', lineHeight: 1.5 }}>
              `show settings`
              <br />
              `generate preview`
              <br />
              `use graphic art`
              <br />
              `set width to 7`
              <br />
              `use 18 mesh`
            </div>
          </div>

          <div style={SECTION_CARD_STYLE}>
            <strong>Preprocess in chat</strong>
            <div style={{ fontSize: 13.5, color: '#555', lineHeight: 1.5 }}>
              `clean background on`
              <br />
              `simplify colors on`
              <br />
              `strengthen dark detail on`
              <br />
              `preserve accents on`
            </div>
          </div>

          <div style={SECTION_CARD_STYLE}>
            <strong>Palette cleanup</strong>
            <div style={{ fontSize: 13.5, color: '#555', lineHeight: 1.5 }}>
              `turn off 3052`
              <br />
              `turn on 310`
              <br />
              `merge 907 and 3052 into 907`
              <br />
              `analyze palette`
            </div>
          </div>
        </div>

        <div style={SECTION_CARD_STYLE}>
          <strong>Finalize</strong>
          <div style={{ fontSize: 13.5, color: '#555', lineHeight: 1.45 }}>
            When the preview looks right, use `Finalize` to create the printable PDF. The export
            includes the stitch canvas and a report page with the colors used and stitch counts.
          </div>
        </div>
      </div>
    </div>
  )
}
