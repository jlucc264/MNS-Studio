'use client'

import Link from 'next/link'
import { useAuth } from '../../components/AuthProvider'

const buttonStyle = {
  border: 0,
  borderRadius: 8,
  padding: '11px 14px',
  fontFamily: 'inherit',
  fontSize: 14,
  fontWeight: 700,
  cursor: 'pointer',
  background: '#6e8d67',
  color: '#fff',
} as const

export default function AuthConfirmedPage() {
  const { session } = useAuth()

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 18,
        background: '#f5f1ea',
        color: '#3f382f',
      }}
    >
      <section
        style={{
          display: 'grid',
          gap: 14,
          width: 'min(440px, 100%)',
          background: '#fff',
          border: '1px solid #e7e1d8',
          borderRadius: 12,
          padding: 24,
          boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
        }}
      >
        <div>
          <h1 style={{ margin: '0 0 6px', fontSize: 24 }}>Email confirmed</h1>
          <p style={{ margin: 0, color: '#8a8177', fontSize: 14, lineHeight: 1.45 }}>
            Your MNS Studio account is ready. You can now save drafts, finalize designs, and post to the gallery.
          </p>
        </div>
        <Link href={session ? '/studio' : '/gallery'} style={{ ...buttonStyle, textAlign: 'center', textDecoration: 'none' }}>
          {session ? 'Go to active canvas' : 'Go to gallery'}
        </Link>
      </section>
    </main>
  )
}
