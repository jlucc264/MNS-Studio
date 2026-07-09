import { useState, useEffect } from 'react'

export const CART_SHIPPING_CENTS = 700
export const PRINT_OWN_BASE_CENTS = 1200
export const PRINT_GALLERY_BASE_CENTS = 1700

export interface CheckoutSummary {
  lines: { label: string; cents: number }[]
  shippingCents: number
  creditCents: number
  totalCents: number
}

export type CartItem = {
  id: string
  pdf_url: string
  internal_pdf_supabase_path: string | null
  width_inches: number
  height_inches: number
  quantity: number
  title: string
  canvas_label: string
  canvas_price_cents: number
  base_price_cents: number
  gallery_item_id: string | null        // gallery print — links to /gallery?item=<id>
  parent_gallery_item_id: string | null // own design remix (creator attribution)
  project_id: string | null             // own design — links to /studio?project=<id>
}

const CART_KEY = 'mns_cart'

export function cartRead(): CartItem[] {
  if (typeof window === 'undefined') return []
  try { return JSON.parse(localStorage.getItem(CART_KEY) ?? '[]') } catch { return [] }
}

function cartWrite(items: CartItem[]): void {
  localStorage.setItem(CART_KEY, JSON.stringify(items))
  window.dispatchEvent(new StorageEvent('storage', { key: CART_KEY }))
}

export function cartAdd(item: Omit<CartItem, 'id'>): void {
  cartWrite([...cartRead(), { ...item, id: crypto.randomUUID() }])
}

export function cartRemove(id: string): void {
  cartWrite(cartRead().filter(i => i.id !== id))
}

export function cartSetQty(id: string, qty: number): void {
  if (qty < 1) { cartRemove(id); return }
  cartWrite(cartRead().map(i => i.id === id ? { ...i, quantity: qty } : i))
}

export function cartClear(): void {
  localStorage.removeItem(CART_KEY)
  window.dispatchEvent(new StorageEvent('storage', { key: CART_KEY }))
}

export function cartSubtotal(items: CartItem[]): number {
  return items.reduce((sum, i) => sum + (i.base_price_cents + i.canvas_price_cents) * i.quantity, 0)
}

export function cartTotal(items: CartItem[]): number {
  return cartSubtotal(items) + CART_SHIPPING_CENTS
}

export function cartCount(items: CartItem[]): number {
  return items.reduce((s, i) => s + i.quantity, 0)
}

export function useCart() {
  const [items, setItems] = useState<CartItem[]>([])

  useEffect(() => {
    setItems(cartRead())
    const onStorage = (e: StorageEvent) => {
      if (e.key === CART_KEY) setItems(cartRead())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return { items, count: cartCount(items) }
}
