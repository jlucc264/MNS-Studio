'use client'

interface Props {
  open: boolean
  onClose: () => void
}

export default function OrderConfirmationModal({ open, onClose }: Props) {
  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 10060, padding: 18 }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{ background: '#fffdf8', padding: 28, borderRadius: 12, width: 400, maxWidth: '100%', display: 'grid', gap: 14, boxSizing: 'border-box', textAlign: 'center' }}
      >
        <div
          aria-hidden
          style={{
            width: 52, height: 52, margin: '0 auto', borderRadius: '50%',
            background: '#eaf3e4', color: '#4a7c3a', display: 'grid', placeItems: 'center',
            fontSize: 26, lineHeight: 1,
          }}
        >✓</div>
        <div style={{ display: 'grid', gap: 6 }}>
          <h2 style={{ margin: 0 }}>Order confirmed</h2>
          <p style={{ margin: 0, color: '#8a8177', fontSize: 14 }}>
            Thank you! A confirmation email with your order details is on its way to your inbox.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            justifySelf: 'center', padding: '9px 26px', borderRadius: 8,
            border: '1px solid #5c7856', background: '#6e8d67', color: '#fff',
            fontSize: 13, fontWeight: 700, lineHeight: 1.3,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >Done</button>
      </div>
    </div>
  )
}
