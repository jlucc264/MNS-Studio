'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { type CSSProperties, type FormEvent, useEffect, useState } from 'react'
import { useAuth } from '../../../components/AuthProvider'
import CheckoutModal from '../../../components/CheckoutModal'
import { NavAccountControls } from '../../../components/NavAccountControls'
import { SignaturePad } from '../../../components/SignaturePad'
import { SignatureGridEditor } from '../../../components/SignatureGridEditor'
import { assetUrl, createGalleryPrintCheckout, creatorEarningsCents, fetchGalleryItemProject, formatCents, getCanvasForDesign, PRINT_OWN_BASE_CENTS, printGalleryTotalCents, getCreatorEarnings, getCreatorProfile, getMyCreatorProfile, getMySignature, isStandardOrder, saveMySignature, toggleGalleryLike, updateMyCreatorName, type CreatorEarnings, type CreatorProfile, type GalleryItem } from '../../../lib/api'

function resolveMaybeAssetUrl(path: string | null) {
  if (!path) return null
  if (path.startsWith('http')) return path
  return assetUrl(path)
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatYear(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function submitterInitials(name: string) {
  const parts = name.split(/[._\-\s]+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

function designSpecs(item: GalleryItem) {
  const canvas = item.width_inches && item.height_inches
    ? getCanvasForDesign(item.width_inches, item.height_inches)
    : null
  return [
    item.width_inches && item.height_inches
      ? `${item.width_inches.toFixed(1)}" × ${item.height_inches.toFixed(1)}"`
      : null,
    item.mesh_count ? `${item.mesh_count} mesh` : null,
    item.color_count ? `${item.color_count} colors` : null,
    canvas ? `${canvas.label} canvas` : null,
  ].filter(Boolean)
}

function GalleryImage({ src, alt, style }: { src: string | null; alt: string; style: CSSProperties }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) {
    return (
      <span style={{ ...style, display: 'grid', placeItems: 'center', color: '#8a8177', fontSize: 12 }}>
        No preview
      </span>
    )
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} onError={() => setFailed(true)} style={style} />
}

const btnPrimary = {
  padding: '9px 18px',
  border: '1px solid #5c7856',
  borderRadius: 8,
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
  background: '#6e8d67',
  color: '#fff',
  lineHeight: 1.3,
} as const

const btnSecondary = {
  padding: '8px 14px',
  border: '1px solid #d7d0c8',
  borderRadius: 8,
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  background: '#fff',
  color: '#3f382f',
  lineHeight: 1.3,
} as const

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box' as const,
  border: '1px solid #d7d0c8',
  borderRadius: 8,
  padding: '9px 12px',
  fontFamily: 'inherit',
  fontSize: 14,
  color: '#3f382f',
  background: '#fffdf8',
}

export default function CreatorProfilePage() {
  const params = useParams()
  const slug = typeof params.slug === 'string' ? params.slug : ''
  const router = useRouter()
  const { session, user, updateProfile, signOut } = useAuth()
  const [profile, setProfile] = useState<CreatorProfile | null>(null)
  const [items, setItems] = useState<GalleryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedPreview, setSelectedPreview] = useState<GalleryItem | null>(null)

  // earnings (own profile only)
  const [earnings, setEarnings] = useState<CreatorEarnings | null>(null)

  // edit mode state
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editBio, setEditBio] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saved, setSaved] = useState(false)

  const [signatureUrl, setSignatureUrl] = useState<string | null>(null)
  const [savingSignature, setSavingSignature] = useState(false)
  const [signatureError, setSignatureError] = useState('')
  const [redrawingSignature, setRedrawingSignature] = useState(false)
  const [signatureMode, setSignatureMode] = useState<'draw' | 'pixel'>('draw')

  const [checkoutLoading, setCheckoutLoading] = useState<'template' | 'print' | null>(null)
  const [checkoutError, setCheckoutError] = useState('')
  const [checkoutClientSecret, setCheckoutClientSecret] = useState<string | null>(null)

  const isOwnProfile = !!(profile && user && profile.user_id === user.id)

  useEffect(() => {
    if (!slug) return
    setLoading(true)
    setError('')
    getCreatorProfile(slug, session?.access_token)
      .then((p) => {
        setProfile(p)
        setItems(p.items)
      })
      .catch(() => setError('Could not load this creator profile.'))
      .finally(() => setLoading(false))
  }, [slug, session?.access_token])

  // Fetch earnings once we know it's the own profile
  useEffect(() => {
    if (!isOwnProfile || !session?.access_token) return
    getCreatorEarnings(session.access_token)
      .then(setEarnings)
      .catch(() => { /* non-critical */ })
  }, [isOwnProfile, session?.access_token])

  // Fetch the saved signature once we know it's the own profile
  useEffect(() => {
    if (!isOwnProfile || !session?.access_token) return
    getMySignature(session.access_token)
      .then((res) => setSignatureUrl(res.image_url))
      .catch(() => { /* non-critical */ })
  }, [isOwnProfile, session?.access_token])

  // Pre-fill edit fields from auth user_metadata when entering edit mode
  useEffect(() => {
    if (editing && user) {
      setEditName((user.user_metadata?.full_name as string | undefined) ?? profile?.submitter_name ?? '')
      setEditBio((user.user_metadata?.bio as string | undefined) ?? '')
      setSaveError('')
      setSaved(false)
    }
  }, [editing, user, profile])

  async function handleUseTemplate(item: GalleryItem) {
    const palette = (item.palette ?? []).map((c) => ({ hex: c.hex, dmc_code: c.dmc_code, dmc_name: c.dmc_name }))
    const settings = {
      width_inches: item.width_inches ?? 4,
      height_inches: item.height_inches ?? 4,
      mesh_count: item.mesh_count ?? 13,
      color_count: (item.color_count ?? palette.length) || 20,
      contrast_level: 'normal',
      source_type: 'photo',
      show_grid: false,
      clean_background: false,
      simplify_colors: false,
      strengthen_dark_detail: false,
      preserve_accents: false,
    }
    let cells: string[][] | null = null
    if (item.project_id) {
      try {
        const project = await fetchGalleryItemProject(item.id)
        cells = (project as { cells?: string[][] }).cells ?? null
      } catch { /* proceed without cells */ }
    }
    const meshCount = item.mesh_count ?? 13
    if (cells?.length && cells[0]?.length) {
      settings.width_inches = cells[0].length / meshCount
      settings.height_inches = cells.length / meshCount
    }
    localStorage.setItem('mns_pending_template', JSON.stringify({
      previewImagePath: item.preview_image_url,
      originalPreviewImagePath: item.preview_image_url,
      lastVisibleImageUrl: item.preview_image_url,
      allPalette: palette,
      previewPalette: palette,
      enabledColorHexes: palette.map((c) => c.hex),
      cells: cells ?? undefined,
      originalCells: cells ?? undefined,
      draftSettings: settings,
      lastSettings: settings,
      hasGeneratedPreview: true,
      viewMode: 'stitch',
      activeWorkflowStep: 2,
      parentGalleryItemId: item.id,
    }))
    router.push('/studio')
  }

  async function handlePrintCheckout(item: GalleryItem) {
    setCheckoutError('')
    setCheckoutLoading('print')
    try {
      const { client_secret } = await createGalleryPrintCheckout(item.id)
      setCheckoutClientSecret(client_secret)
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Could not start checkout.')
    } finally {
      setCheckoutLoading(null)
    }
  }

  async function handleLike(item: GalleryItem) {
    if (!session?.access_token) return
    try {
      const updated = await toggleGalleryLike(item.id, session.access_token)
      setItems((current) => current.map((e) => (e.id === item.id ? updated : e)))
      if (selectedPreview?.id === item.id) setSelectedPreview(updated)
    } catch { /* ignore */ }
  }

  async function handleSaveProfile(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setSaveError('')
    try {
      const trimmedName = editName.trim()
      await updateProfile({ full_name: trimmedName || undefined, bio: editBio.trim() || undefined })
      // Creator name shown in the gallery lives on the gallery items — update it too
      if (trimmedName && session?.access_token) {
        const updated = await updateMyCreatorName(trimmedName, session.access_token)
        setProfile((current) => current ? { ...current, submitter_name: updated.submitter_name } : current)
        setSaved(true)
        setTimeout(() => {
          setEditing(false)
          // The creator URL is derived from the name — follow it if it changed
          if (updated.slug && updated.slug !== slug) {
            router.replace(`/gallery/${updated.slug}`)
          }
        }, 600)
        return
      }
      setSaved(true)
      setTimeout(() => setEditing(false), 600)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save profile.')
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveSignature(blob: Blob, grid?: string[][]) {
    if (!session?.access_token) return
    setSavingSignature(true)
    setSignatureError('')
    try {
      const res = await saveMySignature(blob, session.access_token, grid)
      setSignatureUrl(res.image_url)
      setRedrawingSignature(false)
    } catch (err) {
      setSignatureError(err instanceof Error ? err.message : 'Could not save signature.')
    } finally {
      setSavingSignature(false)
    }
  }

  async function handleViewProfile() {
    if (!session?.access_token) return
    try {
      const ownProfile = await getMyCreatorProfile(session.access_token)
      router.push(ownProfile.slug ? `/gallery/${ownProfile.slug}` : '/gallery')
    } catch {
      router.push('/gallery')
    }
  }

  const memberSince = items.length > 0
    ? formatYear([...items].sort((a, b) => a.created_at.localeCompare(b.created_at))[0].created_at)
    : null

  const bio = isOwnProfile
    ? (user?.user_metadata?.bio as string | undefined) ?? ''
    : ''

  return (
    <div style={{ minHeight: '100dvh', background: '#f5f1ea', color: '#3f382f' }}>
      <nav style={{ height: 70, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', borderBottom: '1px solid #5c7856', background: '#6e8d67', boxSizing: 'border-box' }}>
        <Link href="/gallery" style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 18, fontWeight: 700, color: '#fffdf8', textDecoration: 'none' }}>
          ← Gallery
        </Link>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Link href="/contact" style={{ color: '#fffdf8', textDecoration: 'none', fontWeight: 600, fontSize: 13 }}>Contact Us</Link>
          <Link href="/studio" style={{ ...btnSecondary, textDecoration: 'none', fontSize: 13 }}>Open Studio</Link>
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

      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 24px' }}>
        {loading && <p style={{ color: '#8a8177' }}>Loading…</p>}
        {error && <p style={{ color: '#b04030' }}>{error}</p>}

        {profile && (
          <>
            {/* Profile header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20, marginBottom: 36, flexWrap: 'wrap' }}>
              <div style={{
                width: 72,
                height: 72,
                borderRadius: '50%',
                display: 'grid',
                placeItems: 'center',
                border: '1px solid #d8d0c4',
                background: '#f0ece5',
                color: '#3f382f',
                fontFamily: 'Georgia, "Times New Roman", serif',
                fontSize: 24,
                fontWeight: 700,
                flexShrink: 0,
              }}>
                {submitterInitials(profile.submitter_name)}
              </div>
              <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 6, alignContent: 'start' }}>
                <h1 style={{ margin: 0, fontSize: 26, fontFamily: 'Georgia, "Times New Roman", serif' }}>
                  {profile.submitter_name}
                </h1>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', color: '#8a8177', fontSize: 13 }}>
                  <span>{items.length} {items.length === 1 ? 'design' : 'designs'}</span>
                  {memberSince && <span>Member since {memberSince}</span>}
                </div>
                {bio && (
                  <p style={{ margin: '4px 0 0', fontSize: 14, color: '#5f574f', maxWidth: 480, lineHeight: 1.5 }}>{bio}</p>
                )}
              </div>
              {isOwnProfile && !editing && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  style={{ ...btnSecondary, flexShrink: 0, alignSelf: 'flex-start' }}
                >
                  Edit profile
                </button>
              )}
            </div>

            {/* Edit form (own profile only) */}
            {isOwnProfile && editing && (
              <form
                onSubmit={handleSaveProfile}
                style={{
                  background: '#fffdf8',
                  border: '1px solid #e7e1d8',
                  borderRadius: 10,
                  padding: 24,
                  marginBottom: 32,
                  display: 'grid',
                  gap: 16,
                  maxWidth: 480,
                }}
              >
                <h2 style={{ margin: 0, fontSize: 17, fontFamily: 'Georgia, "Times New Roman", serif' }}>Edit profile</h2>
                <div style={{ display: 'grid', gap: 6 }}>
                  <label style={{ fontSize: 13, fontWeight: 600 }}>Display name</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="Your name"
                    autoComplete="name"
                    style={inputStyle}
                  />
                  <p style={{ margin: '2px 0 0', fontSize: 12, color: '#8a8177' }}>
                    Used as your name on future posts. Existing posts keep their original name.
                  </p>
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  <label style={{ fontSize: 13, fontWeight: 600 }}>Bio</label>
                  <textarea
                    value={editBio}
                    onChange={(e) => setEditBio(e.target.value)}
                    placeholder="A few words about you or your stitching style"
                    rows={3}
                    style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
                  />
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  <label style={{ fontSize: 13, fontWeight: 600 }}>Signature</label>
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
                    <div style={{ display: 'grid', gap: 10 }}>
                      <div style={{ display: 'inline-flex', border: '1px solid #d7d0c8', borderRadius: 999, padding: 3, width: 'fit-content' }}>
                        {(['draw', 'pixel'] as const).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => setSignatureMode(mode)}
                            style={{
                              padding: '5px 14px',
                              borderRadius: 999,
                              border: 'none',
                              fontFamily: 'inherit',
                              fontSize: 13,
                              fontWeight: 600,
                              cursor: 'pointer',
                              background: signatureMode === mode ? '#3f382f' : 'transparent',
                              color: signatureMode === mode ? '#fff' : '#8a8177',
                            }}
                          >
                            {mode === 'draw' ? 'Draw' : 'Pixel'}
                          </button>
                        ))}
                      </div>
                      {signatureMode === 'draw' ? (
                        <SignaturePad onSave={handleSaveSignature} saving={savingSignature} />
                      ) : (
                        <SignatureGridEditor onSave={handleSaveSignature} saving={savingSignature} />
                      )}
                    </div>
                  )}
                  {signatureError && <p style={{ margin: 0, fontSize: 13, color: '#b0453a' }}>{signatureError}</p>}
                </div>
                {saveError && <p style={{ margin: 0, fontSize: 13, color: '#b0453a' }}>{saveError}</p>}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="submit" disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.65 : 1 }}>
                    {saved ? 'Saved ✓' : saving ? 'Saving…' : 'Save'}
                  </button>
                  <button type="button" onClick={() => setEditing(false)} style={btnSecondary}>
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {/* Earnings (own profile only) */}
            {isOwnProfile && earnings && (
              <div style={{
                background: '#fffdf8',
                border: '1px solid #e7e1d8',
                borderRadius: 10,
                padding: '20px 24px',
                marginBottom: 32,
                display: 'grid',
                gap: 16,
              }}>
                <h2 style={{ margin: 0, fontSize: 16, fontFamily: 'Georgia, "Times New Roman", serif' }}>Sales & Canvas Credit</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
                  {[
                    { label: 'Template sales', value: earnings.template_sales },
                    { label: 'Print sales', value: earnings.print_sales },
                    { label: 'Total credit earned', value: `$${(earnings.total_cents / 100).toFixed(2)}` },
                    { label: 'Credit available', value: `$${(earnings.pending_cents / 100).toFixed(2)}` },
                    { label: 'Credit used', value: `$${(earnings.paid_cents / 100).toFixed(2)}` },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ background: '#f5f1ea', borderRadius: 8, padding: '12px 14px' }}>
                      <div style={{ fontSize: 12, color: '#8a8177', marginBottom: 4 }}>{label}</div>
                      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'Georgia, "Times New Roman", serif', color: '#3f382f' }}>{value}</div>
                    </div>
                  ))}
                </div>
                <p style={{ margin: 0, fontSize: 12, color: '#8a8177' }}>
                  Each sale earns 20% of the sale price as canvas credit you can use toward future MNS canvas orders. Reach out to redeem.
                </p>
              </div>
            )}

            {/* Designs grid */}
            {items.length === 0 ? (
              <p style={{ color: '#8a8177' }}>No designs published yet.</p>
            ) : (
              <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 16 }}>
                {items.map((item) => (
                  <article
                    key={item.id}
                    style={{
                      display: 'grid',
                      gridTemplateRows: '220px 1fr',
                      border: '1px solid #e7e1d8',
                      borderRadius: 10,
                      overflow: 'hidden',
                      background: '#fff',
                      boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
                    }}
                  >
                    <div style={{ background: '#ede8df', display: 'grid', placeItems: 'center', overflow: 'hidden', padding: 12, boxSizing: 'border-box' }}>
                      {resolveMaybeAssetUrl(item.preview_image_url) ? (
                        <button
                          type="button"
                          onClick={() => setSelectedPreview(item)}
                          style={{ width: '100%', height: '100%', border: 0, padding: 0, background: 'transparent', cursor: 'zoom-in', display: 'block', position: 'relative', overflow: 'hidden' }}
                        >
                          <GalleryImage
                            src={resolveMaybeAssetUrl(item.preview_image_url)}
                            alt={item.title}
                            style={{ display: 'block', position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'center' }}
                          />
                        </button>
                      ) : (
                        <span style={{ color: '#8a8177' }}>No preview</span>
                      )}
                    </div>
                    <div style={{ padding: 14, display: 'grid', gap: 8 }}>
                      <strong style={{ fontSize: 15 }}>{item.title}</strong>
                      {item.width_inches && item.height_inches && (
                        <span style={{ fontSize: 12, color: '#8a8177' }}>
                          {item.width_inches.toFixed(1)}" × {item.height_inches.toFixed(1)}"
                        </span>
                      )}
                      {item.tags && item.tags.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {item.tags.map((tag) => (
                            <span key={tag} style={{ fontSize: 10, padding: '2px 7px', background: '#f0ece5', borderRadius: 999, color: '#5f574f', border: '1px solid #e3ddd6' }}>
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          type="button"
                          onClick={() => void handleLike(item)}
                          style={{
                            ...btnSecondary,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            borderColor: item.liked_by_me ? '#5c7856' : '#d7d0c8',
                            background: item.liked_by_me ? '#dfe8dd' : '#fff',
                            color: item.liked_by_me ? '#3f6b38' : '#3f382f',
                          }}
                        >
                          ♥ {item.liked_by_me ? 'Liked' : 'Like'}
                          {item.like_count > 0 && (
                            <span style={{ background: 'rgba(0,0,0,0.07)', borderRadius: 999, padding: '1px 6px', fontSize: 11 }}>
                              {item.like_count}
                            </span>
                          )}
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </section>
            )}
          </>
        )}
      </main>

      {checkoutClientSecret && (
        <CheckoutModal
          clientSecret={checkoutClientSecret}
          onClose={() => setCheckoutClientSecret(null)}
        />
      )}

      {selectedPreview && (
        <div
          onClick={() => setSelectedPreview(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,12,0.82)', zIndex: 50, display: 'grid', placeItems: 'center', padding: 24 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(900px, 100%)', maxHeight: '90vh', display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 300px', background: '#f8f4ec', borderRadius: 10, overflow: 'hidden' }}
          >
            <div style={{ display: 'grid', placeItems: 'center', padding: 20, background: '#ede8df', minHeight: 0, position: 'relative' }}>
              <GalleryImage
                src={resolveMaybeAssetUrl(selectedPreview.preview_image_url)}
                alt={selectedPreview.title}
                style={{ display: 'block', position: 'absolute', inset: 20, width: 'calc(100% - 40px)', height: 'calc(100% - 40px)', objectFit: 'contain', objectPosition: 'center' }}
              />
            </div>
            <aside style={{ padding: 24, display: 'grid', gridTemplateRows: 'auto 1fr auto', gap: 18, overflowY: 'auto', boxSizing: 'border-box' }}>
              <div style={{ display: 'grid', gap: 6 }}>
                <h2 style={{ margin: 0, fontSize: 20 }}>{selectedPreview.title}</h2>
                <span style={{ fontSize: 12, color: '#8a8177' }}>Shared {formatDate(selectedPreview.created_at)}</span>
              </div>
              <div style={{ display: 'grid', alignContent: 'start', gap: 12 }}>
                <div style={{ fontSize: 13, color: '#5f574f', display: 'grid', gap: 4 }}>
                  {(designSpecs(selectedPreview).length ? designSpecs(selectedPreview) : ['Finalized stitch design']).map((s) => (
                    <span key={s}>{s}</span>
                  ))}
                </div>
                {selectedPreview.palette && selectedPreview.palette.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {selectedPreview.palette.map((color) => (
                      <div key={color.hex} title={`${color.dmc_code} — ${color.dmc_name}`} style={{ width: 20, height: 20, borderRadius: '50%', background: color.hex, border: '1px solid rgba(0,0,0,0.12)', flexShrink: 0 }} />
                    ))}
                  </div>
                )}
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => void handleLike(selectedPreview)}
                  style={{
                    ...btnPrimary,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    background: selectedPreview.liked_by_me ? '#4a7444' : '#6e8d67',
                    borderColor: selectedPreview.liked_by_me ? '#4a7444' : '#5c7856',
                  }}
                >
                  ♥ {selectedPreview.liked_by_me ? 'Liked' : 'Like'}
                  {selectedPreview.like_count > 0 && (
                    <span style={{ background: 'rgba(255,255,255,0.22)', borderRadius: 999, padding: '1px 7px', fontSize: 11 }}>
                      {selectedPreview.like_count}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => void handleUseTemplate(selectedPreview)}
                  disabled={checkoutLoading !== null}
                  style={btnSecondary}
                >
                  Use template
                </button>
                {(() => {
                  const printable = selectedPreview.width_inches && selectedPreview.height_inches
                    ? isStandardOrder(selectedPreview.width_inches, selectedPreview.height_inches)
                    : false
                  const canvas = printable && selectedPreview.width_inches && selectedPreview.height_inches
                    ? getCanvasForDesign(selectedPreview.width_inches, selectedPreview.height_inches)
                    : null
                  const printPrice = canvas ? formatCents(printGalleryTotalCents(canvas)) : null
                  return (
                    <>
                      <button
                        type="button"
                        onClick={() => void handlePrintCheckout(selectedPreview)}
                        disabled={!printPrice || checkoutLoading !== null}
                        style={{
                          ...btnSecondary,
                          ...(printPrice ? {} : { color: '#8a8177', background: '#f4efe7', cursor: 'not-allowed' }),
                        }}
                      >
                        {checkoutLoading === 'print'
                          ? 'Redirecting...'
                          : printPrice
                            ? `Order print — ${printPrice}`
                            : 'Print unavailable'}
                      </button>
                      {canvas && printPrice && (
                        <div style={{ fontSize: 11, color: '#8a8177', lineHeight: 1.5 }}>
                          <div style={{ fontWeight: 600, color: '#5f574f', marginBottom: 2 }}>Mono Deluxe Zweigart Canvas</div>
                          <div>{canvas.label} canvas — {formatCents(canvas.priceCents)}</div>
                          <div>Printing &amp; fulfillment — {formatCents(PRINT_OWN_BASE_CENTS)}</div>
                          <div>Creator credit (20%) — {formatCents(creatorEarningsCents(printGalleryTotalCents(canvas)))}</div>
                        </div>
                      )}
                      {canvas && printPrice && (
                        <div style={{ fontSize: 11, color: '#8a8177' }}>Ships within 5–7 business days</div>
                      )}
                      {checkoutError && <p style={{ margin: 0, fontSize: 12, color: '#b0453a' }}>{checkoutError}</p>}
                    </>
                  )
                })()}
                <button type="button" onClick={() => setSelectedPreview(null)} style={btnSecondary}>Close</button>
              </div>
            </aside>
          </div>
        </div>
      )}
    </div>
  )
}
