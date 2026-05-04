'use client'

import Link from 'next/link'
import { FormEvent, useState } from 'react'
import { useAuth } from '../../components/AuthProvider'

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  border: '1px solid #d7d0c8',
  borderRadius: 8,
  padding: '11px 12px',
  fontFamily: 'inherit',
  fontSize: 14,
  color: '#3f382f',
  background: '#fffdf8',
} as const

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

export default function ResetPasswordPage() {
  const { updatePassword, configured } = useAuth()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [done, setDone] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage('')

    if (password.length < 6) {
      setMessage('Password must be at least 6 characters.')
      return
    }
    if (password !== confirmPassword) {
      setMessage('Passwords do not match.')
      return
    }

    setSubmitting(true)
    try {
      await updatePassword(password)
      setDone(true)
      setMessage('Password updated.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not update password.')
    } finally {
      setSubmitting(false)
    }
  }

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
      <form
        onSubmit={handleSubmit}
        style={{
          display: 'grid',
          gap: 14,
          width: 'min(420px, 100%)',
          background: '#fff',
          border: '1px solid #e7e1d8',
          borderRadius: 12,
          padding: 24,
          boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
        }}
      >
        <div>
          <h1 style={{ margin: '0 0 6px', fontSize: 24 }}>Reset password</h1>
          <p style={{ margin: 0, color: '#8a8177', fontSize: 14 }}>
            Enter a new password for your MNS Studio account.
          </p>
        </div>
        {!configured ? (
          <p style={{ margin: 0, color: '#b0453a', fontSize: 13 }}>Supabase Auth is not configured.</p>
        ) : done ? (
          <Link href="/gallery" style={{ ...buttonStyle, textAlign: 'center', textDecoration: 'none' }}>
            Back to gallery
          </Link>
        ) : (
          <>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="New password"
              autoComplete="new-password"
              required
              minLength={6}
              style={inputStyle}
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Confirm password"
              autoComplete="new-password"
              required
              minLength={6}
              style={inputStyle}
            />
            <button type="submit" disabled={submitting} style={{ ...buttonStyle, opacity: submitting ? 0.65 : 1 }}>
              {submitting ? 'Updating...' : 'Update password'}
            </button>
          </>
        )}
        {message && (
          <p style={{ margin: 0, fontSize: 13, color: done ? '#5c7856' : '#b0453a' }}>
            {message}
          </p>
        )}
      </form>
    </main>
  )
}
