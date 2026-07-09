'use client'

import { useEffect, useRef, useState } from 'react'
import { loadStripe, type Appearance } from '@stripe/stripe-js'
import {
  Elements,
  ExpressCheckoutElement,
  PaymentElement,
  AddressElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js'
import { formatCents } from '../lib/api'
import { type CheckoutSummary } from '../lib/cart'

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '')

const appearance: Appearance = {
  theme: 'stripe',
  variables: {
    colorPrimary: '#4a7244',
    colorBackground: '#ffffff',
    fontFamily: 'inherit',
    borderRadius: '6px',
    colorText: '#3f382f',
    colorTextSecondary: '#5f574f',
    spacingUnit: '4px',
  },
}

interface Props {
  clientSecret: string
  onClose: () => void
  returnPath: string
  summary?: CheckoutSummary
}

function OrderSummary({ summary }: { summary: CheckoutSummary }) {
  const row: React.CSSProperties = {
    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
    fontSize: 14, color: '#5f574f',
  }
  return (
    <div style={{ borderBottom: '1px solid #e7e1d8', paddingBottom: 16, marginBottom: 4, display: 'grid', gap: 8 }}>
      {summary.lines.map((line, i) => (
        <div key={i} style={row}>
          <span style={{ color: '#3f382f', fontWeight: 500 }}>{line.label}</span>
          <span>{formatCents(line.cents)}</span>
        </div>
      ))}
      <div style={row}>
        <span>Shipping</span>
        <span>{formatCents(summary.shippingCents)}</span>
      </div>
      {summary.creditCents > 0 && (
        <div style={{ ...row, color: '#4a7244' }}>
          <span>Canvas credit</span>
          <span>−{formatCents(summary.creditCents)}</span>
        </div>
      )}
      <div style={{ ...row, borderTop: '1px solid #e7e1d8', paddingTop: 10, fontWeight: 700, fontSize: 16, color: '#3f382f' }}>
        <span>Total</span>
        <span>{formatCents(summary.totalCents)}</span>
      </div>
    </div>
  )
}

function CheckoutForm({ onClose, returnPath, summary }: { onClose: () => void; returnPath: string; summary?: CheckoutSummary }) {
  const stripe = useStripe()
  const elements = useElements()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expressReady, setExpressReady] = useState(false)

  async function confirm() {
    if (!stripe || !elements) return
    setLoading(true)
    setError('')
    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}${returnPath}` },
    })
    if (confirmError) {
      setError(confirmError.message ?? 'Payment failed. Please try again.')
      setLoading(false)
    }
  }

  const sectionLabel: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
    textTransform: 'uppercase', color: '#8a8177', margin: '0 0 10px',
  }

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {summary && <OrderSummary summary={summary} />}

      <div style={{ display: expressReady ? 'block' : 'none' }}>
        <ExpressCheckoutElement
          onConfirm={() => void confirm()}
          onReady={({ availablePaymentMethods }) => {
            if (availablePaymentMethods && Object.keys(availablePaymentMethods).length > 0) {
              setExpressReady(true)
            }
          }}
          options={{
            buttonType: { applePay: 'buy', googlePay: 'buy' },
            paymentMethods: { applePay: 'always', googlePay: 'always', link: 'auto', amazonPay: 'auto' },
          }}
        />
      </div>

      {expressReady && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, height: 1, background: '#e7e1d8' }} />
          <span style={{ fontSize: 12, color: '#8a8177', flexShrink: 0 }}>or pay with card</span>
          <div style={{ flex: 1, height: 1, background: '#e7e1d8' }} />
        </div>
      )}

      <div>
        <p style={sectionLabel}>Shipping address</p>
        <AddressElement options={{ mode: 'shipping', allowedCountries: ['US'] }} />
      </div>

      <div>
        <p style={sectionLabel}>Payment details</p>
        <PaymentElement options={{ layout: 'tabs' }} />
      </div>

      {error && <p style={{ margin: 0, fontSize: 13, color: '#b0453a' }}>{error}</p>}

      <div style={{ display: 'grid', gap: 8, paddingTop: 4 }}>
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={loading || !stripe}
          style={{
            width: '100%', background: '#4a7244', color: '#fff', border: 'none',
            borderRadius: 8, padding: '13px 20px', fontSize: 15, fontWeight: 600,
            cursor: loading || !stripe ? 'not-allowed' : 'pointer',
            opacity: loading || !stripe ? 0.65 : 1, fontFamily: 'inherit',
          }}
        >
          {loading ? 'Processing…' : 'Place order'}
        </button>
        <button
          type="button"
          onClick={onClose}
          style={{
            width: '100%', background: 'none', border: '1px solid #d7d0c8',
            borderRadius: 8, padding: '11px 20px', fontSize: 14,
            color: '#5f574f', cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

export default function CheckoutModal({ clientSecret, onClose, returnPath, summary }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div style={{
        background: '#fffdf8', borderRadius: 12, width: '100%', maxWidth: 460,
        maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
      }}>
        <div style={{
          padding: '18px 24px 14px', borderBottom: '1px solid #e7e1d8',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          position: 'sticky', top: 0, background: '#fffdf8', zIndex: 1,
        }}>
          <h2 style={{ margin: 0, fontSize: 18, color: '#3f382f' }}>Checkout</h2>
          <button
            type="button" onClick={onClose} aria-label="Close"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: '#8a8177', lineHeight: 1, padding: '4px 8px' }}
          >×</button>
        </div>
        <div style={{ padding: '20px 24px 28px' }}>
          <Elements stripe={stripePromise} options={{ clientSecret, appearance }}>
            <CheckoutForm onClose={onClose} returnPath={returnPath} summary={summary} />
          </Elements>
        </div>
      </div>
    </div>
  )
}
