'use client'

import Link from 'next/link'
import Image from 'next/image'
import { type CSSProperties, useEffect, useMemo, useRef, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AuthPanel } from '../../components/AuthPanel'
import { useAuth } from '../../components/AuthProvider'
import { userDisplayName } from '../../components/UserAvatar'
import { NavAccountControls } from '../../components/NavAccountControls'
import { assetUrl, buildCreatorSlugMap, fetchGalleryItemProject, formatCents, getCanvasForDesign, incrementGalleryShare, isDesignPrintable, listGalleryItems, toggleGalleryLike, type GalleryItem } from '../../lib/api'
import { cartAdd, cartClear, useCart } from '../../lib/cart'
import { useCanvasCredit } from '../../lib/useCanvasCredit'
import { BREAKPOINTS, useIsMobile } from '../../lib/useViewport'
import CheckoutModal from '../../components/CheckoutModal'
import CartDrawer from '../../components/CartDrawer'
import OrderConfirmationModal from '../../components/OrderConfirmationModal'


const ORIGIN_TAGS = new Set(['remix', 'from photo', 'graphic art'])
const WELCOME_STORAGE_KEY = 'mns_welcome_seen'

const shimmerKeyframes = `
@keyframes gallery-shimmer {
  0% { background-position: -600px 0 }
  100% { background-position: 600px 0 }
}
`

