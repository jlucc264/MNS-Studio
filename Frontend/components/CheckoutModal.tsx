'use client'

import { useEffect, useRef, useState } from 'react'
import { loadStripe, type Appearance } from '@stripe/stripe-js'
import {
  Elements,
  PaymentElement,
  AddressElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js'

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '')

const appearance: Appearance = {
  theme: 'stripe',
  variables: {
    colorPrimary: '#4a7244',
    colorBackground: '#fffdf8',
    fontFamily: 'inherit',
    borderRadius: '6px',
    colorText: '#3f382f',
    colorTextSecondary: '#5f574f',
  },
}

interface Props {
  clientSecret: string
  onClose: () => void
  returnPath: string
}

function CheckoutForm({ onClose, returnPath }: { onClose: () => void; returnPath: string }) {
  const stripe = useStripe()
  const elements = useElements()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return
    setLoading(true)
    setError('')

    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}${returnPath}`,
      },
    })

    if (confirmError) {
      setError(confirmError.message ?? 'Payment failed. Please try again.')
      setLoading(false)
    }
  }

  const label: React.CSSProperties = {
    margin: '0 0 8px',
    fontSize: 13,
    fontWeight: 600,
    color: '#3f382f',
    display: 'block',
  }

  const btn: React.CSSProperties = {
    width: '100%',
    border: 'none',
    borderRadius: 8,
    padding: '13px 20px',
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} style={{ display: 'grid', gap: 20 }}>
      <div>
        <span style={label}>Shipping address</span>
        <AddressElement options={{ mode: 'shipping', allowedCountries: ['US'] }} />
      </div>
      <div>
        <span style={label}>Payment</span>
        <PaymentElement options={{ layout: 'accordion' }} />
      </div>
      {error && (
        <p style={{ margin: 0, fontSize: 13, color: '#b0453a' }}>{error}</p>
      )}
      <div style={{ display: 'grid', gap: 8 }}>
        <button
          type="submit"
          disabled={loading || !stripe}
          style={{
            ...btn,
            background: '#4a7244',
            color: '#fff',
            opacity: loading || !stripe ? 0.65 : 1,
            cursor: loading || !stripe ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Processing…' : 'Place order'}
        </button>
        <button
          type="button"
          onClick={onClose}
          style={{
            ...btn,
            background: 'none',
            border: '1px solid #d7d0c8',
            color: '#5f574f',
            fontSize: 14,
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

export default function CheckoutModal({ clientSecret, onClose, returnPath }: Props) {
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
        background: '#fffdf8',
        borderRadius: 12,
        width: '100%',
        maxWidth: 480,
        maxHeight: '90vh',
        overflowY: 'auto',
        boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
        position: 'relative',
      }}>
        <div style={{
          padding: '18px 24px 14px',
          borderBottom: '1px solid #e7e1d8',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <h2 style={{ margin: 0, fontSize: 18, color: '#3f382f' }}>Checkout</h2>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: '#8a8177', lineHeight: 1, padding: '4px 8px' }}
            aria-label="Close"
          >×</button>
        </div>
        <div style={{ padding: '20px 24px 28px' }}>
          <Elements stripe={stripePromise} options={{ clientSecret, appearance }}>
            <CheckoutForm onClose={onClose} returnPath={returnPath} />
          </Elements>
        </div>
      </div>
    </div>
  )
}
