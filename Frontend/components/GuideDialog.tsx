'use client'

type Props = {
  open: boolean
  onClose: () => void
}

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
          width: 'min(560px, 100%)',
          display: 'grid',
          gap: 18,
          padding: 24,
          borderRadius: 14,
          border: '1px solid #d8d0c6',
          background: '#fffdf8',
          boxShadow: '0 18px 48px rgba(0,0,0,0.16)',
          color: '#3f382f',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'start' }}>
          <div style={{ display: 'grid', gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: 26, lineHeight: 1.1 }}>MNS Studio</h2>
            <div style={{ height: 1, width: 72, background: '#d8d0c6' }} />
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: '1px solid #d0c8bd',
              background: '#fff',
              borderRadius: 8,
              padding: '8px 12px',
              font: 'inherit',
              cursor: 'pointer',
              color: '#3f382f',
            }}
          >
            Close
          </button>
        </div>

        <div style={{ display: 'grid', gap: 14, fontSize: 17, lineHeight: 1.55 }}>
          <p style={{ margin: 0 }}>
            MNS Studio was built to help needlepointers create the canvases they want. Start from
            scratch or import a photo, save your drafts, and share with others in the gallery.
          </p>
          <p style={{ margin: 0 }}>
            We are building out the capability to print onto canvas. Stay tuned!
          </p>
        </div>
      </div>
    </div>
  )
}
