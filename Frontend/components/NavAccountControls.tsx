'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { User } from '@supabase/supabase-js'
import { UserAvatar } from './UserAvatar'
import { formatCents } from '../lib/api'

const ADMIN_USER_ID = process.env.NEXT_PUBLIC_ADMIN_USER_ID ?? ''

const itemStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '11px 16px',
  border: 0,
  background: 'transparent',
  font: 'inherit',
  fontSize: 14,
  textAlign: 'left',
  cursor: 'pointer',
  color: '#3f382f',
  textDecoration: 'none',
  boxSizing: 'border-box',
}

function Divider() {
  return <div style={{ height: 1, background: '#f0ece5', margin: '0 12px' }} />
}

/** Trigger shown when nobody is signed in. Deliberately not a UserAvatar —
 *  that falls back to "MS" initials with no user, which reads as a signed-in
 *  account that isn't yours. */
function MenuIcon() {
  return (
    <div
      aria-hidden="true"
      style={{
        width: 38,
        height: 38,
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
        gap: 4,
        border: '1px solid rgba(255,255,255,0.55)',
        background: 'rgba(255,255,255,0.12)',
        flex: '0 0 auto',
      }}
    >
      {[0, 1, 2].map((i) => (
        <span key={i} style={{ display: 'block', width: 15, height: 2, borderRadius: 1, background: '#fffdf8' }} />
      ))}
    </div>
  )
}

export function NavAccountControls({
  user,
  onProfile,
  onLogout,
  onStudio,
  onAdmin,
  onNavigate,
  onLogin,
  pendingCents,
}: {
  user?: User | null
  onProfile?: () => void
  onLogout?: () => void
  onStudio?: () => void
  onAdmin?: () => void
  /** Signed-out only. Lets callers fold their own "Log in" trigger (auth
   *  modal, redirect, etc.) into this menu instead of a separate header
   *  button competing for space next to it. */
  onLogin?: () => void
  /** Route the public links through the page's own navigation instead of a
   *  plain <Link>. The studio needs this: leaving with unsaved work has to go
   *  through its confirm modal, and a Link would slip straight past it. */
  onNavigate?: (href: string) => void
  pendingCents?: number | null
}) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Close on Escape — the menu is now reachable signed-out, so it's the first
  // thing many visitors open, and trapping them in it is worse than it was.
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  const signedIn = !!user

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <button
        type="button"
        aria-label={signedIn ? 'Account menu' : 'Menu'}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
        style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer', display: 'block' }}
      >
        {signedIn ? <UserAvatar user={user} /> : <MenuIcon />}
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            minWidth: 168,
            background: '#fffdf8',
            border: '1px solid #e7e1d8',
            borderRadius: 10,
            boxShadow: '0 4px 20px rgba(0,0,0,0.10)',
            overflow: 'hidden',
            zIndex: 200,
          }}
        >
          {!signedIn && onLogin && (
            <>
              <button type="button" role="menuitem" onClick={() => { setOpen(false); onLogin() }} style={{ ...itemStyle, fontWeight: 700, color: '#4a7244' }}>
                Log in
              </button>
              <Divider />
            </>
          )}

          {signedIn && pendingCents !== null && pendingCents !== undefined && pendingCents > 0 && (
            <>
              <div
                title="Canvas credit available"
                style={{ padding: '11px 16px', fontSize: 13, fontWeight: 600, color: '#4a7244', whiteSpace: 'nowrap' }}
              >
                🌿 {formatCents(pendingCents)} credit
              </div>
              <Divider />
            </>
          )}

          {signedIn && onStudio && (
            <>
              <button type="button" role="menuitem" onClick={() => { setOpen(false); onStudio() }} style={itemStyle}>
                Go to Studio
              </button>
              <Divider />
            </>
          )}

          {signedIn && onProfile && (
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onProfile() }} style={itemStyle}>
              View profile
            </button>
          )}

          {signedIn && onAdmin && ADMIN_USER_ID && user?.id === ADMIN_USER_ID && (
            <>
              <Divider />
              <button type="button" role="menuitem" onClick={() => { setOpen(false); onAdmin() }} style={itemStyle}>
                Roll Print
              </button>
            </>
          )}

          {signedIn && <Divider />}

          {/* Public pages. These live here rather than in the nav bar so the
              header stays uncluttered on phones and tablets, and they sit
              outside the signed-in block so logged-out visitors — the people
              About is actually written for — can still reach them. */}
          {([['/tips', 'Tips & Tricks'], ['/about', 'About Us'], ['/contact', 'Contact Us']] as const).map(([href, label]) =>
            onNavigate ? (
              <button
                key={href}
                type="button"
                role="menuitem"
                onClick={() => { setOpen(false); onNavigate(href) }}
                style={itemStyle}
              >
                {label}
              </button>
            ) : (
              <Link key={href} href={href} role="menuitem" onClick={() => setOpen(false)} style={itemStyle}>
                {label}
              </Link>
            ),
          )}

          {signedIn && onLogout && (
            <>
              <Divider />
              <button
                type="button"
                role="menuitem"
                onClick={() => { setOpen(false); onLogout() }}
                style={{ ...itemStyle, color: '#b04030' }}
              >
                Log out
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
