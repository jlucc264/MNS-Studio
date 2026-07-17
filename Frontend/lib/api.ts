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
  source_image_url?: string
  palette: Array<{ dmc_code: string; name: string; hex: string }>
  clean_background: boolean
  simplify_colors: boolean
  strengthen_dark_detail: boolean
  preserve_accents: boolean
  contrast_level: string
  show_grid: boolean
  has_selection: boolean
  grid_rows: number
  grid_cols: number
  preview_image_url?: string
}

export type ChatActionItem = {
  type: string
  value?: unknown
  from_codes?: string[]
  to_code?: string
  setting?: string
  url?: string
  width_inches?: number | null
  height_inches?: number | null
  mesh_count?: number | null
  // draw_shape
  shape?: 'box' | 'arc' | 'line'
  r1?: number
  c1?: number
  r2?: number
  c2?: number
  fill_color?: string
  border_color?: string
  border_size?: number
  full_circle?: boolean
  // add_text
  text?: string
  row?: number
  col?: number
  color?: string
  font_size?: 'small' | 'medium' | 'large'
  font_family?: 'sans' | 'serif'
  bold?: boolean
  italic?: boolean
  outline?: boolean
  // flood_fill (row/col/color shared with add_text above)
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

async function throwVisualizeError(res: Response, label: string): Promise<never> {
  let detail = ''
  try {
    const data = await res.json()
    detail = Array.isArray(data.detail)
      ? data.detail.map((e: { loc?: Array<string | number>; msg?: string }) => {
          const field = e.loc?.filter((part) => part !== 'body').join('.')
          const message = e.msg ?? JSON.stringify(e)
          return field ? `${field}: ${message}` : message
        }).join('; ')
      : (data.detail ?? data.message ?? '')
  } catch {}
  throw new Error(`${label}${detail ? `: ${detail}` : ''}`)
}

export async function createPreview(payload: VisualizePayload): Promise<VisualizeResponse> {
  const res = await fetch(`${API_BASE}/visualize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) await throwVisualizeError(res, 'Preview generation failed')
  return res.json()
}

export async function createPreviewV2(payload: VisualizePayload): Promise<VisualizeResponse> {
  const res = await fetch(`${API_BASE}/visualize/v2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) await throwVisualizeError(res, 'Preview generation failed')
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

export type ChatHistoryMessage = { role: 'user' | 'assistant'; content: string }

export async function chatAssistant(message: string, context?: CanvasContext, history?: ChatHistoryMessage[]): Promise<ChatResponse> {
  const res = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, context, history: history ?? [] }),
  })

  if (!res.ok) {
    let errorMessage = 'Assistant request failed'
    try {
      const data = await res.json()
      const detail = data.detail
      errorMessage = Array.isArray(detail)
        ? detail.map((e: { msg?: string }) => e.msg ?? JSON.stringify(e)).join('; ')
        : (typeof detail === 'string' ? detail : errorMessage)
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
  internal_pdf_supabase_path?: string | null
}

export async function finalizePreview(payload: FinalizePayload, accessToken?: string | null): Promise<FinalizeResponse> {
  const res = await fetch(`${API_BASE}/finalize`, {
    method: 'POST',
    headers: jsonHeaders(accessToken),
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

export type GridRenderPayload = {
  image_url: string
  stitch_width: number
  stitch_height: number
  mesh_count: number
  show_grid: boolean
  palette: PaletteColor[]
}

export type GridRenderResponse = {
  message: string
  stitch_preview_url: string
  palette: PaletteColor[]
  cells: string[][]
}

export async function gridRender(payload: GridRenderPayload): Promise<GridRenderResponse> {
  const res = await fetch(`${API_BASE}/grid-render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error('Grid render failed')
  return res.json()
}

export type ImportPatternPayload = {
  image_url: string
  stitch_width?: number
  stitch_height?: number
  snap_to_dmc?: boolean
}

export type ImportPatternResponse = {
  message: string
  cells: string[][]
  palette: PaletteColor[]
  stitch_width: number
  stitch_height: number
  snapped_color_count: number
}

export class ImportPatternError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export async function importPatternImage(payload: ImportPatternPayload): Promise<ImportPatternResponse> {
  const res = await fetch(`${API_BASE}/import-pattern-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (res.status === 422) {
    const body = await res.json().catch(() => null)
    const detail = body?.detail
    throw new ImportPatternError(detail?.code ?? 'invalid', detail?.message ?? 'Pattern import failed')
  }
  if (!res.ok) throw new Error('Pattern import failed')
  return res.json()
}

export type ImportStitchlyResponse = {
  message: string
  cells: string[][]
  palette: PaletteColor[]
  stitch_width: number
  stitch_height: number
  mesh_count: number | null
  pattern_name: string | null
  source_image_url: string | null
  preview_image_url: string | null
  unknown_codes: string[]
  backstitch_count: number
  point_stitch_count: number
}

export async function importStitchlyFile(file: File): Promise<ImportStitchlyResponse> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${API_BASE}/import-stitchly`, { method: 'POST', body: form })
  if (res.status === 422) {
    const body = await res.json().catch(() => null)
    throw new ImportPatternError(body?.detail?.code ?? 'unreadable', body?.detail?.message ?? 'Could not read this .stitchly file')
  }
  if (!res.ok) throw new Error('Stitchly import failed')
  return res.json()
}

export async function nearestDmc(hex: string): Promise<PaletteColor> {
  const res = await fetch(`${API_BASE}/nearest-dmc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hex }),
  })
  if (!res.ok) throw new Error('Nearest DMC lookup failed')
  return res.json()
}

