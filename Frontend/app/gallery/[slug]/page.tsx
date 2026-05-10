'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { type CSSProperties, useEffect, useState } from 'react'
import { useAuth } from '../../../components/AuthProvider'
import { assetUrl, getCreatorProfile, toggleGalleryLike, type CreatorProfile, type GalleryItem } from '../../../lib/api'

function resolveMaybeAssetUrl(path: string | null) {
  if (!path) return null
  if (path.startsWith('http')) return path
  return assetUrl(path)
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function submitterInitials(name: string) {
  const parts = name.split(/[._\-\s]+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

function designSpecs(item: GalleryItem) {
  return [
    item.width_inches && item.height_inches
      ? `${item.width_inches.toFixed(1)}" × ${item.height_inches.toFixed(1)}"`
      : null,
    item.mesh_count ? `${item.mesh_count} mesh` : null,
    item.color_count ? `${item.color_count} colors` : null,
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

export default function CreatorProfilePage() {
  const params = useParams()
  const slug = typeof params.slug === 'string' ? params.slug : ''
  const { session } = useAuth()
  const [profile, setProfile] = useState<CreatorProfile | null>(null)
  const [items, setItems] = useState<GalleryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedPreview, setSelectedPreview] = useState<GalleryItem | null>(null)

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

  async function handleLike(item: GalleryItem) {
    if (!session?.access_token) return
    try {
      const updated = await toggleGalleryLike(item.id, session.access_token)
      setItems((current) => current.map((e) => (e.id === item.id ? updated : e)))
      if (selectedPreview?.id === item.id) setSelectedPreview(updated)
    } catch { /* ignore */ }
  }

  return (
    <div style={{ minHeight: '100dvh', background: '#f5f1ea', color: '#3f382f' }}>
      <nav style={{ height: 72, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', borderBottom: '1px solid #e7e1d8', background: '#fffdf8', boxSizing: 'border-box' }}>
        <Link href="/gallery" style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 18, fontWeight: 700, color: '#3f382f', textDecoration: 'none' }}>
          ← Gallery
        </Link>
        <Link href="/studio" style={{ ...btnSecondary, textDecoration: 'none', fontSize: 13 }}>Open Studio</Link>
      </nav>

      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 24px' }}>
        {loading && <p style={{ color: '#8a8177' }}>Loading…</p>}
        {error && <p style={{ color: '#b0453a' }}>{error}</p>}

        {profile && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 36 }}>
              <div style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                display: 'grid',
                placeItems: 'center',
                border: '1px solid #d8d0c4',
                background: '#f0ece5',
                color: '#3f382f',
                fontFamily: 'Georgia, "Times New Roman", serif',
                fontSize: 22,
                fontWeight: 700,
                flexShrink: 0,
              }}>
                {submitterInitials(profile.submitter_name)}
              </div>
              <div style={{ display: 'grid', gap: 4 }}>
                <h1 style={{ margin: 0, fontSize: 26, fontFamily: 'Georgia, "Times New Roman", serif' }}>
                  {profile.submitter_name}&apos;s Studio
                </h1>
                <span style={{ fontSize: 13, color: '#8a8177' }}>
                  {items.length} {items.length === 1 ? 'design' : 'designs'} published
                </span>
              </div>
            </div>

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
                      <span style={{ fontSize: 12, color: '#8a8177' }}>
                        {designSpecs(item).join(' · ') || 'Finalized stitch design'}
                      </span>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button type="button" onClick={() => void handleLike(item)} style={btnSecondary}>
                          {item.liked_by_me ? 'Liked' : 'Like'} · {item.like_count}
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
                <button type="button" onClick={() => void handleLike(selectedPreview)} style={btnPrimary}>
                  {selectedPreview.liked_by_me ? 'Liked' : 'Like'} · {selectedPreview.like_count}
                </button>
                <button type="button" onClick={() => setSelectedPreview(null)} style={btnSecondary}>Close</button>
              </div>
            </aside>
          </div>
        </div>
      )}
    </div>
  )
}
