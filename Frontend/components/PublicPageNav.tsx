'use client'

import Link from 'next/link'
import type { User } from '@supabase/supabase-js'
import { BREAKPOINTS, useIsMobile } from '../lib/useViewport'
import { NavAccountControls } from './NavAccountControls'

/** Shared header for the static content pages (About, Tips, Contact, ...).
 *  Mirrors the gallery nav's mobile handling — the "Gallery | Your Studio"
 *  links and any page label collapse away below `tablet` width instead of
 *  overflowing a fixed-height bar, and the bar stays pinned via `sticky` so
 *  it doesn't scroll out of view the way a static one does. */
export function PublicPageNav({
  user,
  label,
  extraLink,
  onProfile,
  onLogout,
  onStudio,
  onLogin,
}: {
  user?: User | null
  label?: string
  /** A cross-link to a sibling page (e.g. Terms ↔ Privacy). Hidden on mobile
   *  like `label` — safe as long as the page body also links to it, which
   *  both legal pages already do. */
  extraLink?: { href: string; label: string }
  onProfile: () => void
  onLogout: () => void
  onStudio: () => void
  onLogin?: () => void
}) {
  const isMobile = useIsMobile(BREAKPOINTS.tablet)

  return (
    <nav
      style={{
        height: 70,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: isMobile ? '0 14px' : '0 28px',
        borderBottom: '1px solid #5c7856',
        background: '#6e8d67',
        boxSizing: 'border-box',
        position: 'sticky',
        top: 0,
        zIndex: 50,
        gap: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 12, minWidth: 0 }}>
        <Link href="/gallery" style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', flexShrink: 0 }}>
          <div aria-hidden="true" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 9px)', gap: 3, padding: 2 }}>
            {Array.from({ length: 9 }, (_, i) => (
              <span key={i} style={{ width: 9, height: 9, border: '2px solid #fffdf8', borderRadius: 2, boxSizing: 'border-box' }} />
            ))}
          </div>
          <strong style={{ fontSize: 22, color: '#fffdf8' }}>MNS Studio</strong>
        </Link>
        {!isMobile && (
          <>
            <span style={{ color: 'rgba(255,255,255,0.5)', margin: '0 6px' }}>|</span>
            <div style={{ display: 'flex', gap: 24, color: '#fffdf8', fontWeight: 600, whiteSpace: 'nowrap' }}>
              <Link href="/gallery" style={{ color: 'rgba(255,255,255,0.86)', textDecoration: 'none' }}>Gallery</Link>
              <Link href="/drafts" style={{ color: 'rgba(255,255,255,0.86)', textDecoration: 'none' }}>Your Studio</Link>
            </div>
          </>
        )}
      </div>
      <div style={{ display: 'flex', gap: isMobile ? 8 : 12, alignItems: 'center', fontSize: 13, fontWeight: 600 }}>
        {label && !isMobile && (
          <span style={{ color: '#fffdf8', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap' }}>{label}</span>
        )}
        {extraLink && !isMobile && (
          <Link href={extraLink.href} style={{ color: 'rgba(255,255,255,0.86)', textDecoration: 'none', whiteSpace: 'nowrap' }}>
            {extraLink.label}
          </Link>
        )}
        <NavAccountControls
          user={user}
          onProfile={onProfile}
          onLogout={onLogout}
          onStudio={onStudio}
          onLogin={isMobile ? onLogin : undefined}
        />
      </div>
    </nav>
  )
}