export type SamplePixelPayload = {
  image_url: string
  col: number
  row: number
  stitch_width: number
  stitch_height: number
}

export async function samplePixel(payload: SamplePixelPayload): Promise<PaletteColor> {
  const res = await fetch(`${API_BASE}/sample-pixel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error('Pixel sample failed')
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
  parent_gallery_item_id: string | null
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

const _PRICING_ANCHORS: [number, number][] = [
  [30, 900],   // 5×6  = $9
  [48, 1200],  // 6×8  = $12
  [96, 1400],  // 8×12 = $14
]

function _interpolatePriceCents(sqIn: number): number {
  if (sqIn <= _PRICING_ANCHORS[0][0]) {
    const slope = (_PRICING_ANCHORS[1][1] - _PRICING_ANCHORS[0][1]) / (_PRICING_ANCHORS[1][0] - _PRICING_ANCHORS[0][0])
    return Math.max(500, Math.round(_PRICING_ANCHORS[0][1] + slope * (sqIn - _PRICING_ANCHORS[0][0])))
  }
  for (let i = 0; i < _PRICING_ANCHORS.length - 1; i++) {
    const [a1sq, a1p] = _PRICING_ANCHORS[i]
    const [a2sq, a2p] = _PRICING_ANCHORS[i + 1]
    if (sqIn <= a2sq) {
      const t = (sqIn - a1sq) / (a2sq - a1sq)
      return Math.round(a1p + t * (a2p - a1p))
    }
  }
  const [a1sq, a1p] = _PRICING_ANCHORS[_PRICING_ANCHORS.length - 2]
  const [a2sq, a2p] = _PRICING_ANCHORS[_PRICING_ANCHORS.length - 1]
  const slope = (a2p - a1p) / (a2sq - a1sq)
  return Math.round(a2p + slope * (sqIn - a2sq))
}

export type CanvasSize = { label: string; canvasW: number; canvasH: number; priceCents: number }

export function getCanvasForDesign(widthInches: number, heightInches: number): CanvasSize {
  const canvasW = Math.round((widthInches + 4) * 2) / 2
  const canvasH = Math.round((heightInches + 4) * 2) / 2
  const fmt = (n: number) => n % 1 === 0 ? `${n}` : `${n.toFixed(1)}`
  return {
    label: `${fmt(canvasW)}×${fmt(canvasH)}"`,
    canvasW,
    canvasH,
    priceCents: _interpolatePriceCents(canvasW * canvasH),
  }
}

// Max printable: short side ≤ 13" (roll width), long side ≤ 20" (editor stage)
export const MAX_PRINTABLE_SHORT_SIDE = 13
export const MAX_PRINTABLE_LONG_SIDE = 20

