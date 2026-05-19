'use client'

import Link from 'next/link'
import { type FormEvent, useState } from 'react'

const CONTACT_EMAIL = 'john@mns.studio'

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
  boxSizing: 'border-box',
  outline: 'none',
} as const

export default function ContactPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [category, setCategory] = useState(CATEGORIES[0])
  const [message, setMessage] = useState('')
  const [sent, setSent] = useState(false)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const subject = encodeURIComponent(`[MNS Studio] ${category}${name ? ` — ${name}` : ''}`)
    const body = encodeURIComponent(
      [
        name ? `From: ${name}` : '',
        email ? `Reply-to: ${email}` : '',
        `Category: ${category}`,
        '',
        message,
      ]
        .filter((line) => line !== undefined)
        .join('\n')
    )
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`
    setSent(true)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f5f1ea' }}>
      <nav
        style={{
          height: 64,
          display: 'flex',
          alignItems: 'center',
          padding: '0 24px',
          borderBottom: '1px solid #e7e1d8',
          background: '#fffdf8',
          boxSizing: 'border-box',
          gap: 16,
        }}
      >
        <Link href="/gallery" style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', flexShrink: 0 }}>
          <div aria-hidden="true" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 9px)', gap: 3, padding: 2 }}>
            {Array.from({ length: 9 }, (_, i) => (
              <span key={i} style={{ width: 9, height: 9, border: '2px solid #111', borderRadius: 2, boxSizing: 'border-box' }} />
            ))}
          </div>
          <strong style={{ fontSize: 20, color: '#111' }}>MNS Studio</strong>
        </Link>
      </nav>

      <main style={{ maxWidth: 560, margin: '0 auto', padding: '48px 24px 80px' }}>
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ margin: '0 0 8px', fontSize: 28, color: '#3f382f' }}>Contact Us</h1>
          <p style={{ margin: 0, fontSize: 14, color: '#7f776d', lineHeight: 1.6 }}>
            Found a bug, have a request, or just want to say hi? Fill out the form below and it will open in your email client, pre-addressed to us.
          </p>
        </div>

        {sent ? (
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
            <div style={{ fontSize: 18, fontWeight: 700, color: '#3f6b38' }}>Your email client should have opened.</div>
            <p style={{ margin: 0, fontSize: 14, color: '#5f574e', lineHeight: 1.6 }}>
              If it didn&apos;t, you can email us directly at{' '}
              <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: '#4a7244', fontWeight: 600 }}>
                {CONTACT_EMAIL}
              </a>
              .
            </p>
            <button
              type="button"
              onClick={() => setSent(false)}
              style={{ justifySelf: 'start', border: 0, background: 'transparent', font: 'inherit', fontSize: 13, color: '#7f776d', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
            >
              Send another message
            </button>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
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

            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <button type="submit" style={btnPrimary}>
                Open email client →
              </button>
              <span style={{ fontSize: 12, color: '#8a8177', lineHeight: 1.5 }}>
                This will open your mail app pre-addressed to {CONTACT_EMAIL}
              </span>
            </div>
          </form>
        )}
      </main>
    </div>
  )
}