function SkeletonCard({ isMobile }: { isMobile: boolean }) {
  const shimmer: CSSProperties = {
    background: 'linear-gradient(90deg, #ede8df 25%, #e2dbd0 50%, #ede8df 75%)',
    backgroundSize: '600px 100%',
    animation: 'gallery-shimmer 1.4s infinite linear',
  }
  if (isMobile) {
    return (
      <div style={{ background: '#fff' }}>
        <div style={{ aspectRatio: '1', width: '100%', ...shimmer }} />
        <div style={{ padding: '6px 8px 8px', display: 'grid', gap: 5 }}>
          <div style={{ height: 12, borderRadius: 4, width: '60%', ...shimmer }} />
          <div style={{ height: 10, borderRadius: 4, width: '40%', ...shimmer }} />
        </div>
      </div>
    )
  }
  return (
    <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid #e7e1d8' }}>
      <div style={{ aspectRatio: '1', width: '100%', ...shimmer }} />
      <div style={{ padding: 14, display: 'grid', gap: 8 }}>
        <div style={{ height: 16, borderRadius: 4, width: '55%', ...shimmer }} />
        <div style={{ height: 12, borderRadius: 4, width: '35%', ...shimmer }} />
      </div>
    </div>
  )
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

function GalleryImage({
  src,
  alt,
  inset = 0,
  fit = 'contain',
  placeholderText = 'Preview unavailable',
}: {
  src: string | null
  alt: string
  inset?: number
  fit?: 'contain' | 'cover'
  placeholderText?: string
}) {
  const [failed, setFailed] = useState(false)

  if (!src || failed) {
    return (
      <span
        style={{
          position: 'absolute',
          inset,
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
    <div style={{ position: 'absolute', inset }}>
      <Image
        src={src}
        alt={alt}
        fill
        sizes="(max-width: 768px) 40vw, 22vw"
        style={{ objectFit: fit, objectPosition: 'center' }}
        onError={() => setFailed(true)}
      />
    </div>
  )
}

function GalleryPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { session, user, signOut } = useAuth()
  const handledUrlItemRef = useRef<string | null>(null)
  const [items, setItems] = useState<GalleryItem[]>([])
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'recent' | 'popular'>('recent')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showAuthPrompt, setShowAuthPrompt] = useState(false)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [selectedPreview, setSelectedPreview] = useState<GalleryItem | null>(null)
  const isMobile = useIsMobile(BREAKPOINTS.tablet)
  const [checkoutError] = useState('')
  const [checkoutClientSecret, setCheckoutClientSecret] = useState<string | null>(null)
  const [showCartDrawer, setShowCartDrawer] = useState(false)
  const [showOrderConfirmation, setShowOrderConfirmation] = useState(false)
  const [addedToCartId, setAddedToCartId] = useState<string | null>(null)
  const [hasActiveDesign, setHasActiveDesign] = useState(false)
  const { count: cartCount } = useCart()
  const pendingCents = useCanvasCredit(session?.access_token)
  const [activeDraftName, setActiveDraftName] = useState('Untitled')
  const [shareToast, setShareToast] = useState(false)
  const [showWelcome, setShowWelcome] = useState(false)

  function dismissWelcome() {
    setShowWelcome(false)
    try { localStorage.setItem(WELCOME_STORAGE_KEY, '1') } catch {}
  }

  useEffect(() => {
    try {
      if (!localStorage.getItem(WELCOME_STORAGE_KEY)) setShowWelcome(true)
    } catch {}
  }, [])

  const slugMap = useMemo(() => buildCreatorSlugMap(items), [items])

  const popularThreshold = useMemo(() => {
    const sorted = [...items].map((i) => i.like_count).sort((a, b) => b - a)
    return Math.max(3, sorted[Math.floor(sorted.length * 0.1)] ?? 0)
  }, [items])

  const remixCountMap = useMemo(() => {
    const map = new Map<string, number>()
    items.forEach((item) => {
      if (item.parent_gallery_item_id)
        map.set(item.parent_gallery_item_id, (map.get(item.parent_gallery_item_id) ?? 0) + 1)
    })
    return map
  }, [items])

  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000


  useEffect(() => {
    if (!session) {
      setHasActiveDesign(false)
      return
    }
    try {
      const saved = localStorage.getItem('mns_active_design')
      if (!saved) return
      const d = JSON.parse(saved)
      setHasActiveDesign(!!(d.previewImagePath || d.cells?.length > 0))
      if (d.draftName) setActiveDraftName(d.draftName)
    } catch {}
  }, [session])


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
    if (!itemId || items.length === 0 || handledUrlItemRef.current === itemId) return
    handledUrlItemRef.current = itemId
    const found = items.find((i) => i.id === itemId)
    if (found) setSelectedPreview(prev => prev ?? found)
  }, [searchParams, items])

  useEffect(() => {
    if (searchParams.get('order') === 'success') {
      cartClear()
      setShowOrderConfirmation(true)
      router.replace('/gallery', { scroll: false })
    }
  }, [searchParams, router])


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

    let cells: string[][] | null = null
    if (item.project_id) {
      try {
        const project = await fetchGalleryItemProject(item.id)
        cells = (project as { cells?: string[][] }).cells ?? null
      } catch {
        // proceed without cells — user gets preview-only mode
      }
    }

    // Derive dimensions from the actual cell grid to avoid cascading shrink
    // (gallery stores content-bounds inches; cells give the true grid size)
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

  function handleAddToCart(item: GalleryItem) {
    if (!item.width_inches || !item.height_inches || !item.pdf_url) return
    const canvas = getCanvasForDesign(item.width_inches, item.height_inches)
    cartAdd({
      pdf_url: item.pdf_url,
      internal_pdf_supabase_path: null,
      width_inches: item.width_inches,
      height_inches: item.height_inches,
      quantity: 1,
      title: item.title || `${canvas.label} canvas`,
      canvas_label: canvas.label,
      canvas_price_cents: canvas.priceCents,
      base_price_cents: 1200,
      gallery_item_id: item.id,
      parent_gallery_item_id: null,
      project_id: null,
    })
    setSelectedPreview(null)
    setAddedToCartId(item.id)
    setTimeout(() => setAddedToCartId(null), 2000)
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
          height: 70,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: isMobile ? '0 14px' : '0 28px',
          borderBottom: '1px solid #5c7856',
          background: '#6e8d67',
          boxSizing: 'border-box',
          position: 'sticky',
          top: 0,
          zIndex: 50,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 12, minWidth: 0 }}>
          <Link href="/gallery" onClick={() => setSearch('')} style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', flexShrink: 0 }}>
            <div aria-hidden="true" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 9px)', gap: 3, padding: 2 }}>
              {Array.from({ length: 9 }, (_, i) => (
                <span key={i} style={{ width: 9, height: 9, border: '2px solid #fffdf8', borderRadius: 2, boxSizing: 'border-box' }} />
              ))}
            </div>
            <strong style={{ fontSize: 22, color: '#fffdf8' }}>MNS Studio</strong>
          </Link>
          {!isMobile && (
            <>
              <span style={{ color: 'rgba(255,255,255,0.5)', margin: '0 6px' }}>|</span>
              <div style={{ display: 'flex', gap: 24, color: '#fffdf8', fontWeight: 600, whiteSpace: 'nowrap' }}>
                <button type="button" onClick={() => setSearch('')} style={{ border: 0, background: 'none', font: 'inherit', fontWeight: 700, color: '#fffdf8', cursor: 'pointer', padding: 0 }}>Gallery</button>
                <Link href="/drafts" style={{ color: 'rgba(255,255,255,0.86)', textDecoration: 'none' }}>Your Studio</Link>
              </div>
            </>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 12, flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => setShowCartDrawer(true)}
            aria-label="Open cart"
            title="Cart"
            style={{ position: 'relative', border: '1px solid #d7d0c8', borderRadius: '50%', width: 30, height: 30, background: '#fffdf8', cursor: 'pointer', fontSize: 15, display: 'grid', placeItems: 'center', flexShrink: 0 }}
          >
            🛒
            {cartCount > 0 && (
              <span style={{ position: 'absolute', top: -4, right: -4, background: '#4a7244', color: '#fff', borderRadius: '50%', width: 16, height: 16, fontSize: 10, fontWeight: 700, display: 'grid', placeItems: 'center' }}>{cartCount}</span>
            )}
          </button>
          {session ? (
            <>
              <Link href="/contact" style={{ color: '#fffdf8', textDecoration: 'none', fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap' }}>
                Contact Us
              </Link>
              <NavAccountControls
                user={user}
                onProfile={() => {
                  const slug = user?.id ? slugMap.get(user.id) : undefined
                  if (slug) router.push(`/gallery/${slug}`)
                }}
                onLogout={() => setShowLogoutConfirm(true)}
                onStudio={() => router.push('/studio')}
                onAdmin={() => router.push('/admin')}
                pendingCents={pendingCents}
              />
            </>
          ) : (
            <>
              <Link href="/contact" style={{ color: '#fffdf8', textDecoration: 'none', fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap' }}>
                Contact Us
              </Link>
              <button type="button" onClick={() => setShowAuthPrompt(true)} style={{ ...btnSecondary, fontSize: isMobile ? 12 : 13, padding: isMobile ? '6px 10px' : '8px 13px' }}>
                Log in
              </button>
            </>
          )}
        </div>
      </nav>

      {hasActiveDesign && (
        <div style={{ background: '#eee7dc', borderBottom: '1px solid #d8cfc5', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center', flexWrap: 'wrap', textAlign: 'center' }}>
          <span style={{ color: '#5c4a3a', fontSize: 14 }}>Active design: <strong>{activeDraftName}</strong></span>
          <Link href="/studio" style={{ color: '#3f382f', fontWeight: 700, fontSize: 14 }}>Continue editing →</Link>
        </div>
      )}

      <div style={{ position: 'sticky', top: 72, zIndex: 40, background: '#f5f1ea', borderBottom: '1px solid #e7e1d8' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto', padding: isMobile ? '12px 12px 12px' : '14px 24px 14px', display: 'grid', gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: isMobile ? 20 : 28 }}>Gallery</h1>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by title, tag, or creator"
                style={{
                  width: '100%',
                  border: '1px solid #d7d0c8',
                  borderRadius: 8,
                  padding: search ? '9px 32px 9px 12px' : '9px 12px',
                  font: 'inherit',
                  fontSize: isMobile ? 14 : undefined,
                  background: '#fffdf8',
                  color: '#3f382f',
                  boxSizing: 'border-box',
                }}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                  style={{ position: 'absolute', right: 8, border: 0, background: 'none', cursor: 'pointer', fontSize: 16, color: '#9a9287', padding: 0, lineHeight: 1, display: 'grid', placeItems: 'center' }}
                >✕</button>
              )}
            </div>
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
          <>
            <style>{shimmerKeyframes}</style>
            {isMobile ? (
              <section style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 2 }}>
                {Array.from({ length: 8 }, (_, i) => <SkeletonCard key={i} isMobile={true} />)}
              </section>
            ) : (
              <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 16 }}>
                {Array.from({ length: 12 }, (_, i) => <SkeletonCard key={i} isMobile={false} />)}
              </section>
            )}
          </>
        ) : items.length === 0 ? (
          <div style={{ border: '1px solid #e7e1d8', borderRadius: 12, background: '#fffdf8', padding: 24, margin: isMobile ? '0 12px' : 0 }}>
            No shared designs yet.
          </div>
        ) : isMobile ? (
          <section style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 2 }}>
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
                    inset={6}
                    placeholderText="No preview"
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
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedPreview(item)}
                        onKeyDown={(e) => e.key === 'Enter' && setSelectedPreview(item)}
                        style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#3f382f', cursor: 'pointer' }}
                      >
                        {item.title}
                      </div>
                      <div style={{ fontSize: 11, color: '#8a8177', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {slugMap.get(item.user_id) ? (
                          <Link href={`/gallery/${slugMap.get(item.user_id)}`} style={{ color: 'inherit', textDecoration: 'none' }} onClick={(e) => e.stopPropagation()}>
                            {submitterLabel(item, user)}
                          </Link>
                        ) : submitterLabel(item, user)}
                      </div>
                      {(item.width_inches && item.height_inches) || item.mesh_count ? (
                        <div style={{ fontSize: 10, color: '#9a9287', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {[
                            item.width_inches && item.height_inches ? `${item.width_inches.toFixed(1)}" × ${item.height_inches.toFixed(1)}"` : null,
                            item.mesh_count ? `${item.mesh_count} mesh` : null,
                          ].filter(Boolean).join(' · ')}
                        </div>
                      ) : null}
                      {item.width_inches && item.height_inches && isDesignPrintable(item.width_inches, item.height_inches) && (
                        <div style={{ fontSize: 10, color: '#5a7a52', fontWeight: 600, marginTop: 1 }}>
                          Print from {formatCents(1200 + getCanvasForDesign(item.width_inches, item.height_inches).priceCents)}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end', flexShrink: 0 }}>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void handleShare(item) }}
                        title="Share"
                        style={{ border: 0, background: 'transparent', padding: '2px 0 0', cursor: 'pointer', color: '#8a8177', lineHeight: 1 }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                          <polyline points="16 6 12 2 8 6"/>
                          <line x1="12" y1="2" x2="12" y2="15"/>
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void handleLike(item) }}
                        style={{
                          border: 0,
                          background: 'transparent',
                          padding: 0,
                          cursor: 'pointer',
                          fontSize: 11,
                          fontWeight: 700,
                          color: item.liked_by_me ? '#4a7244' : '#8a8177',
                          lineHeight: 1,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 3,
                        }}
                      >
                        ♥{item.like_count > 0 ? ` ${item.like_count}` : ''}
                      </button>
                    </div>
                  </div>
                  {item.parent_gallery_item_id && (
                    <span style={{ fontSize: 9, color: '#8a8177', background: '#f0ece5', borderRadius: 999, padding: '1px 6px', marginTop: 2, display: 'inline-block' }}>↩ remix</span>
                  )}
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
                      />
                      {(() => {
                        const isNew = Date.now() - new Date(item.created_at).getTime() < sevenDaysMs
                        const isPopular = item.like_count >= popularThreshold && item.like_count > 0
                        const remixes = remixCountMap.get(item.id) ?? 0
                        const badges = [
                          isNew && { label: 'New', color: '#2a5f83', bg: '#ddeef8' },
                          isPopular && { label: 'Popular', color: '#6e4a0e', bg: '#fde8b0' },
                          remixes > 0 && { label: `Remixed ${remixes}×`, color: '#5a3e7a', bg: '#ede0f8' },
                        ].filter(Boolean) as { label: string; color: string; bg: string }[]
                        if (!badges.length) return null
                        return (
                          <div style={{ position: 'absolute', top: 7, left: 7, display: 'flex', gap: 4, flexWrap: 'wrap', pointerEvents: 'none' }}>
                            {badges.map((b) => (
                              <span key={b.label} style={{ fontSize: 9, fontWeight: 700, color: b.color, background: b.bg, borderRadius: 999, padding: '2px 7px', lineHeight: 1.6 }}>
                                {b.label}
                              </span>
                            ))}
                          </div>
                        )
                      })()}
                    </button>
                  ) : (
                    <span style={{ color: '#8a8177' }}>No preview</span>
                  )}
                </div>
                <div style={{ padding: 14, display: 'grid', gridTemplateRows: '1fr auto', gap: 10 }}>
                  <div style={{ display: 'grid', gap: 4, alignContent: 'start' }}>
                    <strong
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedPreview(item)}
                      onKeyDown={(e) => e.key === 'Enter' && setSelectedPreview(item)}
                      style={{ fontSize: 16, cursor: 'pointer' }}
                    >{item.title}</strong>
                    <span style={{ fontSize: 12, color: '#6f675f' }}>
                      By{' '}
                      {slugMap.get(item.user_id) ? (
                        <Link href={`/gallery/${slugMap.get(item.user_id)}`} style={{ color: 'inherit' }}>
                          {submitterLabel(item, user)}
                        </Link>
                      ) : submitterLabel(item, user)}
                      {' '}· {formatDate(item.created_at)}
                      {item.parent_gallery_item_id && (
                        <span style={{ marginLeft: 6, fontSize: 10, color: '#8a8177', background: '#f0ece5', borderRadius: 999, padding: '2px 7px' }}>↩ remix</span>
                      )}
                    </span>
                    {(item.width_inches && item.height_inches) || item.mesh_count || item.color_count ? (
                      <span style={{ fontSize: 11, color: '#8a8177' }}>
                        {[
                          item.width_inches && item.height_inches ? `${item.width_inches.toFixed(1)}" × ${item.height_inches.toFixed(1)}"` : null,
                          item.mesh_count ? `${item.mesh_count} mesh` : null,
                          item.color_count ? `${item.color_count} colors` : null,
                        ].filter(Boolean).join(' · ')}
                      </span>
                    ) : null}
                    {item.width_inches && item.height_inches && isDesignPrintable(item.width_inches, item.height_inches) && (
                      <span style={{ fontSize: 11, color: '#5a7a52', fontWeight: 600 }}>
                        Print from {formatCents(1200 + getCanvasForDesign(item.width_inches, item.height_inches).priceCents)}
                      </span>
                    )}
                  </div>
                  {item.tags.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {item.tags.map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => setSearch(tag)}
                          style={ORIGIN_TAGS.has(tag)
                            ? { border: '1px solid #b5ccb0', borderRadius: 999, padding: '1px 6px', fontSize: 9, color: '#4a7a42', background: '#f0f5ee', cursor: 'pointer', font: 'inherit' }
                            : { border: '1px solid #e1d9ce', borderRadius: 999, padding: '1px 6px', fontSize: 9, color: '#6f675f', background: 'transparent', cursor: 'pointer', font: 'inherit' }}
                        >
                          #{tag}
                        </button>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
                    <button
                      type="button"
                      onClick={() => void handleShare(item)}
                      style={{ ...btnSecondary, display: 'flex', alignItems: 'center', gap: 5 }}
                      title="Share"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                        <polyline points="16 6 12 2 8 6"/>
                        <line x1="12" y1="2" x2="12" y2="15"/>
                      </svg>
                      Share
                      {item.share_count > 0 && (
                        <span style={{ background: 'rgba(0,0,0,0.07)', borderRadius: 999, padding: '1px 6px', fontSize: 11 }}>
                          {item.share_count}
                        </span>
                      )}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </section>
        )}
      </main>

      {showWelcome && (
        <div role="dialog" aria-modal="true" aria-labelledby="welcome-dialog-title" onClick={dismissWelcome} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 95, padding: 18 }}>
          <div onClick={(event) => event.stopPropagation()} style={{ background: '#fffdf8', padding: 28, borderRadius: 14, width: 400, maxWidth: '100%', display: 'grid', gap: 16, boxSizing: 'border-box' }}>
            <div style={{ display: 'grid', gap: 8 }}>
              <h2 id="welcome-dialog-title" style={{ margin: 0, fontSize: 22 }}>Welcome to MNS Studio</h2>
              <p style={{ margin: 0, color: '#6f675f', fontSize: 14, lineHeight: 1.5 }}>
                Browse the gallery below for inspiration from other stitchers, or jump into Studio to turn a photo, screenshot, or your own artwork into a needlepoint or cross-stitch pattern.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => { dismissWelcome(); router.push('/studio') }} style={{ ...btnPrimary, flex: 1 }}>
                Start designing
              </button>
              <button type="button" onClick={dismissWelcome} style={btnSecondary}>
                Browse the gallery
              </button>
            </div>
          </div>
        </div>
      )}

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
                gridTemplateRows: 'minmax(0, 1fr)',
                background: isMobile ? '#1a1714' : '#f8f4ec',
                borderRadius: isMobile ? 0 : 10,
                overflow: 'hidden',
                boxSizing: 'border-box',
                height: '100%',
              }}
            >
              <div
                style={{
                  position: 'relative',
                  height: '100%',
                  overflow: 'hidden',
                  minWidth: 0,
                }}
              >
                {resolveMaybeAssetUrl(selectedPreview.preview_image_url) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={selectedPreview.id}
                    src={resolveMaybeAssetUrl(selectedPreview.preview_image_url)!}
                    alt={selectedPreview.title}
                    style={{
                      position: 'absolute',
                      inset: isMobile ? 12 : 20,
                      width: `calc(100% - ${isMobile ? 24 : 40}px)`,
                      height: `calc(100% - ${isMobile ? 24 : 40}px)`,
                      objectFit: 'contain',
                      objectPosition: 'center',
                      display: 'block',
                    }}
                  />
                ) : (
                  <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: isMobile ? '#b0a898' : '#8a8177', fontSize: 13 }}>No preview available</span>
                )}
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
                      {selectedPreview.parent_gallery_item_id && (() => {
                        const parent = items.find((i) => i.id === selectedPreview.parent_gallery_item_id)
                        if (!parent) return null
                        const parentSlug = slugMap.get(parent.user_id)
                        return (
                          <span style={{ fontSize: 12, color: '#7a6d5f' }}>
                            Remixed from{' '}
                            {parentSlug ? (
                              <Link href={`/gallery?item=${parent.id}`} style={{ color: '#5a7a52', textDecoration: 'underline' }} onClick={() => setSelectedPreview(parent)}>
                                {parent.title}
                              </Link>
                            ) : parent.title}
                            {parent.submitter_name ? ` by ${parent.submitter_name}` : ''}
                          </span>
                        )
                      })()}
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
                          <button
                            key={tag}
                            type="button"
                            onClick={() => { setSearch(tag); setSelectedPreview(null) }}
                            style={ORIGIN_TAGS.has(tag)
                              ? { border: '1px solid #b5ccb0', borderRadius: 999, padding: '1px 6px', fontSize: 9, color: '#4a7a42', background: '#f0f5ee', cursor: 'pointer', font: 'inherit' }
                              : { border: '1px solid #e1d9ce', borderRadius: 999, padding: '1px 6px', fontSize: 9, color: '#6f675f', background: 'transparent', cursor: 'pointer', font: 'inherit' }}
                          >
                            #{tag}
                          </button>
                        ))}
                      </div>
                    )}

                    {(() => {
                      const moreItems = items.filter(
                        (i) => i.user_id === selectedPreview.user_id && i.id !== selectedPreview.id
                      ).slice(0, 6)
                      if (!moreItems.length) return null
                      return (
                        <div style={{ display: 'grid', gap: 8 }}>
                          <span style={{ fontSize: 12, color: '#8a8177', fontWeight: 700 }}>More from this maker</span>
                          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
                            {moreItems.map((moreItem) => (
                              <button
                                key={moreItem.id}
                                type="button"
                                onClick={() => setSelectedPreview(moreItem)}
                                style={{
                                  flexShrink: 0,
                                  width: 68,
                                  height: 68,
                                  padding: 0,
                                  border: '1px solid #d8d0c4',
                                  borderRadius: 6,
                                  overflow: 'hidden',
                                  cursor: 'pointer',
                                  background: '#f0ece5',
                                  position: 'relative',
                                }}
                              >
                                <GalleryImage
                                  src={moreItem.preview_image_url}
                                  alt={moreItem.title}
                                  fit="cover"
                                />
                              </button>
                            ))}
                          </div>
                        </div>
                      )
                    })()}
                  </div>

                  <div style={{ display: 'grid', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => void handleLike(selectedPreview)}
                        style={{
                          ...btnPrimary,
                          flex: 1,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 7,
                          background: selectedPreview.liked_by_me ? '#4a7244' : '#6e8d67',
                          borderColor: selectedPreview.liked_by_me ? '#3f6b38' : '#5c7856',
                        }}
                      >
                        ♥ {selectedPreview.liked_by_me ? 'Liked' : 'Like'}
                        {selectedPreview.like_count > 0 && (
                          <span style={{ background: 'rgba(255,255,255,0.22)', borderRadius: 999, padding: '1px 6px', fontSize: 11 }}>
                            {selectedPreview.like_count}
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleShare(selectedPreview)}
                        style={{ ...btnSecondary, padding: '9px 11px', display: 'flex', alignItems: 'center', gap: 5 }}
                        title="Share"
                      >
                        {shareToast
                          ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                          : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                        }
                        {selectedPreview.share_count > 0 && (
                          <span style={{ background: 'rgba(0,0,0,0.07)', borderRadius: 999, padding: '1px 6px', fontSize: 11 }}>
                            {selectedPreview.share_count}
                          </span>
                        )}
                      </button>
                    </div>
                    {(() => {
                      const printable = selectedPreview.width_inches && selectedPreview.height_inches
                        ? isDesignPrintable(selectedPreview.width_inches, selectedPreview.height_inches)
                        : false
                      const canvas = printable && selectedPreview.width_inches && selectedPreview.height_inches
                        ? getCanvasForDesign(selectedPreview.width_inches, selectedPreview.height_inches)
                        : null
                      const printPrice = canvas ? formatCents(1200 + canvas.priceCents) : null
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
                            onClick={() => { handleAddToCart(selectedPreview); setShowCartDrawer(true) }}
                            disabled={!printPrice}
                            style={{
                              ...btnSecondary,
                              ...(printPrice ? {} : { color: '#8a8177', background: '#f4efe7', cursor: 'not-allowed' }),
                            }}
                          >
                            {addedToCartId === selectedPreview.id ? 'Added to cart!' : printPrice ? `Add to cart — ${printPrice}` : 'Print unavailable'}
                          </button>
                          {canvas && printPrice && (
                            <div style={{ fontSize: 11, color: '#8a8177', lineHeight: 1.5 }}>
                              <div style={{ fontWeight: 600, color: '#5f574f', marginBottom: 2 }}>Mono Deluxe Zweigart Canvas</div>
                              <div>{canvas.label} canvas — {formatCents(canvas.priceCents)}</div>
                              <div>Printing &amp; fulfillment — {formatCents(1200)}</div>
                              <div>Shipping — {formatCents(700)}</div>
                            </div>
                          )}
                          {canvas && printPrice && (
                            <div style={{ fontSize: 11, color: '#8a8177' }}>Ships within 5–7 business days</div>
                          )}
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
                display: 'grid',
                borderTop: '1px solid rgba(255,255,255,0.12)',
                background: '#1a1714',
              }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  padding: '10px 16px 8px',
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
                      <span style={{ fontSize: 11, color: '#8fcf87' }}>✓ 4&quot; finish outline</span>
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
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button
                      type="button"
                      onClick={() => void handleLike(selectedPreview)}
                      style={{
                        ...btnSecondary,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        borderColor: selectedPreview.liked_by_me ? '#6e8d67' : 'rgba(255,255,255,0.3)',
                        background: selectedPreview.liked_by_me ? '#dfe8dd' : 'rgba(255,255,255,0.1)',
                        color: selectedPreview.liked_by_me ? '#3f6b38' : '#fff',
                      }}
                    >
                      ♥ {selectedPreview.liked_by_me ? 'Liked' : 'Like'}
                      {selectedPreview.like_count > 0 && (
                        <span style={{ background: 'rgba(0,0,0,0.10)', borderRadius: 999, padding: '1px 6px', fontSize: 11 }}>
                          {selectedPreview.like_count}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleShare(selectedPreview)}
                      title="Share"
                      style={{
                        ...btnSecondary,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        borderColor: 'rgba(255,255,255,0.3)',
                        background: 'rgba(255,255,255,0.1)',
                        color: '#fff',
                        padding: '8px 11px',
                      }}
                    >
                      {shareToast
                        ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                      }
                      {selectedPreview.share_count > 0 && (
                        <span style={{ background: 'rgba(0,0,0,0.10)', borderRadius: 999, padding: '1px 6px', fontSize: 11 }}>
                          {selectedPreview.share_count}
                        </span>
                      )}
                    </button>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, padding: '0 16px 14px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => void handleUseTemplate(selectedPreview!)}
                    style={{ ...btnSecondary, flex: 1, borderColor: 'rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.1)', color: '#fff' }}
                  >
                    Use template
                  </button>
                  {(() => {
                    const printable = selectedPreview.width_inches && selectedPreview.height_inches
                      ? isDesignPrintable(selectedPreview.width_inches, selectedPreview.height_inches)
                      : false
                    const canvas = printable && selectedPreview.width_inches && selectedPreview.height_inches
                      ? getCanvasForDesign(selectedPreview.width_inches, selectedPreview.height_inches)
                      : null
                    const printPrice = canvas ? formatCents(1200 + canvas.priceCents) : null
                    return (
                      <button
                        type="button"
                        onClick={() => { handleAddToCart(selectedPreview); setShowCartDrawer(true) }}
                        disabled={!printPrice}
                        style={{
                          ...btnSecondary,
                          flex: 1,
                          borderColor: printPrice ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)',
                          background: printPrice ? 'rgba(255,255,255,0.1)' : 'transparent',
                          color: printPrice ? '#fff' : '#6f675f',
                          cursor: printPrice ? 'pointer' : 'not-allowed',
                        }}
                      >
                        {addedToCartId === selectedPreview.id ? 'Added!' : printPrice ? `Add to cart — ${printPrice}` : 'Print unavailable'}
                      </button>
                    )
                  })()}
                </div>
                {(() => {
                  const printable = selectedPreview.width_inches && selectedPreview.height_inches
                    ? isDesignPrintable(selectedPreview.width_inches, selectedPreview.height_inches)
                    : false
                  const canvas = printable && selectedPreview.width_inches && selectedPreview.height_inches
                    ? getCanvasForDesign(selectedPreview.width_inches, selectedPreview.height_inches)
                    : null
                  const printPrice = canvas ? formatCents(1200 + canvas.priceCents) : null
                  return canvas && printPrice ? (
                    <>
                      <div style={{ margin: '0 16px 6px', fontSize: 11, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5 }}>
                        <span style={{ fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>Mono Deluxe Zweigart Canvas</span>
                        {' · '}{canvas.label} ({formatCents(canvas.priceCents)}) + printing &amp; fulfillment ({formatCents(1200)}) + shipping ({formatCents(700)})
                      </div>
                      <div style={{ margin: '0 16px 10px', fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>Ships within 5–7 business days</div>
                    </>
                  ) : null
                })()}
                {checkoutError && (
                  <p style={{ margin: '0 16px 10px', fontSize: 12, color: '#f08080' }}>{checkoutError}</p>
                )}
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
              {hasActiveDesign ? (
                <p style={{ margin: 0, color: '#8a8177', fontSize: 14 }}>
                  <strong>{activeDraftName}</strong> is still open. Logging out will discard it — go to the studio to save it as a draft first.
                </p>
              ) : (
                <p style={{ margin: 0, color: '#8a8177', fontSize: 14 }}>
                  You will need to log back in to like designs or post to the gallery.
                </p>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setShowLogoutConfirm(false)} style={btnSecondary}>Cancel</button>
              {hasActiveDesign && (
                <button type="button" onClick={() => { setShowLogoutConfirm(false); router.push('/studio') }} style={btnSecondary}>Go to studio</button>
              )}
              <button type="button" onClick={() => { setShowLogoutConfirm(false); localStorage.removeItem('mns_active_design'); void signOut(); setShowAuthPrompt(true) }} style={btnPrimary}>Log out anyway</button>
            </div>
          </div>
        </div>
      )}
      <OrderConfirmationModal open={showOrderConfirmation} onClose={() => setShowOrderConfirmation(false)} />
      {checkoutClientSecret && (
        <CheckoutModal
          clientSecret={checkoutClientSecret}
          onClose={() => setCheckoutClientSecret(null)}
        />
      )}
      <CartDrawer
        open={showCartDrawer}
        onClose={() => setShowCartDrawer(false)}
        accessToken={session?.access_token ?? null}
        onCheckoutReady={(secret) => setCheckoutClientSecret(secret)}
        pendingCents={pendingCents}
      />
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
