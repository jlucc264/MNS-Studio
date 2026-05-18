'use client'

import { useState, type FormEvent } from 'react'
import { useAuth } from './AuthProvider'

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

export function AuthPanel({ title = 'Log in to Create/View Templates', onSuccess }: { title?: string; onSuccess?: () => void }) {
  const { signIn, signUp, sendPasswordReset, configured } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [mode, setMode] = useState<'login' | 'signup' | 'reset'>('login')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setMessage('')
    try {
      if (mode === 'reset') {
        await sendPasswordReset(email)
        setMessage('Password reset email sent. Check your inbox.')
      } else if (mode === 'login') {
        await signIn(email, password)
        onSuccess?.()
      } else {
        await signUp(email, password, name)
        onSuccess?.()
        setMessage('Account created. Check your email if confirmation is enabled.')
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Authentication failed.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!configured) {
    return (
      <div style={{ background: '#fff', border: '1px solid #e7e1d8', borderRadius: 12, padding: 24 }}>
        <h1 style={{ margin: '0 0 8px', fontSize: 24 }}>Auth is not configured</h1>
        <p style={{ margin: 0, color: '#8a8177', fontSize: 14 }}>
          Add your Supabase URL and anon key to the frontend environment to enable draft access.
        </p>
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: 'grid',
        gap: 14,
        maxWidth: 420,
        background: '#fff',
        border: '1px solid #e7e1d8',
        borderRadius: 12,
        padding: 24,
        boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
      }}
    >
      <div>
        <h1 style={{ margin: '0 0 6px', fontSize: 24 }}>{title}</h1>
        <p style={{ margin: 0, color: '#8a8177', fontSize: 14 }}>
          Save and access projects with your MNS Studio account.
        </p>
      </div>
      {mode === 'signup' && (
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Display name"
          autoComplete="name"
          style={inputStyle}
        />
      )}
      <input
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="Email"
        autoComplete="email"
        required
        style={inputStyle}
      />
      <input
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        placeholder="Password"
        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        required={mode !== 'reset'}
        minLength={6}
        style={{ ...inputStyle, display: mode === 'reset' ? 'none' : 'block' }}
      />
      <button type="submit" disabled={submitting} style={{ ...buttonStyle, opacity: submitting ? 0.65 : 1 }}>
        {submitting ? 'Working...' : mode === 'reset' ? 'Send reset link' : mode === 'login' ? 'Log in' : 'Create account'}
      </button>
      <button
        type="button"
        onClick={() => {
          setMode(mode === 'login' ? 'signup' : 'login')
          setMessage('')
        }}
        style={{
          border: 0,
          background: 'transparent',
          color: '#6e8d67',
          fontFamily: 'inherit',
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        {mode === 'login' ? 'Create an account' : 'Log in instead'}
      </button>
      {mode === 'login' && (
        <button
          type="button"
          onClick={() => {
            setMode('reset')
            setMessage('')
          }}
          style={{
            border: 0,
            background: 'transparent',
            color: '#7f776d',
            fontFamily: 'inherit',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Reset password
        </button>
      )}
      {message && (
        <p style={{ margin: 0, fontSize: 13, color: message.includes('sent') || message.includes('created') ? '#5c7856' : '#b0453a' }}>
          {message}
        </p>
      )}
    </form>
  )
}
