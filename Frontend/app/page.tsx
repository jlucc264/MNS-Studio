'use client'

import Link from 'next/link'
import { FormEvent, useState } from 'react'
import { useAuth } from '../components/AuthProvider'

export default function HomePage() {
  const { signIn, signUp, configured } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (!email.trim() || !password.trim()) {
      setError('Please enter your email and password.')
      return
    }
    setLoading(true)
    try {
      if (mode === 'login') {
        await signIn(email, password)
      } else {
        await signUp(email, password)
      }
      window.location.href = '/drafts'
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.')
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        gridTemplateRows: '72px 1fr',
        background: '#f5f1ea',
        fontFamily: 'Georgia, "Times New Roman", serif',
        color: '#3f382f',
      }}
    >
      {/* Nav */}
      <nav
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 32px',
          borderBottom: '1px solid #e7e1d8',
          background: '#fffdf8',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            aria-hidden="true"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 9px)', gap: 3, padding: 2 }}
          >
            {Array.from({ length: 9 }, (_, i) => (
              <span
                key={i}
                style={{
                  width: 9,
                  height: 9,
                  border: '2px solid #111',
                  borderRadius: 2,
                  boxSizing: 'border-box',
                }}
              />
            ))}
          </div>
          <strong style={{ fontSize: 22, color: '#111' }}>MNS Studio</strong>
        </div>
        <Link
          href="/studio"
          style={{
            fontSize: 14,
            color: '#7f776d',
            textDecoration: 'none',
            padding: '6px 14px',
            border: '1px solid #d7d0c8',
            borderRadius: 8,
            background: '#fff',
          }}
        >
          Continue as guest
        </Link>
      </nav>

      {/* Main */}
      <div
        style={{
          display: 'grid',
          placeItems: 'center',
          padding: '32px 16px',
        }}
      >
        <div
          style={{
            display: 'grid',
            gap: 32,
            width: '100%',
            maxWidth: 420,
          }}
        >
          {/* Hero */}
          <div style={{ display: 'grid', gap: 10, textAlign: 'center' }}>
            <h1 style={{ margin: 0, fontSize: 32, fontWeight: 700, letterSpacing: '-0.5px' }}>
              Welcome back
            </h1>
            <p style={{ margin: 0, fontSize: 15, color: '#7f776d', lineHeight: 1.5 }}>
              Sign in to access your saved needlepoint designs and continue where you left off.
            </p>
          </div>

          {/* Card */}
          <div
            style={{
              background: '#fff',
              border: '1px solid #e7e1d8',
              borderRadius: 16,
              padding: '28px 28px 24px',
              boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
              display: 'grid',
              gap: 20,
            }}
          >
            {/* Mode toggle */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 3,
                padding: 3,
                background: '#f0ece5',
                border: '1px solid #d7d0c8',
                borderRadius: 10,
              }}
            >
              {(['login', 'signup'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setMode(m); setError('') }}
                  style={{
                    padding: '7px',
                    border: 'none',
                    borderRadius: 7,
                    fontFamily: 'inherit',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    background: mode === m ? '#fff' : 'transparent',
                    color: mode === m ? '#3f382f' : '#8a8177',
                    boxShadow: mode === m ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
                  }}
                >
                  {m === 'login' ? 'Sign in' : 'Create account'}
                </button>
              ))}
            </div>

            {!configured && (
              <p style={{ margin: 0, fontSize: 13, color: '#b0453a' }}>
                Supabase Auth is not configured yet.
              </p>
            )}

            <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 14 }}>
              <label style={{ display: 'grid', gap: 5, fontSize: 13 }}>
                <span style={{ fontWeight: 600, color: '#5a5348' }}>Email</span>
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  style={{
                    padding: '10px 12px',
                    border: '1px solid #d7d0c8',
                    borderRadius: 8,
                    fontFamily: 'inherit',
                    fontSize: 14,
                    background: '#fafaf8',
                    outline: 'none',
                  }}
                />
              </label>

              <label style={{ display: 'grid', gap: 5, fontSize: 13 }}>
                <span style={{ fontWeight: 600, color: '#5a5348' }}>Password</span>
                <input
                  type="password"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  style={{
                    padding: '10px 12px',
                    border: '1px solid #d7d0c8',
                    borderRadius: 8,
                    fontFamily: 'inherit',
                    fontSize: 14,
                    background: '#fafaf8',
                    outline: 'none',
                  }}
                />
              </label>

              {error && (
                <p style={{ margin: 0, fontSize: 13, color: '#b0453a' }}>{error}</p>
              )}

              <button
                type="submit"
                disabled={loading || !configured}
                style={{
                  padding: '11px',
                  border: 'none',
                  borderRadius: 8,
                  fontFamily: 'inherit',
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: loading ? 'default' : 'pointer',
                  background: loading ? '#a8be9e' : '#6e8d67',
                  color: '#fff',
                  marginTop: 4,
                }}
              >
                {loading ? 'Signing in…' : mode === 'login' ? 'Sign in' : 'Create account'}
              </button>
            </form>

            {mode === 'login' && (
              <p style={{ margin: 0, fontSize: 12, color: '#8a8177', textAlign: 'center' }}>
                Forgot your password?{' '}
                <button
                  type="button"
                  style={{
                    border: 0,
                    background: 'transparent',
                    font: 'inherit',
                    fontSize: 12,
                    color: '#6e8d67',
                    cursor: 'pointer',
                    padding: 0,
                    textDecoration: 'underline',
                  }}
                >
                  Reset it
                </button>
              </p>
            )}
          </div>

          {/* Divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1, height: 1, background: '#e7e1d8' }} />
            <span style={{ fontSize: 12, color: '#a09890' }}>or</span>
            <div style={{ flex: 1, height: 1, background: '#e7e1d8' }} />
          </div>

          {/* Guest CTA */}
          <div style={{ display: 'grid', gap: 10, textAlign: 'center' }}>
            <Link
              href="/studio"
              style={{
                display: 'block',
                padding: '11px',
                border: '1px solid #d7d0c8',
                borderRadius: 8,
                background: '#fff',
                fontFamily: 'inherit',
                fontSize: 14,
                fontWeight: 600,
                color: '#3f382f',
                textDecoration: 'none',
                textAlign: 'center',
              }}
            >
              Start designing without an account
            </Link>
            <p style={{ margin: 0, fontSize: 12, color: '#a09890' }}>
              Guest designs aren&apos;t saved between sessions.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
