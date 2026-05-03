'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { AuthPanel } from '../../components/AuthPanel'
import { useAuth } from '../../components/AuthProvider'
import { assetUrl, listGalleryItems, toggleGalleryLike, type GalleryItem } from '../../lib/api'

const btnPrimary = {
  padding: '9px 18px',
  border: 'none',
  borderRadius: 8,
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
  background: '#6e8d67',
  color: '#fff',
} as const

const btnSecondary = {
  padding: '8px 13px',
  border: '1px solid #d7d0c8',
  borderRadius: 8,
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  background: '#fff',
  color: '#3f382f',
} as const

function resolveMaybeAssetUrl(path: string | null) {
  if (!path) return null
  if (path.startsWith('http')) return path
  return assetUrl(path)
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function GalleryPage() {
  const { session, user, signOut } = useAuth()
  const [items, setItems] = useState<GalleryItem[]>([])
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'recent' | 'popular'>('recent')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showAuthPrompt, setShowAuthPrompt] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError('')
    listGalleryItems({ search, sort, accessToken: session?.access_token })
      .then(setItems)
      .catch(() => setError('Could not load the gallery.'))
      .finally(() => setLoading(false))
  }, [search, sort, session?.access_token])

  const itemCountLabel = useMemo(() => {
    if (loading) return 'Loading...'
    return `${items.length} design${items.length === 1 ? '' : 's'}`
  }, [items.length, loading])

  async function handleLike(item: GalleryItem) {
    if (!session?.access_token) {
      setShowAuthPrompt(true)
      return
    }
    try {
      const updated = await toggleGalleryLike(item.id, session.access_token)
      setItems((current) => current.map((entry) => (entry.id === item.id ? updated : entry)))
    } catch {
      setError('Could not update like.')
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f5f1ea', color: '#3f382f' }}>
      <nav
        style={{
          height: 72,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 32px',
          borderBottom: '1px solid #e7e1d8',
          background: '#fffdf8',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/studio" style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none' }}>
            <div aria-hidden="true" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 9px)', gap: 3, padding: 2 }}>
              {Array.from({ length: 9 }, (_, i) => (
                <span key={i} style={{ width: 9, height: 9, border: '2px solid #111', borderRadius: 2, boxSizing: 'border-box' }} />
              ))}
            </div>
            <strong style={{ fontSize: 22, color: '#111' }}>MNS Studio</strong>
          </Link>
          <span style={{ color: '#d8d0c4', margin: '0 6px' }}>|</span>
          <span style={{ fontSize: 15, fontWeight: 700 }}>Gallery</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/drafts" style={{ ...btnSecondary, textDecoration: 'none' }}>Projects</Link>
          <Link href="/studio" style={{ ...btnPrimary, textDecoration: 'none' }}>Create</Link>
          {session ? (
            <button type="button" onClick={() => void signOut()} style={btnSecondary}>
              {user?.email ? 'Log out' : 'Signed in'}
            </button>
          ) : (
            <button type="button" onClick={() => setShowAuthPrompt(true)} style={btnSecondary}>Log in</button>
          )}
        </div>
      </nav>

      <main style={{ maxWidth: 1180, margin: '0 auto', padding: '30px 24px 52px', display: 'grid', gap: 22 }}>
        <section style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'end', flexWrap: 'wrap' }}>
            <div style={{ display: 'grid', gap: 6 }}>
              <h1 style={{ margin: 0, fontSize: 32 }}>Gallery</h1>
              <p style={{ margin: 0, color: '#7f776d', fontSize: 15 }}>
                Browse finalized stitch designs shared by the MNS Studio community.
              </p>
            </div>
            <span style={{ fontSize: 13, color: '#8a8177' }}>{itemCountLabel}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) 150px', gap: 10 }}>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by title or tag"
              style={{
                border: '1px solid #d7d0c8',
                borderRadius: 8,
                padding: '10px 12px',
                font: 'inherit',
                background: '#fffdf8',
                color: '#3f382f',
              }}
            />
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as 'recent' | 'popular')}
              style={{
                border: '1px solid #d7d0c8',
                borderRadius: 8,
                padding: '10px 12px',
                font: 'inherit',
                background: '#fffdf8',
                color: '#3f382f',
              }}
            >
              <option value="recent">Newest</option>
              <option value="popular">Most liked</option>
            </select>
          </div>
        </section>

        {error && <p style={{ margin: 0, color: '#b0453a' }}>{error}</p>}

        {loading ? (
          <p style={{ margin: 0, color: '#8a8177' }}>Loading gallery...</p>
        ) : items.length === 0 ? (
          <div style={{ border: '1px solid #e7e1d8', borderRadius: 12, background: '#fffdf8', padding: 24 }}>
            No shared designs yet.
          </div>
        ) : (
          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 16 }}>
            {items.map((item) => (
              <article
                key={item.id}
                style={{
                  display: 'grid',
                  gridTemplateRows: '190px 1fr',
                  border: '1px solid #e7e1d8',
                  borderRadius: 10,
                  overflow: 'hidden',
                  background: '#fff',
                  boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
                }}
              >
                <div style={{ background: '#ede8df', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
                  {resolveMaybeAssetUrl(item.preview_image_url) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={resolveMaybeAssetUrl(item.preview_image_url) ?? ''} alt={item.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <span style={{ color: '#8a8177' }}>No preview</span>
                  )}
                </div>
                <div style={{ padding: 14, display: 'grid', gap: 10 }}>
                  <div style={{ display: 'grid', gap: 4 }}>
                    <strong style={{ fontSize: 16 }}>{item.title}</strong>
                    <span style={{ fontSize: 12, color: '#8a8177' }}>
                      {[item.width_inches && item.height_inches ? `${item.width_inches.toFixed(1)}" x ${item.height_inches.toFixed(1)}"` : null, item.mesh_count ? `${item.mesh_count} mesh` : null, item.color_count ? `${item.color_count} colors` : null]
                        .filter(Boolean)
                        .join(' · ') || `Shared ${formatDate(item.created_at)}`}
                    </span>
                  </div>
                  {item.tags.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {item.tags.map((tag) => (
                        <span key={tag} style={{ border: '1px solid #e1d9ce', borderRadius: 999, padding: '3px 8px', fontSize: 12, color: '#6f675f' }}>
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                    <button type="button" onClick={() => void handleLike(item)} style={btnSecondary}>
                      {item.liked_by_me ? 'Liked' : 'Like'} · {item.like_count}
                    </button>
                    <a href={resolveMaybeAssetUrl(item.pdf_url) ?? '#'} target="_blank" rel="noreferrer" style={{ ...btnSecondary, textDecoration: 'none' }}>
                      Report
                    </a>
                  </div>
                </div>
              </article>
            ))}
          </section>
        )}
      </main>

      {showAuthPrompt && (
        <div role="dialog" aria-modal="true" onClick={() => setShowAuthPrompt(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 40, padding: 18 }}>
          <div onClick={(event) => event.stopPropagation()} style={{ display: 'grid', gap: 12, width: 'min(460px, 100%)' }}>
            <AuthPanel title="Log in to like designs" />
            <button type="button" onClick={() => setShowAuthPrompt(false)} style={{ justifySelf: 'center', border: 0, background: 'transparent', color: '#fff', font: 'inherit', fontWeight: 700, cursor: 'pointer' }}>
              Keep browsing
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