export function isDesignPrintable(widthInches: number, heightInches: number): boolean {
  const short = Math.min(widthInches, heightInches)
  const long = Math.max(widthInches, heightInches)
  return short <= MAX_PRINTABLE_SHORT_SIDE && long <= MAX_PRINTABLE_LONG_SIDE
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`
}

// ── Checkout ──────────────────────────────────────────────────────────────────

export type CheckoutResponse = { client_secret: string }

export async function createPrintOwnCheckout(
  payload: { pdf_url: string; width_inches: number; height_inches: number; parent_gallery_item_id?: string | null; internal_pdf_supabase_path?: string | null },
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

export async function updateMyCreatorName(
  submitterName: string,
  accessToken: string,
): Promise<CreatorProfile & { slug: string | null }> {
  const res = await fetch(`${API_BASE}/gallery/creator/me`, {
    method: 'PATCH',
    headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ submitter_name: submitterName }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { detail?: string }).detail ?? 'Could not update creator name')
  }
  return res.json()
}

export async function getMySignature(accessToken: string): Promise<{ image_url: string | null }> {
  const res = await fetch(`${API_BASE}/profile/signature`, {
    headers: authHeaders(accessToken),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { detail?: string }).detail ?? 'Could not load signature')
  }
  return res.json()
}

export async function saveMySignature(blob: Blob, accessToken: string): Promise<{ image_url: string }> {
  const form = new FormData()
  form.append('file', blob, 'signature.png')
  const res = await fetch(`${API_BASE}/profile/signature`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: form,
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { detail?: string }).detail ?? 'Could not save signature')
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

export async function createCartCheckout(
  items: Array<{
    pdf_url: string
    internal_pdf_supabase_path: string | null
    width_inches: number
    height_inches: number
    quantity: number
    gallery_item_id: string | null
    parent_gallery_item_id: string | null
  }>,
  accessToken: string,
  useCredit = true,
): Promise<CheckoutResponse> {
  const res = await fetch(`${API_BASE}/checkout/cart`, {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({ items, use_credit: useCredit }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail ?? 'Could not create checkout session')
  }
  return res.json()
}

export async function downloadBlankRollPdf(accessToken: string, height = 4): Promise<void> {
  const res = await fetch(`${API_BASE}/admin/blank-roll-pdf?height=${height}`, {
    headers: authHeaders(accessToken),
  })
  if (!res.ok) throw new Error('Failed to generate blank roll PDF')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

export async function downloadRegistrationTestPdf(accessToken: string): Promise<void> {
  const res = await fetch(`${API_BASE}/admin/registration-test-pdf`, {
    headers: authHeaders(accessToken),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { detail?: string }).detail ?? 'Failed to generate registration test PDF')
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'mns_registration_test.pdf'
  a.click()
  URL.revokeObjectURL(url)
}

export async function downloadCalibrationPdf(accessToken: string, nozzle = true, cellSize = 1, rows?: number, header = true, instructions = true): Promise<void> {
  const params = new URLSearchParams({ nozzle: String(nozzle), cell_size: String(cellSize), header: String(header), instructions: String(instructions) })
  if (rows != null) params.set('rows', String(rows))
  const res = await fetch(`${API_BASE}/admin/calibration-pdf?${params}`, {
    headers: authHeaders(accessToken),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { detail?: string }).detail ?? 'Failed to generate calibration PDF')
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'mns_calibration.pdf'
  a.click()
  URL.revokeObjectURL(url)
}

export async function downloadRollPrintPdf(
  projectIds: string[],
  copies: number,
  accessToken: string,
  xOffsetInches: number = 0,
  skewCorrectionInches: number = 0,
  yScale: number = 1.0,
): Promise<void> {
  const res = await fetch(`${API_BASE}/admin/roll-print`, {
    method: 'POST',
    headers: { ...jsonHeaders(accessToken) },
    body: JSON.stringify({ project_ids: projectIds, copies, x_offset_inches: xOffsetInches, skew_correction_inches: skewCorrectionInches, y_scale: yScale }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { detail?: string }).detail ?? 'Failed to generate roll print PDF')
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'mns_roll_print.pdf'
  a.click()
  URL.revokeObjectURL(url)
}
