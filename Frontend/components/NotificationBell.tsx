'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { listNotifications, markNotificationsRead, type Notification } from '../lib/api'

const POLL_INTERVAL_MS = 60_000

const itemStyle: CSSProperties = {
  display: 'block',
  padding: '11px 16px',
  textDecoration: 'none',
  color: '#3f382f',
  fontSize: 13.5,
  lineHeight: 1.5,
}

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function messageFor(n: Notification): string {
  const title = n.gallery_item_title ? `“${n.gallery_item_title}”` : 'your design'
  return n.type === 'sale' ? `Someone bought a print of ${title}` : `Someone liked ${title}`
}

/** Self-contained like NavAccountControls: own trigger, own dropdown, own
 *  click-outside/Escape handling. Only rendered for signed-in users. */
export function NotificationBell({ accessToken }: { accessToken?: string | null }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(() => {
    if (!accessToken) return
    listNotifications(accessToken)
      .then((res) => {
        setItems(res.items)
        setUnreadCount(res.unread_count)
      })
      .catch(() => {})
  }, [accessToken])

  useEffect(() => {
    refresh()
    if (!accessToken) return
    const interval = setInterval(refresh, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [accessToken, refresh])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  function handleToggle() {
    setOpen((wasOpen) => {
      const nextOpen = !wasOpen
      if (nextOpen && unreadCount > 0 && accessToken) {
        const unreadIds = items.filter((n) => !n.read).map((n) => n.id)
        setUnreadCount(0)
        setItems((prev) => prev.map((n) => ({ ...n, read: true })))
        markNotificationsRead(accessToken, unreadIds).catch(() => {})
      }
      return nextOpen
    })
  }

  if (!accessToken) return null

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <button
        type="button"
        aria-label="Notifications"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={handleToggle}
        style={{
          position: 'relative',
          border: '1px solid rgba(255,255,255,0.55)',
          borderRadius: '50%',
          width: 38,
          height: 38,
          padding: 0,
          background: 'rgba(255,255,255,0.12)',
          cursor: 'pointer',
          display: 'grid',
          placeItems: 'center',
          flexShrink: 0,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fffdf8" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: -4,
              right: -4,
              background: '#4a7244',
              color: '#fff',
              borderRadius: '50%',
              width: 16,
              height: 16,
              fontSize: 10,
              fontWeight: 700,
              display: 'grid',
              placeItems: 'center',
            }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: 240,
            maxHeight: 360,
            overflowY: 'auto',
            background: '#fffdf8',
            border: '1px solid #e7e1d8',
            borderRadius: 10,
            boxShadow: '0 4px 20px rgba(0,0,0,0.10)',
            zIndex: 200,
          }}
        >
          {items.length === 0 ? (
            <div style={{ padding: 16, fontSize: 13.5, color: '#8a8177', textAlign: 'center' }}>
              No notifications yet.
            </div>
          ) : (
            items.map((n, i) => (
              <Link
                key={n.id}
                href={n.gallery_item_id ? `/gallery?item=${n.gallery_item_id}` : '/gallery'}
                role="menuitem"
                onClick={() => setOpen(false)}
                style={{
                  ...itemStyle,
                  borderBottom: i < items.length - 1 ? '1px solid #f0ece5' : 'none',
                  background: n.read ? 'transparent' : '#f6f8f3',
                }}
              >
                <div>{messageFor(n)}</div>
                <div style={{ marginTop: 2, fontSize: 11.5, color: '#8a8177' }}>{timeAgo(n.created_at)}</div>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  )
}
