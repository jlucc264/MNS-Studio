'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'
import { NavAccountControls } from '../../components/NavAccountControls'
import { useAuth } from '../../components/AuthProvider'
import { getMyCreatorProfile } from '../../lib/api'

const CATEGORIES = [
  'Bug report',
  'Feature request',
  'Order / print issue',
  'Account issue',
  'Other',
]

const btnPrimary = {
  padding: '10px 22px',
  border: '1px solid #5c7856',
  borderRadius: 8,
  fontFamily: 'inherit',
  fontSize: 14,
  fontWeight: 700,
  cursor: 'pointer',
  background: '#6e8d67',
  color: '#fff',
  lineHeight: 1.3,
} as const

const labelStyle = {
  fontSize: 13,
  fontWeight: 600,
  color: '#3f382f',
  display: 'block',
  marginBottom: 6,
} as const

const inputStyle = {
  width: '100%',
  padding: '9px 12px',
  border: '1px solid #d5cec6',
  borderRadius: 8,
  fontFamily: 'inherit',
  fontSize: 14,
  color: '#3f382f',
  background: '#fff',
  boxSizing: 'border-box' as const,
  outline: 'none',
}

export default function ContactPage() {
  const router = useRouter()
  const { session, user, signOut } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [category, setCategory] = useState(CATEGORIES[0])
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setStatus('sending')
    setErrorMsg('')
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, '') ?? 'http://localhost:8000'
      const res = await fetch(`${apiBase}/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name || null, email: email || null, category, message }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { detail?: string }).detail ?? 'Something went wrong.')
      }
      setStatus('sent')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong.')
      setStatus('error')
    }
  }

  async function handleViewProfile() {
    if (!session?.access_token) return
    try {
      const profile = await getMyCreatorProfile(session.access_token)
      router.push(profile.slug ? `/gallery/${profile.slug}` : '/gallery')
    } catch {
      router.push('/gallery')
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f5f1ea' }}>
      <nav
        style={{
          height: 70,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 28px',
          borderBottom: '1px solid #5c7856',
          background: '#6e8d67',
          boxSizing: 'border-box',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <Link href="/gallery" style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', flexShrink: 0 }}>
            <div aria-hidden="true" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 9px)', gap: 3, padding: 2 }}>
              {Array.from({ length: 9 }, (_, i) => (
                <span key={i} style={{ width: 9, height: 9, border: '2px solid #fffdf8', borderRadius: 2, boxSizing: 'border-box' }} />
              ))}
            </div>
            <strong style={{ fontSize: 22, color: '#fffdf8' }}>MNS Studio</strong>
          </Link>
          <span style={{ color: 'rgba(255,255,255,0.5)', margin: '0 6px' }}>|</span>
          <div style={{ display: 'flex', gap: 24, color: '#fffdf8', fontWeight: 600, whiteSpace: 'nowrap' }}>
            <Link href="/gallery" style={{ color: 'rgba(255,255,255,0.86)', textDecoration: 'none' }}>Gallery</Link>
            <Link href="/drafts" style={{ color: 'rgba(255,255,255,0.86)', textDecoration: 'none' }}>Your Studio</Link>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ color: '#fffdf8', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap' }}>Contact Us</span>
          {session && (
            <NavAccountControls
              user={user}
              onProfile={() => void handleViewProfile()}
              onLogout={() => { void signOut() }}
              onStudio={() => router.push('/studio')}
            />
          )}
        </div>
      </nav>

      <main style={{ maxWidth: 560, margin: '0 auto', padding: '48px 24px 80px' }}>
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ margin: '0 0 8px', fontSize: 28, color: '#3f382f' }}>Contact Us</h1>
          <p style={{ margin: 0, fontSize: 14, color: '#7f776d', lineHeight: 1.6 }}>
            Found a bug, have a request, or just want to say hi? We&apos;ll get back to you as soon as we can.
          </p>
        </div>

        {status === 'sent' ? (
          <div
            style={{
              background: '#edf3ec',
              border: '1px solid #b8d4b4',
              borderRadius: 10,
              padding: '24px 20px',
              display: 'grid',
              gap: 12,
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 700, color: '#3f6b38' }}>Message sent!</div>
            <p style={{ margin: 0, fontSize: 14, color: '#5f574e', lineHeight: 1.6 }}>
              Thanks for reaching out. We&apos;ll get back to you soon.
            </p>
            <button
              type="button"
              onClick={() => { setStatus('idle'); setMessage('') }}
              style={{ justifySelf: 'start', border: 0, background: 'transparent', font: 'inherit', fontSize: 13, color: '#7f776d', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
            >
              Send another message
            </button>
          </div>
        ) : (
          <form
            onSubmit={(e) => { void handleSubmit(e) }}
            style={{
              background: '#fffdf8',
              border: '1px solid #e4ddd5',
              borderRadius: 12,
              padding: '28px 24px',
              display: 'grid',
              gap: 20,
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <label htmlFor="contact-name" style={labelStyle}>Name</label>
                <input
                  id="contact-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  style={inputStyle}
                  autoComplete="name"
                />
              </div>
              <div>
                <label htmlFor="contact-email" style={labelStyle}>Email</label>
                <input
                  id="contact-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="reply@example.com"
                  style={inputStyle}
                  autoComplete="email"
                />
              </div>
            </div>

            <div>
              <label htmlFor="contact-category" style={labelStyle}>Category</label>
              <select
                id="contact-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                style={{ ...inputStyle, appearance: 'auto' }}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="contact-message" style={labelStyle}>
                Message <span style={{ color: '#b04040' }}>*</span>
              </label>
              <textarea
                id="contact-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Describe the issue or request in as much detail as you can…"
                required
                rows={6}
                style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }}
              />
            </div>

            {status === 'error' && (
              <div style={{ fontSize: 13, color: '#b04040', background: '#fdf0ef', border: '1px solid #e8b4b0', borderRadius: 8, padding: '10px 14px' }}>
                {errorMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={status === 'sending'}
              style={{ ...btnPrimary, opacity: status === 'sending' ? 0.6 : 1, cursor: status === 'sending' ? 'default' : 'pointer' }}
            >
              {status === 'sending' ? 'Sending…' : 'Send message'}
            </button>
          </form>
        )}
      </main>
    </div>
  )
}
