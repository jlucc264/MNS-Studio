'use client'

import { type FormEvent, useEffect, useState } from 'react'
import { useAuth } from './AuthProvider'
import { updateMyCreatorName, getMySignature, saveMySignature } from '../lib/api'
import { useIsTouch } from '../lib/useViewport'
import { SignaturePad } from './SignaturePad'

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box' as const,
  border: '1px solid #d7d0c8',
  borderRadius: 8,
  padding: '11px 12px',
  fontFamily: 'inherit',
  fontSize: 14,
  color: '#3f382f',
  background: '#fffdf8',
}

const btnPrimary = {
  padding: '10px 20px',
  borderRadius: 8,
  border: '1px solid #5c7856',
  background: '#6e8d67',
  color: '#fff',
  fontFamily: 'inherit',
  fontSize: 14,
  fontWeight: 700,
  cursor: 'pointer',
} as const

const btnSecondary = {
  padding: '9px 18px',
  border: '1px solid #d7d0c8',
  borderRadius: 8,
  fontFamily: 'inherit',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  background: '#fff',
  color: '#3f382f',
} as const

export function ProfileModal({ onClose }: { onClose: () => void }) {
  const { user, session, updateProfile } = useAuth()
  const isTouch = useIsTouch()
  const currentName = (user?.user_metadata?.full_name as string | undefined) ?? ''
  const [name, setName] = useState(currentName)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const [signatureUrl, setSignatureUrl] = useState<string | null>(null)
  const [savingSignature, setSavingSignature] = useState(false)
  const [signatureError, setSignatureError] = useState('')
  const [redrawingSignature, setRedrawingSignature] = useState(false)

  useEffect(() => {
    if (!session?.access_token) return
    getMySignature(session.access_token)
      .then((res) => setSignatureUrl(res.image_url))
      .catch(() => {})
  }, [session?.access_token])

  async function handleSaveSignature(blob: Blob) {
    if (!session?.access_token) return
    setSavingSignature(true)
    setSignatureError('')
    try {
      const res = await saveMySignature(blob, session.access_token)
      setSignatureUrl(res.image_url)
      setRedrawingSignature(false)
    } catch (err) {
      setSignatureError(err instanceof Error ? err.message : 'Could not save signature.')
    } finally {
      setSavingSignature(false)
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const trimmedName = name.trim()
      await updateProfile({ full_name: trimmedName || undefined })
      // Keep the gallery creator name in sync (no-op if nothing published yet)
      if (trimmedName && session?.access_token) {
        await updateMyCreatorName(trimmedName, session.access_token).catch(() => {})
      }
      setSaved(true)
      setTimeout(onClose, 800)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update profile.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 60,
        padding: 18,
      }}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          padding: 24,
          borderRadius: 12,
          width: 'min(400px, 100%)',
          display: 'grid',
          gap: 16,
          boxSizing: 'border-box',
          boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
        }}
      >
        <div style={{ display: 'grid', gap: 4 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>Edit profile</h2>
          <p style={{ margin: 0, color: '#8a8177', fontSize: 13 }}>
            {user?.email}
          </p>
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#3f382f' }}>Display name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setSaved(false) }}
            placeholder="Your name"
            autoComplete="name"
            autoFocus={!isTouch}
            style={inputStyle}
          />
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#3f382f' }}>Signature</label>
          <p style={{ margin: 0, fontSize: 12, color: '#8a8177' }}>
            Printed in the corner of every canvas you finalize.
          </p>
          {signatureUrl && !redrawingSignature ? (
            <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={signatureUrl}
                alt="Your signature"
                style={{ maxWidth: 200, maxHeight: 100, border: '1px solid #d7d0c8', borderRadius: 8, background: '#fffdf8' }}
              />
              <button type="button" onClick={() => setRedrawingSignature(true)} style={btnSecondary}>
                Redraw
              </button>
            </div>
          ) : (
            <SignaturePad onSave={handleSaveSignature} saving={savingSignature} />
          )}
          {signatureError && <p style={{ margin: 0, fontSize: 13, color: '#b0453a' }}>{signatureError}</p>}
        </div>
        {error && <p style={{ margin: 0, fontSize: 13, color: '#b0453a' }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={btnSecondary}>Cancel</button>
          <button type="submit" disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.65 : 1 }}>
            {saved ? 'Saved ✓' : saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}
