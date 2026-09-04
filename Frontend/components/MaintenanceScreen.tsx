'use client'

import Link from 'next/link'
import { type CSSProperties } from 'react'
import { DEFAULT_SUSPENSION_MESSAGE } from '../lib/siteStatus'

const wrap: CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '32px 20px',
  background: '#faf7f3',
  color: '#3f382f',
}

const card: CSSProperties = {
  maxWidth: 520,
  width: '100%',
  background: '#fff',
  border: '1px solid #e4ddd5',
  borderRadius: 16,
  padding: '36px 32px',
  textAlign: 'center',
}

/**
 * Full-page notice for a publicly suspended surface.
 *
 * Says what is unavailable and that saved work is safe, and nothing more. It
 * deliberately does not mention the review's subject or characterize any
 * listing — this page is public, indexable, and quotable.
 *
 * The way out points at /drafts rather than /studio. Both are "the studio" in
 * the nav's language, but /studio opens an empty canvas while /drafts is the
 * work someone already has — which is what the line underneath promises, and
 * the more useful place to land when the page you wanted is closed.
 */
export default function MaintenanceScreen({
  title = 'Under maintenance',
  message = DEFAULT_SUSPENSION_MESSAGE,
  showStudioLink = true,
}: {
  title?: string
  message?: string
  showStudioLink?: boolean
}) {
  return (
    <div style={wrap}>
      <div style={card}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 1.4,
            textTransform: 'uppercase',
            color: '#8a8177',
          }}
        >
          MNS Studio
        </div>
        <h1 style={{ margin: '10px 0 0', fontSize: 26, lineHeight: 1.25 }}>{title}</h1>
        <p style={{ margin: '14px 0 0', fontSize: 15, lineHeight: 1.6, color: '#6f675f' }}>{message}</p>

        {showStudioLink && (
          <div style={{ marginTop: 26 }}>
            <Link
              href="/drafts"
              style={{
                display: 'inline-block',
                background: '#6e8d67',
                color: '#fff',
                textDecoration: 'none',
                padding: '11px 22px',
                borderRadius: 10,
                fontSize: 15,
                fontWeight: 600,
              }}
            >
              Go to Studio
            </Link>
            <div style={{ marginTop: 10, fontSize: 13, color: '#8a8177' }}>
              Your saved designs and drafts are still there, and you can start a new one.
            </div>
          </div>
        )}

        <div style={{ marginTop: 26, fontSize: 13, color: '#8a8177' }}>
          Questions? <Link href="/contact" style={{ color: '#6e8d67' }}>Get in touch</Link>.
        </div>
      </div>
    </div>
  )
}

/** Inline variant for a suspended control inside an otherwise working page. */
export function MaintenanceNote({ message = DEFAULT_SUSPENSION_MESSAGE }: { message?: string }) {
  return (
    <div
      style={{
        background: '#fbf3e8',
        border: '1px solid #ead9c2',
        borderRadius: 10,
        padding: '12px 14px',
        fontSize: 13,
        lineHeight: 1.55,
        color: '#8a5a28',
      }}
    >
      {message}
    </div>
  )
}
