'use client'

import { useEffect, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { UserAvatar } from './UserAvatar'

const ADMIN_USER_ID = process.env.NEXT_PUBLIC_ADMIN_USER_ID ?? ''

export function NavAccountControls({
  user,
  onProfile,
  onLogout,
  onStudio,
  onAdmin,
}: {
  user?: User | null
  onProfile: () => void
  onLogout: () => void
  onStudio?: () => void
  onAdmin?: () => void
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

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <button
        type="button"
        aria-label="Account menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer', display: 'block' }}
      >
        <UserAvatar user={user} />
      </button>

      {open && (
        <div
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
          {onStudio && (
            <>
              <button
                type="button"
                onClick={() => { setOpen(false); onStudio() }}
                style={{
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
                }}
              >
                Go to Studio
              </button>
              <div style={{ height: 1, background: '#f0ece5', margin: '0 12px' }} />
            </>
          )}
          <button
            type="button"
            onClick={() => { setOpen(false); onProfile() }}
            style={{
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
            }}
          >
            View profile
          </button>
          {onAdmin && ADMIN_USER_ID && user?.id === ADMIN_USER_ID && (
            <>
              <div style={{ height: 1, background: '#f0ece5', margin: '0 12px' }} />
              <button
                type="button"
                onClick={() => { setOpen(false); onAdmin() }}
                style={{
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
                }}
              >
                Roll Print
              </button>
            </>
          )}
          <div style={{ height: 1, background: '#f0ece5', margin: '0 12px' }} />
          <button
            type="button"
            onClick={() => { setOpen(false); onLogout() }}
            style={{
              display: 'block',
              width: '100%',
              padding: '11px 16px',
              border: 0,
              background: 'transparent',
              font: 'inherit',
              fontSize: 14,
              textAlign: 'left',
              cursor: 'pointer',
              color: '#b04030',
            }}
          >
            Log out
          </button>
        </div>
      )}
    </div>
  )
}
