function resolveApiBase() {
  const configuredBase = process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, '')
  if (configuredBase) return configuredBase

  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:8000`
  }

  return 'http://localhost:8000'
}

const API_BASE = resolveApiBase()

function jsonHeaders(accessToken?: string | null): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  }
}

function authHeaders(accessToken?: string | null): Record<string, string> {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
}

export type VisualizePayload = {
  image_url: string
  stitch_width: number
  stitch_height: number
  color_count: number
  show_grid: boolean
  clean_background: boolean
  simplify_colors: boolean
  strengthen_dark_detail: boolean
  preserve_accents: boolean
  mesh_count: number
  contrast_level: 'low' | 'normal' | 'high' | 'super_high' | 'super_super_high'
  source_type: 'photo' | 'stitched_photo' | 'graphic_art'
}

export type PaletteColor = {
  hex: string
  dmc_code: string
  dmc_name: string
}

export type DmcColor = {
  code: string
  name: string
  rgb: [number, number, number]
}

export type CanvasContext = {
  source_mode: string
  width_inches: number
  height_inches: number
  mesh_count: number
  color_count: number
  has_preview: boolean
  has_source_image: boolean
  palette: Array<{ dmc_code: string; name: string; hex: string }>
  clean_background: boolean
  simplify_colors: boolean
  strengthen_dark_detail: boolean
  preserve_accents: boolean
  contrast_level: string
  show_grid: boolean
}

export type ChatActionItem = {
  type: string
  value?: unknown
  from_codes?: string[]
  to_code?: string
  setting?: string
  url?: string
  width_inches?: number
  height_inches?: number
  mesh_count?: number
}

export type ChatResponse = {
  reply: string
  actions: ChatActionItem[]
  image_url?: string | null
}

export type ContentBounds = {
  width_inches: number
  height_inches: number
}

export type VisualizeResponse = {
  message: string
  stitch_preview_url: string
  palette: PaletteColor[]
  settings: Record<string, unknown>
  cells: string[][]
  content_bounds: ContentBounds | null
}


export async function uploadImage(file: File) {
  const formData = new FormData()
  formData.append('file', file)

  const res = await fetch(`${API_BASE}/upload`, {
    method: 'POST',
    body: formData,
  })

  if (!res.ok) {
    let message = 'Upload failed'
    try {
      const data = await res.json()
      message = data.detail ?? message
    } catch {}
    throw new Error(message)
  }
  return res.json()
}

export async function importImageFromUrl(imageUrl: string) {
  const res = await fetch(`${API_BASE}/import-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl }),
  })

  if (!res.ok) {
    let message = 'Import from URL failed'
    try {
      const data = await res.json()
      message = data.detail ?? message
    } catch {}
    throw new Error(message)
  }

  return res.json()
}

export async function createPreview(payload: VisualizePayload): Promise<VisualizeResponse> {
  const res = await fetch(`${API_BASE}/visualize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) throw new Error('Preview generation failed')
  return res.json()
}

export async function createPreviewV2(payload: VisualizePayload): Promise<VisualizeResponse> {
  const res = await fetch(`${API_BASE}/visualize/v2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) throw new Error('Preview generation failed (v2)')
  return res.json()
}

export async function fetchDmcColors(): Promise<PaletteColor[]> {
  const res = await fetch(`${API_BASE}/dmc-colors`)

  if (!res.ok) throw new Error('Unable to load DMC colors')

  const data: { colors: DmcColor[] } = await res.json()
  return data.colors.map((color) => ({
    hex: `#${color.rgb.map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`,
    dmc_code: color.code,
    dmc_name: color.name,
  }))
}

export async function chatAssistant(message: string, context?: CanvasContext): Promise<ChatResponse> {
  const res = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, context }),
  })

  if (!res.ok) {
    let errorMessage = 'Assistant request failed'
    try {
      const data = await res.json()
      errorMessage = data.detail ?? errorMessage
    } catch {}
    throw new Error(errorMessage)
  }

  return res.json()
}

export async function getChatSuggestions(context?: CanvasContext): Promise<string[]> {
  const res = await fetch(`${API_BASE}/chat/suggestions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context }),
  })

  if (!res.ok) return []

  const data = await res.json()
  return data.suggestions ?? []
}

export function assetUrl(path: string | null) {
  if (!path) return null
  if (/^https?:\/\//i.test(path)) return path
  return `${API_BASE}${path}`
}

export type FinalizePayload = {
  preview_url?: string | null
  width_inches: number
  height_inches: number
  mesh_count: number
  color_count: number
  contrast_level: 'low' | 'normal' | 'high' | 'super_high' | 'super_super_high'
  show_grid: boolean
  palette: PaletteColor[]
  cells: string[][]
  previous_pdf_url?: string | null
}

export type FinalizeResponse = {
  message: string
  pdf_url: string
  preview_image_url: string
}

export async function finalizePreview(payload: FinalizePayload): Promise<FinalizeResponse> {
  const res = await fetch(`${API_BASE}/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) throw new Error('Finalize failed')
  return res.json()
}

