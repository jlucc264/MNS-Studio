'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { createCartCheckout, formatCents } from '../lib/api'
import { cartRead, cartRemove, cartSetQty, cartSubtotal, cartTotal, CART_SHIPPING_CENTS, type CartItem } from '../lib/cart'

interface Props {
  open: boolean
  onClose: () => void
  accessToken: string | null
  onCheckoutReady: (clientSecret: string) => void
  pendingCents: number | null
}

export default function CartDrawer({ open, onClose, accessToken, onCheckoutReady, pendingCents }: Props) {
  const [items, setItems] = useState<CartItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [useCredit, setUseCredit] = useState(true)

  useEffect(() => {
    if (open) setItems(cartRead())
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'mns_cart') setItems(cartRead())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [open])

  if (!open) return null

  async function handleCheckout() {
    if (!accessToken) return
    setLoading(true)
    setError('')
    try {
      const { client_secret } = await createCartCheckout(
        items.map(i => ({
          pdf_url: i.pdf_url,
          internal_pdf_supabase_path: i.internal_pdf_supabase_path,
          width_inches: i.width_inches,
          height_inches: i.height_inches,
          quantity: i.quantity,
          gallery_item_id: i.gallery_item_id,
          parent_gallery_item_id: i.parent_gallery_item_id,
          project_id: i.project_id,
        })),
        accessToken,
        useCredit,
      )
      onClose()
      onCheckoutReady(client_secret)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start checkout.')
    } finally {
      setLoading(false)
    }
  }

  function remove(id: string) {
    cartRemove(id)
    setItems(cartRead())
  }

  function setQty(id: string, qty: number) {
    cartSetQty(id, qty)
    setItems(cartRead())
  }

  const subtotal = cartSubtotal(items)
  const total = cartTotal(items)
  // Mirrors backend _apply_canvas_credit: credit covers prints only (not
  // shipping) and leaves a 50¢ minimum charge on the line items.
  const creditAvailable = pendingCents && pendingCents > 0 ? Math.min(pendingCents, Math.max(0, subtotal - 50)) : 0
  const credit = useCredit ? creditAvailable : 0
  const totalAfterCredit = total - credit
  const itemCount = items.reduce((s, i) => s + i.quantity, 0)

  const btn: React.CSSProperties = {
    border: 'none', cursor: 'pointer', fontFamily: 'inherit', borderRadius: 8,
    padding: '11px 16px', fontSize: 14, fontWeight: 600,
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex' }}
    >
      <div style={{ flex: 1, background: 'rgba(0,0,0,0.35)' }} onClick={onClose} />
      <div style={{
        width: 360,
        maxWidth: '90vw',
        background: '#fffdf8',
        display: 'flex',
        flexDirection: 'column',
        borderLeft: '1px solid #e7e1d8',
        overflow: 'hidden',
      }}>
        <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid #e7e1d8', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Cart {itemCount > 0 && `(${itemCount})`}</h2>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: '#8a8177', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px', display: 'grid', gap: 14, alignContent: 'start' }}>
          {items.length === 0 ? (
            <p style={{ margin: '24px 0 0', color: '#8a8177', textAlign: 'center', fontSize: 14 }}>Your cart is empty.</p>
          ) : items.map(item => (
            <div key={item.id} style={{ display: 'grid', gap: 8, paddingBottom: 14, borderBottom: '1px solid #e7e1d8' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 8 }}>
                <div>
                  {(() => {
                    const href = item.gallery_item_id
                      ? `/gallery?item=${item.gallery_item_id}`
                      : item.project_id
                        ? `/studio?project=${item.project_id}`
                        : null
                    return href ? (
                      <Link href={href} onClick={onClose} style={{ fontWeight: 600, fontSize: 14, color: '#3f382f', textDecoration: 'underline', textDecorationColor: '#d7d0c8' }}>
                        {item.title}
                      </Link>
                    ) : (
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{item.title}</div>
                    )
                  })()}
                  <div style={{ fontSize: 12, color: '#8a8177', marginTop: 2 }}>{item.canvas_label} canvas</div>
                  {(item.gallery_item_id ?? item.parent_gallery_item_id) && (
                    <div style={{ fontSize: 11, color: '#8a8177', marginTop: 2 }}>Includes 20% creator credit</div>
                  )}
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, flexShrink: 0 }}>
                  {formatCents((item.base_price_cents + item.canvas_price_cents) * item.quantity)}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #d7d0c8', borderRadius: 6, overflow: 'hidden' }}>
                  <button type="button" onClick={() => setQty(item.id, item.quantity - 1)}
                    style={{ padding: '4px 11px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 17, color: '#5f574f', fontFamily: 'inherit' }}>−</button>
                  <span style={{ padding: '4px 8px', fontSize: 14, minWidth: 22, textAlign: 'center' }}>{item.quantity}</span>
                  <button type="button" onClick={() => setQty(item.id, item.quantity + 1)}
                    style={{ padding: '4px 11px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 17, color: '#5f574f', fontFamily: 'inherit' }}>+</button>
                </div>
                <button type="button" onClick={() => remove(item.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#b0453a', textDecoration: 'underline', padding: 0, fontFamily: 'inherit' }}>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>

        {items.length > 0 && (
          <div style={{ padding: '14px 20px 20px', borderTop: '1px solid #e7e1d8', display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#5f574f' }}>
              <span>Prints subtotal</span><span>{formatCents(subtotal)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#5f574f' }}>
              <span>Shipping (Standard, 5–7 days)</span><span>{formatCents(CART_SHIPPING_CENTS)}</span>
            </div>
            {creditAvailable > 0 && (
              <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 13, color: useCredit ? '#4a7244' : '#8a8177', cursor: 'pointer' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <input
                    type="checkbox"
                    checked={useCredit}
                    onChange={e => setUseCredit(e.target.checked)}
                    style={{ width: 15, height: 15, accentColor: '#4a7244', cursor: 'pointer', margin: 0 }}
                  />
                  Use canvas credit
                </span>
                <span>{useCredit ? `−${formatCents(credit)}` : `${formatCents(creditAvailable)} available`}</span>
              </label>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 16, borderTop: '1px solid #e7e1d8', paddingTop: 10, marginTop: 2 }}>
              <span>Total</span><span>{formatCents(totalAfterCredit)}</span>
            </div>
            {error && <p style={{ margin: 0, fontSize: 12, color: '#b0453a' }}>{error}</p>}
            {!accessToken && (
              <p style={{ margin: 0, fontSize: 12, color: '#8a8177' }}>Sign in to checkout.</p>
            )}
            <button
              type="button"
              onClick={() => void handleCheckout()}
              disabled={loading || !accessToken}
              style={{ ...btn, background: '#4a7244', color: '#fff', opacity: loading || !accessToken ? 0.6 : 1, cursor: loading || !accessToken ? 'not-allowed' : 'pointer', marginTop: 4 }}
            >
              {loading ? 'Loading...' : 'Checkout'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
