'use client'

import Link from 'next/link'
import { type CSSProperties, useEffect, useMemo, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AuthPanel } from '../../components/AuthPanel'
import { useAuth } from '../../components/AuthProvider'
import { ProfileModal } from '../../components/ProfileModal'
import { userDisplayName } from '../../components/UserAvatar'
import { NavAccountControls } from '../../components/NavAccountControls'
import { assetUrl, buildCreatorSlugMap, createGalleryPrintCheckout, fetchGalleryItemProject, formatCents, getCanvasForDesign, incrementGalleryShare, listGalleryItems, toggleGalleryLike, type GalleryItem } from '../../lib/api'
import GuideDialog from '../../components/GuideDialog'

const MOBILE_BREAKPOINT = 768

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

function resolveMaybeAssetUrl(path: string | null) {
  if (!path) return null
  if (path.startsWith('http')) return path
  return assetUrl(path)
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function currentUserDisplayName(user: ReturnType<typeof useAuth>['user']) {
  return user ? userDisplayName(user) : null
}

function submitterLabel(item: GalleryItem, user: ReturnType<typeof useAuth>['user']) {
  const storedName = item.submitter_name?.trim()
  if (storedName) return storedName
  if (user?.id === item.user_id) return currentUserDisplayName(user) ?? 'You'
  return 'MNS stitcher'
}

function submitterInitials(name: string) {
  const parts = name.split(/[._\-\s]+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

function designSpecs(item: GalleryItem) {
  return [
    item.width_inches && item.height_inches
      ? `${item.width_inches.toFixed(1)}" x ${item.height_inches.toFixed(1)}"`
      : null,
    item.mesh_count ? `${item.mesh_count} mesh` : null,
    item.color_count ? `${item.color_count} colors` : null,
  ].filter(Boolean)
}

function GalleryImage({
  src,
  alt,
  style,
  placeholderText = 'Preview unavailable',
}: {
  src: string | null
  alt: string
  style: CSSProperties
  placeholderText?: string
}) {
  const [failed, setFailed] = useState(false)

  if (!src || failed) {
    return (
      <span
        style={{
          ...style,
          display: 'grid',
          placeItems: 'center',
          color: '#8a8177',
          fontSize: 12,
          textAlign: 'center',
          padding: 12,
          boxSizing: 'border-box',
        }}
      >
        {placeholderText}
      </span>
    )
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      style={style}
    />
  )
}

function GalleryPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { session, user, signOut } = useAuth()
  const [items, setItems] = useState<GalleryItem[]>([])
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'recent' | 'popular'>('recent')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showAuthPrompt, setShowAuthPrompt] = useState(false)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [showGuideDialog, setShowGuideDialog] = useState(false)
  const [selectedPreview, setSelectedPreview] = useState<GalleryItem | null>(null)
  const [viewportWidth, setViewportWidth] = useState(1200)
  const [checkoutLoading, setCheckoutLoading] = useState<'template' | 'print' | null>(null)
  const [checkoutError, setCheckoutError] = useState('')
  const [hasActiveDesign] = useState(() => {
    if (typeof window === 'undefined') return false
    try {
      const saved = localStorage.getItem('mns_active_design')
      if (!saved) return false
      const d = JSON.parse(saved)
      return !!(d.previewImagePath || d.cells?.length > 0)
    } catch { return false }
  })
  const [shareToast, setShareToast] = useState(false)

  const slugMap = useMemo(() => buildCreatorSlugMap(items), [items])


  useEffect(() => {
    const update = () => setViewportWidth(window.innerWidth)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  useEffect(() => {
    router.prefetch('/drafts')
    router.prefetch('/studio')
  }, [router])

  useEffect(() => {
    setLoading(true)
    setError('')
    listGalleryItems({ search, sort, accessToken: session?.access_token })
      .then(setItems)
      .catch(() => setError('Could not load the gallery.'))
      .finally(() => setLoading(false))
  }, [search, sort, session?.access_token])

  useEffect(() => {
    const itemId = searchParams.get('item')
    if (!itemId || items.length === 0) return
    const found = items.find((i) => i.id === itemId)
    if (found) setSelectedPreview(found)
  }, [searchParams, items])

  const isMobile = viewportWidth < MOBILE_BREAKPOINT

  async function handleUseTemplate(item: GalleryItem) {
    const palette = (item.palette ?? []).map((c) => ({
      hex: c.hex,
      dmc_code: c.dmc_code,
      dmc_name: c.dmc_name,
    }))
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

    let cells: unknown = null
    if (item.project_id) {
      try {
        const project = await fetchGalleryItemProject(item.id)
        cells = (project as { cells?: unknown }).cells ?? null
      } catch {
        // proceed without cells — user gets preview-only mode
      }
    }

    localStorage.setItem('mns_active_design', JSON.stringify({
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
    }))
    router.push('/studio')
  }

  async function handlePrintCheckout(item: GalleryItem) {
    setCheckoutError('')
    setCheckoutLoading('print')
    try {
      const { checkout_url } = await createGalleryPrintCheckout(item.id)
      window.location.href = checkout_url
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Could not start checkout.')
      setCheckoutLoading(null)
    }
  }

  async function handleLike(item: GalleryItem) {
    if (!session?.access_token) {
      setShowAuthPrompt(true)
      return
    }
    try {
      const updated = await toggleGalleryLike(item.id, session.access_token)
      setItems((current) => current.map((entry) => (entry.id === item.id ? updated : entry)))
      if (selectedPreview?.id === item.id) setSelectedPreview(updated)
    } catch {
      setError('Could not update like.')
    }
  }

  async function handleShare(item: GalleryItem) {
    const url = `${window.location.origin}/gallery?item=${item.id}`
    const creatorName = submitterLabel(item, user)
    let shared = false
    if (navigator.share) {
      try {
        await navigator.share({
          title: item.title,
          text: `Check out "${item.title}" by ${creatorName} on MNS Studio`,
          url,
        })
        shared = true
      } catch { /* user cancelled */ }
    } else {
      try {
        await navigator.clipboard.writeText(url)
        setShareToast(true)
        setTimeout(() => setShareToast(false), 2000)
        shared = true
      } catch { /* ignore */ }
    }
    if (shared) {
      try {
        const updated = await incrementGalleryShare(item.id)
        setItems((current) => current.map((e) => (e.id === item.id ? updated : e)))
        if (selectedPreview?.id === item.id) setSelectedPreview(updated)
      } catch { /* ignore */ }
    }
  }

  return (
    <div style={{ minHeight: '100dvh', background: '#f5f1ea', color: '#3f382f' }}>
      <nav
        style={{
          height: 72,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: isMobile ? '0 14px' : '0 28px',
          borderBottom: '1px solid #e7e1d8',
          background: '#fffdf8',
          boxSizing: 'border-box',
          overflow: 'hidden',
          position: 'sticky',
          top: 0,
          zIndex: 50,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 12, minWidth: 0 }}>
          <Link href="/gallery" style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', flexShrink: 0 }}>
            <div aria-hidden="true" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 9px)', gap: 3, padding: 2 }}>
              {Array.from({ length: 9 }, (_, i) => (
                <span key={i} style={{ width: 9, height: 9, border: '2px solid #111', borderRadius: 2, boxSizing: 'border-box' }} />
              ))}
            </div>
            <strong style={{ fontSize: 22, color: '#111' }}>MNS Studio</strong>
          </Link>
          {!isMobile && (
            <>
              <span style={{ color: '#d8d0c4', margin: '0 6px' }}>|</span>
              <div style={{ display: 'flex', gap: 24, color: '#7f776d', fontWeight: 600, whiteSpace: 'nowrap' }}>
                <span style={{ color: '#3f382f', fontWeight: 700 }}>Gallery</span>
                <Link href="/drafts" style={{ color: '#7f776d', textDecoration: 'none' }}>Your Studio</Link>
                <Link href="/studio" style={{ color: '#7f776d', textDecoration: 'none' }}>Active Canvas</Link>
              </div>
            </>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 12, flexShrink: 0 }}>
          {session ? (
            <>
              {!isMobile && (
                <button type="button" onClick={() => setShowGuideDialog(true)} style={{ border: 0, background: 'transparent', font: 'inherit', color: '#7f776d', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                  Mission
                </button>
              )}
              <NavAccountControls
                user={user}
                isMobile={isMobile}
                onProfile={() => setShowProfileModal(true)}
                onLogout={() => setShowLogoutConfirm(true)}
              />
            </>
          ) : (
            <button type="button" onClick={() => setShowAuthPrompt(true)} style={{ ...btnSecondary, fontSize: isMobile ? 12 : 13, padding: isMobile ? '6px 10px' : '8px 13px' }}>
              Log in
            </button>
          )}
        </div>
      </nav>

      {hasActiveDesign && (
        <div style={{ background: '#eee7dc', borderBottom: '1px solid #d8cfc5', padding: '10px 24px', display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center' }}>
          <span style={{ color: '#5c4a3a', fontSize: 14 }}>You have an active design in progress.</span>
          <Link href="/studio" style={{ color: '#3f382f', fontWeight: 700, fontSize: 14 }}>Continue editing →</Link>
        </div>
      )}

      <div style={{ position: 'sticky', top: 72, zIndex: 40, background: '#f5f1ea', borderBottom: '1px solid #e7e1d8' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto', padding: isMobile ? '12px 12px 12px' : '14px 24px 14px', display: 'grid', gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: isMobile ? 20 : 28 }}>Gallery</h1>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by title or tag"
              style={{
                border: '1px solid #d7d0c8',
                borderRadius: 8,
                padding: '9px 12px',
                font: 'inherit',
                fontSize: isMobile ? 14 : undefined,
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
                padding: '9px 10px',
                font: 'inherit',
                fontSize: isMobile ? 13 : undefined,
                background: '#fffdf8',
                color: '#3f382f',
                minWidth: isMobile ? 'unset' : 150,
              }}
            >
              <option value="recent">Newest</option>
              <option value="popular">Most liked</option>
            </select>
          </div>
        </div>
      </div>

      <main style={{ maxWidth: 1180, margin: '0 auto', padding: isMobile ? '14px 0 40px' : '20px 24px 52px', display: 'grid', gap: isMobile ? 14 : 22 }}>
        {error && <p style={{ margin: 0, color: '#b0453a', padding: isMobile ? '0 12px' : 0 }}>{error}</p>}

        {loading ? (
          <p style={{ margin: 0, color: '#8a8177', padding: isMobile ? '0 12px' : 0 }}>Loading gallery...</p>
        ) : items.length === 0 ? (
          <div style={{ border: '1px solid #e7e1d8', borderRadius: 12, background: '#fffdf8', padding: 24, margin: isMobile ? '0 12px' : 0 }}>
            No shared designs yet.
          </div>
        ) : isMobile ? (
          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 2 }}>
            {items.map((item) => (
              <article key={item.id} style={{ display: 'grid', gridTemplateRows: 'auto auto', background: '#fff' }}>
                <button
                  type="button"
                  onClick={() => setSelectedPreview(item)}
                  aria-label={`Open ${item.title}`}
                  style={{
                    border: 0,
                    padding: 0,
                    background: '#ede8df',
                    cursor: 'pointer',
                    aspectRatio: '1',
                    position: 'relative',
                    overflow: 'hidden',
                    display: 'block',
                    width: '100%',
                  }}
                >
                  <GalleryImage
                    src={resolveMaybeAssetUrl(item.preview_image_url)}
                    alt={item.title}
                    placeholderText="No preview"
                    style={{
                      position: 'absolute',
                      inset: 6,
                      width: 'calc(100% - 12px)',
                      height: 'calc(100% - 12px)',
                      objectFit: 'contain',
                      objectPosition: 'center center',
                    }}
                  />
                  <span
                    style={{
                      position: 'absolute',
                      bottom: 6,
                      right: 6,
                      background: 'rgba(0,0,0,0.48)',
                      color: '#fff',
                      fontSize: 11,
                      fontWeight: 700,
                      borderRadius: 999,
                      padding: '2px 7px',
                      lineHeight: 1.5,
                    }}
                  >
                    ♥ {item.like_count}
                  </span>
                </button>
                <div style={{ padding: '6px 8px 8px' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#3f382f' }}>
                    {item.title}
                  </div>
                  <div style={{ fontSize: 11, color: '#8a8177', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {slugMap.get(item.user_id) ? (
                      <Link href={`/gallery/${slugMap.get(item.user_id)}`} style={{ color: 'inherit', textDecoration: 'none' }} onClick={(e) => e.stopPropagation()}>
                        {submitterLabel(item, user)}
                      </Link>
                    ) : submitterLabel(item, user)}
                  </div>
                </div>
              </article>
            ))}
          </section>
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
                <div
                  style={{
                    background: '#ede8df',
                    display: 'grid',
                    placeItems: 'center',
                    overflow: 'hidden',
                    padding: 12,
                    boxSizing: 'border-box',
                    minWidth: 0,
                    minHeight: 0,
                  }}
                >
                  {resolveMaybeAssetUrl(item.preview_image_url) ? (
                    <button
                      type="button"
                      onClick={() => setSelectedPreview(item)}
                      aria-label={`Open larger preview for ${item.title}`}
                      style={{
                        width: '100%',
                        height: '100%',
                        border: 0,
                        padding: 0,
                        background: 'transparent',
                        cursor: 'zoom-in',
                        display: 'block',
                        position: 'relative',
                        minWidth: 0,
                        minHeight: 0,
                        overflow: 'hidden',
                      }}
                    >
                      <GalleryImage
                        src={resolveMaybeAssetUrl(item.preview_image_url)}
                        alt={item.title}
                        style={{
                          display: 'block',
                          position: 'absolute',
                          inset: 0,
                          width: '100%',
                          height: '100%',
                          objectFit: 'contain',
                          objectPosition: 'center center',
                        }}
                      />
                    </button>
                  ) : (
                    <span style={{ color: '#8a8177' }}>No preview</span>
                  )}
                </div>
                <div style={{ padding: 14, display: 'grid', gap: 10 }}>
                  <div style={{ display: 'grid', gap: 4 }}>
                    <strong style={{ fontSize: 16 }}>{item.title}</strong>
                    <span style={{ fontSize: 12, color: '#6f675f' }}>
                      By{' '}
                      {slugMap.get(item.user_id) ? (
                        <Link href={`/gallery/${slugMap.get(item.user_id)}`} style={{ color: 'inherit' }}>
                          {submitterLabel(item, user)}
                        </Link>
                      ) : submitterLabel(item, user)}
                      {' '}· {formatDate(item.created_at)}
                    </span>
                    <span style={{ fontSize: 12, color: '#8a8177' }}>
                      {designSpecs(item).join(' · ') || 'Finalized stitch design'}
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
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <button type="button" onClick={() => void handleLike(item)} style={btnSecondary}>
                      {item.liked_by_me ? 'Liked' : 'Like'} · {item.like_count}
                    </button>
                    <button type="button" onClick={() => void handleShare(item)} style={{ ...btnSecondary, padding: '7px 9px', display: 'flex', alignItems: 'center', gap: 5 }} title="Share">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                        <polyline points="16 6 12 2 8 6"/>
                        <line x1="12" y1="2" x2="12" y2="15"/>
                      </svg>
                      {item.share_count > 0 && <span style={{ fontSize: 11 }}>{item.share_count}</span>}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </section>
        )}
      </main>

      {showAuthPrompt && (
        <div role="dialog" aria-modal="true" onClick={() => setShowAuthPrompt(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 80, padding: 18 }}>
          <div onClick={(event) => event.stopPropagation()} style={{ display: 'grid', gap: 12, width: 'min(460px, 100%)' }}>
            <AuthPanel title="Log in to like designs" onSuccess={() => setShowAuthPrompt(false)} />
            <button type="button" onClick={() => setShowAuthPrompt(false)} style={{ justifySelf: 'center', border: 0, background: 'transparent', color: '#fff', font: 'inherit', fontWeight: 700, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {selectedPreview && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setSelectedPreview(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.72)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 90,
            padding: isMobile ? 0 : 24,
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: isMobile ? '100%' : 'min(1120px, 100%)',
              height: isMobile ? '100%' : 'min(86vh, 780px)',
              maxHeight: isMobile ? '100%' : '92vh',
              display: 'grid',
              gridTemplateRows: isMobile ? '60px minmax(0, 1fr) auto' : 'auto minmax(0, 1fr)',
              gap: isMobile ? 0 : 12,
            }}
          >
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              alignItems: 'center',
              color: '#fff',
              padding: isMobile ? '0 16px' : 0,
              borderBottom: isMobile ? '1px solid rgba(255,255,255,0.12)' : 'none',
            }}>
              <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                <strong style={{ fontSize: isMobile ? 15 : 18, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedPreview.title}</strong>
                {!isMobile && (
                  <span style={{ fontSize: 13, color: '#eee2d4' }}>
                    By {submitterLabel(selectedPreview, user)} · {formatDate(selectedPreview.created_at)}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelectedPreview(null)}
                style={{
                  ...btnSecondary,
                  borderColor: 'rgba(255,255,255,0.55)',
                  background: 'rgba(255,255,255,0.12)',
                  color: '#fff',
                  flexShrink: 0,
                }}
              >
                Close
              </button>
            </div>
            <div
              style={{
                minHeight: 0,
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1fr) 320px',
                background: isMobile ? '#1a1714' : '#f8f4ec',
                borderRadius: isMobile ? 0 : 10,
                overflow: 'hidden',
                boxSizing: 'border-box',
                height: '100%',
              }}
            >
              <div
                style={{
                  minHeight: 0,
                  display: 'grid',
                  placeItems: 'center',
                  padding: isMobile ? 12 : 20,
                  boxSizing: 'border-box',
                  position: 'relative',
                  overflow: 'hidden',
                  minWidth: 0,
                  height: '100%',
                }}
              >
                <GalleryImage
                  src={resolveMaybeAssetUrl(selectedPreview.preview_image_url)}
                  alt={selectedPreview.title}
                  style={{
                    display: 'block',
                    position: 'absolute',
                    inset: isMobile ? 12 : 20,
                    width: isMobile ? 'calc(100% - 24px)' : 'calc(100% - 40px)',
                    height: isMobile ? 'calc(100% - 24px)' : 'calc(100% - 40px)',
                    objectFit: 'contain',
                    objectPosition: 'center center',
                  }}
                />
              </div>
              {!isMobile && (
                <aside
                  style={{
                    borderLeft: '1px solid #e7e1d8',
                    background: '#fffdf8',
                    padding: 20,
                    display: 'grid',
                    gridTemplateRows: 'auto auto 1fr auto',
                    gap: 18,
                    minHeight: 0,
                    boxSizing: 'border-box',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div
                      aria-hidden="true"
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: '50%',
                        display: 'grid',
                        placeItems: 'center',
                        border: '1px solid #d8d0c4',
                        background: '#f0ece5',
                        color: '#3f382f',
                        fontFamily: 'Georgia, "Times New Roman", serif',
                        fontSize: 15,
                        fontWeight: 700,
                        lineHeight: 1,
                      }}
                    >
                      {submitterInitials(submitterLabel(selectedPreview, user))}
                    </div>
                    <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                      <span style={{ fontSize: 11, color: '#8a8177', fontWeight: 700, textTransform: 'uppercase' }}>
                        Maker
                      </span>
                      <strong style={{ fontSize: 17, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {slugMap.get(selectedPreview.user_id) ? (
                          <Link href={`/gallery/${slugMap.get(selectedPreview.user_id)}`} style={{ color: 'inherit', textDecoration: 'none' }} onClick={() => setSelectedPreview(null)}>
                            {submitterLabel(selectedPreview, user)}
                          </Link>
                        ) : submitterLabel(selectedPreview, user)}
                      </strong>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gap: 8 }}>
                    <h2 style={{ margin: 0, fontSize: 22, lineHeight: 1.15 }}>{selectedPreview.title}</h2>
                    <span style={{ fontSize: 13, color: '#8a8177' }}>
                      Shared {formatDate(selectedPreview.created_at)}
                    </span>
                  </div>

                  <div style={{ display: 'grid', alignContent: 'start', gap: 14, minHeight: 0, overflowY: 'auto' }}>
                    <div style={{ display: 'grid', gap: 8 }}>
                      <span style={{ fontSize: 12, color: '#8a8177', fontWeight: 700 }}>Design details</span>
                      <div style={{ display: 'grid', gap: 6, fontSize: 13, color: '#5f574f' }}>
                        {(designSpecs(selectedPreview).length ? designSpecs(selectedPreview) : ['Finalized stitch design']).map((spec) => (
                          <span key={spec}>{spec}</span>
                        ))}
                      </div>
                      {selectedPreview.has_outline && (
                        <span style={{ fontSize: 12, color: '#4a7244', fontWeight: 600 }}>
                          ✓ 4&#34; finish outline applied
                        </span>
                      )}
                    </div>

                    {selectedPreview.palette && selectedPreview.palette.length > 0 && (
                      <div style={{ display: 'grid', gap: 8 }}>
                        <span style={{ fontSize: 12, color: '#8a8177', fontWeight: 700 }}>Colors used</span>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                          {selectedPreview.palette.map((color) => (
                            <div
                              key={color.hex}
                              title={`${color.dmc_code} — ${color.dmc_name}`}
                              style={{
                                width: 22,
                                height: 22,
                                borderRadius: '50%',
                                background: color.hex,
                                border: '1px solid rgba(0,0,0,0.12)',
                                flexShrink: 0,
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedPreview.tags.length > 0 && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {selectedPreview.tags.map((tag) => (
                          <span key={tag} style={{ border: '1px solid #e1d9ce', borderRadius: 999, padding: '3px 8px', fontSize: 12, color: '#6f675f' }}>
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'grid', gap: 8 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
                      <button type="button" onClick={() => void handleLike(selectedPreview)} style={btnPrimary}>
                        {selectedPreview.liked_by_me ? 'Liked' : 'Like'} · {selectedPreview.like_count}
                      </button>
                      <button type="button" onClick={() => void handleShare(selectedPreview)} style={{ ...btnSecondary, padding: '9px 11px', display: 'flex', alignItems: 'center', gap: 5 }} title="Share">
                        {shareToast
                          ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                          : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                        }
                        {selectedPreview.share_count > 0 && <span style={{ fontSize: 12 }}>{selectedPreview.share_count}</span>}
                      </button>
                    </div>
                    {(() => {
                      const canvas = selectedPreview.width_inches && selectedPreview.height_inches
                        ? getCanvasForDesign(selectedPreview.width_inches, selectedPreview.height_inches)
                        : null
                      const printPrice = canvas ? formatCents(2000 + canvas.priceCents) : null
                      return (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleUseTemplate(selectedPreview!)}
                            style={btnSecondary}
                          >
                            Use template
                          </button>
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
                          {checkoutError && <p style={{ margin: 0, fontSize: 12, color: '#b0453a' }}>{checkoutError}</p>}
                        </>
                      )
                    })()}
                  </div>
                </aside>
              )}
            </div>
            {isMobile && (
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 16px',
                borderTop: '1px solid rgba(255,255,255,0.12)',
                gap: 10,
              }}>
                <div style={{ display: 'grid', gap: 3, minWidth: 0 }}>
                  <span style={{ fontSize: 12, color: '#fff', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {submitterLabel(selectedPreview, user)}
                  </span>
                  <span style={{ fontSize: 11, color: '#b0a898' }}>
                    {designSpecs(selectedPreview).join(' · ') || formatDate(selectedPreview.created_at)}
                  </span>
                  {selectedPreview.has_outline && (
                    <span style={{ fontSize: 11, color: '#8fcf87' }}>✓ 4&#34; finish outline</span>
                  )}
                  {selectedPreview.palette && selectedPreview.palette.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 2 }}>
                      {selectedPreview.palette.map((color) => (
                        <div
                          key={color.hex}
                          title={`${color.dmc_code} — ${color.dmc_name}`}
                          style={{
                            width: 14,
                            height: 14,
                            borderRadius: '50%',
                            background: color.hex,
                            border: '1px solid rgba(255,255,255,0.2)',
                            flexShrink: 0,
                          }}
                        />
                      ))}
                    </div>
                  )}
                  {selectedPreview.tags.length > 0 && (
                    <span style={{ fontSize: 11, color: '#8a8177', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {selectedPreview.tags.map(t => `#${t}`).join(' ')}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => void handleLike(selectedPreview)}
                    style={{
                      ...btnSecondary,
                      borderColor: selectedPreview.liked_by_me ? '#6e8d67' : 'rgba(255,255,255,0.3)',
                      background: selectedPreview.liked_by_me ? '#dfe8dd' : 'rgba(255,255,255,0.1)',
                      color: selectedPreview.liked_by_me ? '#3f6b38' : '#fff',
                    }}
                  >
                    {selectedPreview.liked_by_me ? 'Liked' : 'Like'} · {selectedPreview.like_count}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {showLogoutConfirm && (
        <div role="dialog" aria-modal="true" onClick={() => setShowLogoutConfirm(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 41, padding: 18 }}>
          <div onClick={(event) => event.stopPropagation()} style={{ background: '#fffdf8', padding: 24, borderRadius: 12, width: 360, maxWidth: '100%', display: 'grid', gap: 14, boxSizing: 'border-box' }}>
            <div style={{ display: 'grid', gap: 6 }}>
              <h2 style={{ margin: 0 }}>Log out?</h2>
              <p style={{ margin: 0, color: '#8a8177', fontSize: 14 }}>
                You will need to log back in to like designs or post to the gallery.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setShowLogoutConfirm(false)} style={btnSecondary}>Cancel</button>
              <button type="button" onClick={() => { setShowLogoutConfirm(false); void signOut(); setShowAuthPrompt(true) }} style={btnPrimary}>Log out</button>
            </div>
          </div>
        </div>
      )}
      {showProfileModal && <ProfileModal onClose={() => setShowProfileModal(false)} />}
      <GuideDialog open={showGuideDialog} onClose={() => setShowGuideDialog(false)} />
    </div>
  )
}

export default function GalleryPageWrapper() {
  return (
    <Suspense>
      <GalleryPage />
    </Suspense>
  )
}