export type RecolorPayload = {
  image_url: string
  stitch_width: number
  stitch_height: number
  mesh_count: number
  show_grid: boolean
  selected_palette: PaletteColor[]
}

export type RecolorResponse = {
  message: string
  stitch_preview_url: string
  palette: PaletteColor[]
  cells: string[][]
}

export async function recolorPreview(payload: RecolorPayload): Promise<RecolorResponse> {
  const res = await fetch(`${API_BASE}/recolor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) throw new Error('Recolor failed')
  return res.json()
}

export type Project = {
  id: string
  created_at: string
  updated_at: string
  name: string
  finalized: boolean
  width_inches: number | null
  height_inches: number | null
  mesh_count: number | null
  color_count: number | null
  contrast_level: string | null
  source_type: string | null
  show_grid: boolean | null
  clean_background: boolean | null
  simplify_colors: boolean | null
  strengthen_dark_detail: boolean | null
  preserve_accents: boolean | null
  palette: PaletteColor[] | null
  cells: string[][] | null
  source_image_url: string | null
  preview_image_url: string | null
  pdf_url: string | null
}

export type ProjectSavePayload = Partial<Omit<Project, 'id' | 'created_at' | 'updated_at'>> & {
  name: string
}

export async function getProject(id: string, accessToken?: string | null): Promise<Project> {
  const res = await fetch(`${API_BASE}/projects/${id}`, {
    headers: authHeaders(accessToken),
  })
  if (!res.ok) throw new Error('Could not load project')
  return res.json()
}

export async function listProjects(accessToken?: string | null): Promise<Project[]> {
  const res = await fetch(`${API_BASE}/projects`, {
    headers: authHeaders(accessToken),
  })
  if (!res.ok) throw new Error('Could not load projects')
  return res.json()
}

export async function saveProject(payload: ProjectSavePayload, accessToken?: string | null): Promise<Project> {
  const res = await fetch(`${API_BASE}/projects`, {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail ?? 'Could not save project')
  }
  return res.json()
}

export async function updateProject(id: string, payload: Partial<ProjectSavePayload>, accessToken?: string | null): Promise<Project> {
  const res = await fetch(`${API_BASE}/projects/${id}`, {
    method: 'PATCH',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error('Could not update project')
  return res.json()
}

export async function deleteProject(id: string, accessToken?: string | null): Promise<void> {
  const res = await fetch(`${API_BASE}/projects/${id}`, {
    method: 'DELETE',
    headers: authHeaders(accessToken),
  })
  if (!res.ok) throw new Error('Could not delete project')
}

export type GalleryPaletteColor = {
  hex: string
  dmc_code: string
  dmc_name: string
}

export type GalleryItem = {
  id: string
  created_at: string
  user_id: string
  title: string
  tags: string[]
  submitter_name: string | null
  preview_image_url: string | null
  pdf_url: string
  width_inches: number | null
  height_inches: number | null
  mesh_count: number | null
  color_count: number | null
  palette: GalleryPaletteColor[] | null
  has_outline: boolean
  like_count: number
  liked_by_me: boolean
  share_count: number
  project_id: string | null
  parent_gallery_item_id: string | null
}

export type GalleryCreatePayload = {
  title: string
  tags: string[]
  submitter_name?: string | null
  preview_image_url?: string | null
  pdf_url: string
  width_inches?: number | null
  height_inches?: number | null
  mesh_count?: number | null
  color_count?: number | null
  palette?: GalleryPaletteColor[] | null
  has_outline?: boolean | null
  project_id?: string | null
  parent_gallery_item_id?: string | null
}

export async function listGalleryItems(
  options: { search?: string; sort?: 'recent' | 'popular'; accessToken?: string | null } = {},
): Promise<GalleryItem[]> {
  const params = new URLSearchParams()
  if (options.search) params.set('search', options.search)
  if (options.sort) params.set('sort', options.sort)
  const query = params.toString()
  const res = await fetch(`${API_BASE}/gallery${query ? `?${query}` : ''}`, {
    headers: authHeaders(options.accessToken),
  })
  if (!res.ok && options.accessToken) {
    const retry = await fetch(`${API_BASE}/gallery${query ? `?${query}` : ''}`)
    if (retry.ok) return retry.json()
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail ?? 'Could not load gallery')
  }
  return res.json()
}

export async function publishGalleryItem(payload: GalleryCreatePayload, accessToken?: string | null): Promise<GalleryItem> {
  const res = await fetch(`${API_BASE}/gallery`, {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail ?? 'Could not publish to gallery')
  }
  return res.json()
}

export async function incrementGalleryShare(id: string): Promise<GalleryItem> {
  const res = await fetch(`${API_BASE}/gallery/${id}/share`, { method: 'POST' })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { detail?: string }).detail ?? 'Could not record share')
  }
  return res.json()
}

export async function toggleGalleryLike(id: string, accessToken?: string | null): Promise<GalleryItem> {
  const res = await fetch(`${API_BASE}/gallery/${id}/like`, {
    method: 'POST',
    headers: authHeaders(accessToken),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail ?? 'Could not update like')
  }
  return res.json()
}

export async function fetchGalleryItemProject(itemId: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_BASE}/gallery/${itemId}/project`)
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { detail?: string }).detail ?? 'Could not load template project')
  }
  return res.json()
}

export async function fetchGalleryItemByProject(projectId: string): Promise<GalleryItem | null> {
  const res = await fetch(`${API_BASE}/gallery/by-project/${projectId}`)
  if (res.status === 404) return null
  if (!res.ok) return null
  return res.json()
}

export async function updateGalleryItem(
  itemId: string,
  payload: Partial<GalleryCreatePayload>,
  accessToken?: string | null,
): Promise<GalleryItem> {
  const res = await fetch(`${API_BASE}/gallery/${itemId}`, {
    method: 'PATCH',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { detail?: string }).detail ?? 'Could not update gallery item')
  }
  return res.json()
}

// ── Canvas pricing (mirrors backend canvas_pricing.py) ────────────────────────

const CANVAS_SIZES = [
  { label: '5×6"', canvasW: 5, canvasH: 6, priceCents: 900 },
  { label: '6×8"', canvasW: 6, canvasH: 8, priceCents: 1200 },
  { label: '8×12"', canvasW: 8, canvasH: 12, priceCents: 1400 },
] as const

export type CanvasSize = typeof CANVAS_SIZES[number]

export function getCanvasForDesign(widthInches: number, heightInches: number): CanvasSize | null {
  const cw = widthInches + 2
  const ch = heightInches + 2
  return (
    CANVAS_SIZES.find(
      (c) =>
        (cw <= c.canvasW && ch <= c.canvasH) ||
        (cw <= c.canvasH && ch <= c.canvasW),
    ) ?? null
  )
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`
}

// ── Checkout ──────────────────────────────────────────────────────────────────

export type CheckoutResponse = { client_secret: string }

export async function createPrintOwnCheckout(
  payload: { pdf_url: string; width_inches: number; height_inches: number; parent_gallery_item_id?: string | null },
  accessToken?: string | null,
): Promise<CheckoutResponse> {
  const res = await fetch(`${API_BASE}/checkout/print-own`, {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail ?? 'Could not create checkout session')
  }
  return res.json()
}

export async function createTemplateCheckout(galleryItemId: string): Promise<CheckoutResponse> {
  const res = await fetch(`${API_BASE}/checkout/template/${galleryItemId}`, {
    method: 'POST',
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail ?? 'Could not create checkout session')
  }
  return res.json()
}

// ── Creator profiles ──────────────────────────────────────────────────────────

export function slugify(name: string): string {
  return (
    name.toLowerCase().trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'creator'
  )
}

export function buildCreatorSlugMap(items: GalleryItem[]): Map<string, string> {
  const userFirstSeen: Record<string, string> = {}
  const userNames: Record<string, string> = {}
  for (const item of items) {
    const existing = userFirstSeen[item.user_id]
    if (!existing || item.created_at < existing) {
      userFirstSeen[item.user_id] = item.created_at
      userNames[item.user_id] = item.submitter_name || 'creator'
    }
  }
  const sortedUsers = Object.entries(userFirstSeen)
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([userId]) => userId)
  const slugGroups: Record<string, string[]> = {}
  for (const userId of sortedUsers) {
    const base = slugify(userNames[userId] || 'creator')
    if (!slugGroups[base]) slugGroups[base] = []
    slugGroups[base].push(userId)
  }
  const result = new Map<string, string>()
  for (const base of Object.keys(slugGroups)) {
    slugGroups[base].forEach((userId: string, i: number) => {
      result.set(userId, i === 0 ? base : `${base}-${i + 1}`)
    })
  }
  return result
}

export type CreatorProfile = {
  user_id: string
  submitter_name: string
  slug: string
  items: GalleryItem[]
}

export type CreatorEarnings = {
  template_sales: number
  print_sales: number
  total_cents: number
  paid_cents: number
  pending_cents: number
}

export async function getCreatorEarnings(accessToken: string): Promise<CreatorEarnings> {
  const res = await fetch(`${API_BASE}/gallery/creator/me/earnings`, {
    headers: authHeaders(accessToken),
  })
  if (!res.ok) throw new Error('Could not load earnings')
  return res.json()
}

export async function getMyCreatorProfile(accessToken: string): Promise<CreatorProfile & { slug: string | null }> {
  const res = await fetch(`${API_BASE}/gallery/creator/me`, {
    headers: authHeaders(accessToken),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { detail?: string }).detail ?? 'Could not load your profile')
  }
  return res.json()
}

export async function getCreatorProfile(slug: string, accessToken?: string | null): Promise<CreatorProfile> {
  const res = await fetch(`${API_BASE}/gallery/creator/${encodeURIComponent(slug)}`, {
    headers: authHeaders(accessToken),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { detail?: string }).detail ?? 'Could not load creator profile')
  }
  return res.json()
}

export async function createGalleryPrintCheckout(galleryItemId: string): Promise<CheckoutResponse> {
  const res = await fetch(`${API_BASE}/checkout/print-gallery/${galleryItemId}`, {
    method: 'POST',
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail ?? 'Could not create checkout session')
  }
  return res.json()
}
