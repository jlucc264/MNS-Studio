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
  source_type?: 'photo' | 'stitched_photo' | 'graphic_art'
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
  font_family?: 'sans' | 'serif' | 'script' | 'dancing-script' | 'pacifico' | 'playfair-display' | 'alfa-slab-one' | 'luckiest-guy'
  bold?: boolean
  italic?: boolean
  outline?: boolean
  orientation?: 'horizontal' | 'stacked' | 'down' | 'up'
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
  project_id?: string | null
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

export type PrintOrder = {
  id: string
  stripe_session_id: string
  order_type: string
  project_id: string | null
  gallery_item_id: string | null
  buyer_user_id: string | null
  title: string | null
  width_inches: number | null
  height_inches: number | null
  status?: string | null
  created_at?: string | null
  /** Set when a roll-print PDF was generated including this order. Not the
   *  same as printed — the canvas can still jam or come off short. */
  pdf_generated_at?: string | null
  printed_at?: string | null
}

/** Paid orders still waiting to be printed, oldest first. Admin only. */
export async function listPendingPrintOrders(accessToken: string): Promise<PrintOrder[]> {
  const res = await fetch(`${API_BASE}/admin/print-orders`, {
    headers: authHeaders(accessToken),
  })
  if (!res.ok) throw new Error('Could not load print orders')
  return res.json()
}

/** Orders confirmed printed, most recent first. Admin only. */
export async function listCompletedPrintOrders(accessToken: string, limit = 50): Promise<PrintOrder[]> {
  const res = await fetch(`${API_BASE}/admin/print-orders/completed?limit=${limit}`, {
    headers: authHeaders(accessToken),
  })
  if (!res.ok) throw new Error('Could not load completed orders')
  return res.json()
}

/** Retire orders — call once the canvas is off the roll and good. */
export async function markPrintOrdersPrinted(ids: string[], accessToken: string): Promise<void> {
  const res = await fetch(`${API_BASE}/admin/print-orders/mark-printed`, {
    method: 'POST',
    headers: { ...jsonHeaders(accessToken) },
    body: JSON.stringify({ print_order_ids: ids }),
  })
  if (!res.ok) throw new Error('Could not mark printed')
}

/** Undo — puts a completed order back in the queue to print again. */
export async function reopenPrintOrders(ids: string[], accessToken: string): Promise<void> {
  const res = await fetch(`${API_BASE}/admin/print-orders/reopen`, {
    method: 'POST',
    headers: { ...jsonHeaders(accessToken) },
    body: JSON.stringify({ print_order_ids: ids }),
  })
  if (!res.ok) throw new Error('Could not reopen order')
}

export type PrintRun = {
  id: string
  created_at: string
  roll_width_inches: number | null
  copies: number | null
  y_scale: number | null
  x_offset_inches: number | null
  skew_correction_inches: number | null
  side_margin_inches: number | null
  gap_inches: number | null
  logo_x_offset_inches: number | null
  logo_y_offset_inches: number | null
  include_alignment_test: boolean | null
  /** Total printed length. Every calibration value is relative to this — a
   *  skew of 0.3" means nothing without knowing it spanned 18". */
  page_length_inches: number | null
  project_ids: string[] | null
  print_order_ids: string[] | null
  designs: Array<{ label: string; mesh: number; printed_w_in: number; printed_h_in: number; rotated: boolean }> | null
  /** Whether this attempt actually printed correctly. Null until judged. */
  outcome?: 'good' | 'bad' | null
  outcome_note?: string | null
  outcome_at?: string | null
}

/** Record whether a run printed correctly. Pass null to clear a verdict. */
export async function setPrintRunOutcome(
  printRunId: string,
  outcome: 'good' | 'bad' | null,
  accessToken: string,
  note?: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/admin/print-runs/outcome`, {
    method: 'POST',
    headers: { ...jsonHeaders(accessToken) },
    body: JSON.stringify({ print_run_id: printRunId, outcome, outcome_note: note ?? null }),
  })
  if (!res.ok) throw new Error('Could not save print run outcome')
}

/** Recent roll-print runs, newest first. Admin only. */
export async function listPrintRuns(accessToken: string, limit = 25): Promise<PrintRun[]> {
  const res = await fetch(`${API_BASE}/admin/print-runs?limit=${limit}`, {
    headers: authHeaders(accessToken),
  })
  if (!res.ok) throw new Error('Could not load print runs')
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
  options: {
    search?: string
    sort?: 'recent' | 'popular'
    accessToken?: string | null
    offset?: number
    limit?: number
  } = {},
): Promise<GalleryItem[]> {
  const params = new URLSearchParams()
  if (options.search) params.set('search', options.search)
  if (options.sort) params.set('sort', options.sort)
  if (options.offset) params.set('offset', String(options.offset))
  if (options.limit) params.set('limit', String(options.limit))
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

export type Notification = {
  id: string
  created_at: string
  user_id: string
  type: 'like' | 'sale'
  gallery_item_id: string | null
  gallery_item_title: string | null
  actor_user_id: string | null
  read: boolean
}

export type NotificationsResponse = {
  items: Notification[]
  unread_count: number
}

export async function listNotifications(accessToken?: string | null): Promise<NotificationsResponse> {
  const res = await fetch(`${API_BASE}/notifications`, {
    headers: authHeaders(accessToken),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail ?? 'Could not load notifications')
  }
  return res.json()
}

export async function markNotificationsRead(accessToken?: string | null, ids?: string[]): Promise<void> {
  const res = await fetch(`${API_BASE}/notifications/read`, {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({ ids: ids ?? null }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail ?? 'Could not update notifications')
  }
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

// Canvas price is derived from a target gross margin on material rather than
// hand-set anchors — see Backend/app/services/canvas_pricing.py for the full
// rationale. ROLL_SELLABLE_SQ_IN already nets out the ~25% reprint loss, so
// cost per sellable sq in is simply cost / sellable area; do not re-apply it.
// Keep these three constants in sync with the backend.
const ROLL_COST_CENTS = 34_350        // $343.50 per 40" x 270" roll
const ROLL_SELLABLE_SQ_IN = 8_100     // 75% of gross; reprint loss removed
const TARGET_MATERIAL_MARGIN = 0.80

const PRICE_PER_SQ_IN_CENTS =
  (ROLL_COST_CENTS / ROLL_SELLABLE_SQ_IN) / (1 - TARGET_MATERIAL_MARGIN)
const MIN_CANVAS_PRICE_CENTS = 500

export const PRINT_OWN_BASE_CENTS = 700

// A gallery print costs this much more than printing your own, and the markup
// is passed to the creator 1:1 — so the business nets the same either way.
// Markup and creator share are equal only because the share is taken off the
// print-own base, not the marked-up total. See canvas_pricing.py.
export const GALLERY_MARKUP = 0.20
export const CREATOR_SHARE_OF_PRINT_OWN = 0.20

// Belts price off the legacy anchor curve x1.5, not the per-sq-in rate: the 2"
// margin per side turns a 1.25" strap into a 5" canvas, so a flat-rate belt
// would be ~80% margin the customer never sees.
const BELT_PRICE_MULTIPLIER = 1.5
const _LEGACY_ANCHORS: [number, number][] = [[30, 900], [48, 1200], [96, 1400]]

// The canvas line on the invoice: the whole item at TARGET_MATERIAL_MARGIN,
// less the fulfillment fee printOwnTotalCents adds back. The margin applies to
// canvas + fulfillment together, not the canvas alone — see canvas_price_cents
// in canvas_pricing.py. Floor applied after the subtraction so the smallest
// canvases still total $12.
function _canvasPriceCents(sqIn: number): number {
  const itemTotal = Math.round(PRICE_PER_SQ_IN_CENTS * sqIn)
  return Math.max(MIN_CANVAS_PRICE_CENTS, itemTotal - PRINT_OWN_BASE_CENTS)
}

function _legacyAnchorPriceCents(sqIn: number): number {
  if (sqIn <= _LEGACY_ANCHORS[0][0]) {
    const slope = (_LEGACY_ANCHORS[1][1] - _LEGACY_ANCHORS[0][1]) / (_LEGACY_ANCHORS[1][0] - _LEGACY_ANCHORS[0][0])
    return Math.max(MIN_CANVAS_PRICE_CENTS, Math.round(_LEGACY_ANCHORS[0][1] + slope * (sqIn - _LEGACY_ANCHORS[0][0])))
  }
  for (let i = 0; i < _LEGACY_ANCHORS.length - 1; i++) {
    const [a1sq, a1p] = _LEGACY_ANCHORS[i]
    const [a2sq, a2p] = _LEGACY_ANCHORS[i + 1]
    if (sqIn <= a2sq) return Math.round(a1p + ((sqIn - a1sq) / (a2sq - a1sq)) * (a2p - a1p))
  }
  const [a1sq, a1p] = _LEGACY_ANCHORS[_LEGACY_ANCHORS.length - 2]
  const [a2sq, a2p] = _LEGACY_ANCHORS[_LEGACY_ANCHORS.length - 1]
  return Math.round(a2p + ((a2p - a1p) / (a2sq - a1sq)) * (sqIn - a2sq))
}

function _beltCanvasPriceCents(sqIn: number): number {
  return Math.round(
    BELT_PRICE_MULTIPLIER * _legacyAnchorPriceCents(sqIn) + (BELT_PRICE_MULTIPLIER - 1) * PRINT_OWN_BASE_CENTS
  )
}

export type CanvasSize = { label: string; canvasW: number; canvasH: number; priceCents: number }

/** Mirrors canvas_margin_inches in canvas_pricing.py — keep the two in step. */
/** The design's real printed size: the bounding box of non-blank cells, in
 *  inches. Mirrors crop_to_content in pdf_generator.py, which is what the roll
 *  print actually renders — a stored width_inches/height_inches is the *canvas*
 *  the user was working on, which can be far larger than what they stitched.
 *  A finish outline counts: it prints as black stitches and takes up canvas. */
export function contentDimensionsInches(
  cells: string[][] | null | undefined,
  meshCount: number,
): { w: number; h: number } | null {
  if (!cells?.length || !cells[0]?.length) return null
  let minRow = cells.length, maxRow = -1, minCol = cells[0].length, maxCol = -1
  for (let r = 0; r < cells.length; r++) {
    for (let c = 0; c < cells[r].length; c++) {
      if (cells[r][c] === '__BLANK__') continue
      if (r < minRow) minRow = r
      if (r > maxRow) maxRow = r
      if (c < minCol) minCol = c
      if (c > maxCol) maxCol = c
    }
  }
  if (maxRow < 0) return { w: cells[0].length / meshCount, h: cells.length / meshCount }
  return { w: (maxCol - minCol + 1) / meshCount, h: (maxRow - minRow + 1) / meshCount }
}

export function canvasMarginInches(widthInches: number, heightInches: number): number {
  const short = Math.min(widthInches, heightInches)
  const affordable = (MAX_ROLL_WIDTH_INCHES - short) / 2
  return Math.max(MIN_CANVAS_MARGIN_INCHES, Math.min(CANVAS_MARGIN_INCHES, affordable))
}

export function getCanvasForDesign(widthInches: number, heightInches: number): CanvasSize {
  const margin = canvasMarginInches(widthInches, heightInches)
  const canvasW = Math.round((widthInches + 2 * margin) * 2) / 2
  const canvasH = Math.round((heightInches + 2 * margin) * 2) / 2
  const sqIn = canvasW * canvasH
  const fmt = (n: number) => n % 1 === 0 ? `${n}` : `${n.toFixed(1)}`
  return {
    label: `${fmt(canvasW)}×${fmt(canvasH)}"`,
    canvasW,
    canvasH,
    priceCents: isBeltDesign(widthInches, heightInches) ? _beltCanvasPriceCents(sqIn) : _canvasPriceCents(sqIn),
  }
}

export function printOwnTotalCents(canvas: CanvasSize): number {
  return PRINT_OWN_BASE_CENTS + canvas.priceCents
}

/** Print-own plus the creator markup. Derived from the print-own total so the
 *  two can never drift apart — do not reintroduce a separate gallery base fee. */
export function printGalleryTotalCents(canvas: CanvasSize): number {
  return Math.round(printOwnTotalCents(canvas) * (1 + GALLERY_MARKUP))
}

/** What the original designer earns on a gallery print. Mirrors
 *  creator_earnings_cents in canvas_pricing.py — taken off the print-own base,
 *  not the marked-up total, which is what makes the markup self-funding. */
export function creatorEarningsCents(galleryTotalCents: number): number {
  return Math.round((galleryTotalCents / (1 + GALLERY_MARKUP)) * CREATOR_SHARE_OF_PRINT_OWN)
}

// Widest roll the printer can feed. Mirrors MAX_ROLL_WIDTH_IN in canvas_pricing.py.
export const MAX_ROLL_WIDTH_INCHES = 19

// Unstitched canvas around the design: 2" preferred, 1" floor. Designs too wide
// for 2" per side get the margin trimmed rather than refused, which is what
// lets a 17" design print on the 19" roll. See canvasMarginInches.
export const CANVAS_MARGIN_INCHES = 2
export const MIN_CANVAS_MARGIN_INCHES = 1

// Max printable: short side is the roll minus the *minimum* margin on both
// edges; long side is the editor's 20" stage, since the long axis runs down the
// roll's unbounded feed direction.
export const MAX_PRINTABLE_SHORT_SIDE = MAX_ROLL_WIDTH_INCHES - 2 * MIN_CANVAS_MARGIN_INCHES // 17
export const MAX_PRINTABLE_LONG_SIDE = 20

// Belt mode: a long, narrow strip outside the normal short/long envelope
// above. Mirrors Backend/app/services/canvas_pricing.py — keep in sync.
export const BELT_HEIGHT_INCHES = 1.25
export const BELT_MESH_COUNT = 18
export const BELT_TAIL_INCHES = 4
export const BELT_MIN_LENGTH_IN = 20
export const BELT_MAX_LENGTH_IN = 60
const BELT_SHORT_MAX_IN = 1.75 // headroom above BELT_HEIGHT_INCHES for float drift
export const BELT_PANT_SIZES = [28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48] as const

export function beltLengthForPantSize(pantSize: number): number {
  return pantSize - BELT_TAIL_INCHES
}

/** A belt is narrow *and* long. Without the minimum length any small narrow
 *  design — a 1.5"x5" strip — was billed at belt rates, making it dearer than
 *  designs twice its size. Mirrors is_belt_design in canvas_pricing.py. */
export function isBeltDesign(widthInches: number, heightInches: number): boolean {
  const short = Math.min(widthInches, heightInches)
  const long = Math.max(widthInches, heightInches)
  return short <= BELT_SHORT_MAX_IN && long >= BELT_MIN_LENGTH_IN && long <= BELT_MAX_LENGTH_IN
}

// Self-serve envelope. A 10×6 design is a 14×10 canvas, which is what the flat
// $7 shipping is sized to cover. Larger designs still print and can still be
// designed and saved — they just can't be checked out or posted to the gallery.
// Mirrors STANDARD_MAX_* / is_standard_order in canvas_pricing.py.
export const STANDARD_MAX_SHORT_SIDE = 6
export const STANDARD_MAX_LONG_SIDE = 10

/** Whether a design can be bought self-serve and posted to the gallery.
 *  Narrower than isDesignPrintable, which only asks whether the roll can print
 *  it. Belts are exempt — long but narrow, and they ship in the same tube. */
export function isStandardOrder(widthInches: number, heightInches: number): boolean {
  if (isBeltDesign(widthInches, heightInches)) return true
  const short = Math.min(widthInches, heightInches)
  const long = Math.max(widthInches, heightInches)
  return short <= STANDARD_MAX_SHORT_SIDE && long <= STANDARD_MAX_LONG_SIDE
}

export const LARGE_PRINT_MESSAGE =
  `Designs larger than ${STANDARD_MAX_LONG_SIDE}" × ${STANDARD_MAX_SHORT_SIDE}" are printed to order — contact us for a quote on large prints.`

export function isDesignPrintable(widthInches: number, heightInches: number): boolean {
  if (isBeltDesign(widthInches, heightInches)) return true
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
  payload: { pdf_url: string; width_inches: number; height_inches: number; parent_gallery_item_id?: string | null; internal_pdf_supabase_path?: string | null; project_id?: string | null },
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

export async function saveMySignature(blob: Blob, accessToken: string, grid?: string[][]): Promise<{ image_url: string }> {
  const form = new FormData()
  form.append('file', blob, 'signature.png')
  if (grid) form.append('grid', JSON.stringify(grid))
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

export async function getProjectSku(projectId: string, accessToken: string): Promise<{ image_url: string | null }> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/sku`, {
    headers: authHeaders(accessToken),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { detail?: string }).detail ?? 'Could not load SKU')
  }
  return res.json()
}

export async function saveProjectSku(projectId: string, blob: Blob, accessToken: string, grid?: string[][]): Promise<{ image_url: string }> {
  const form = new FormData()
  form.append('file', blob, 'sku.png')
  if (grid) form.append('grid', JSON.stringify(grid))
  const res = await fetch(`${API_BASE}/projects/${projectId}/sku`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: form,
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { detail?: string }).detail ?? 'Could not save SKU')
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
    project_id: string | null
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

export interface RollPrintOptions {
  copies?: number
  /** Pending print-order ids to include. The backend marks these printed once
   *  the PDF generates, so passing them closes the fulfilment loop. */
  printOrderIds?: string[]
  /** Feed width of the roll loaded in the printer. Backend caps this at 19". */
  rollWidthInches?: number
  gapInches?: number
  /** Nudges the bottom-right signature for this print only, +x right, +y down.
   *  Backend clamps each to ±2". Does not affect the customer-facing PDF. */
  logoXOffsetInches?: number
  logoYOffsetInches?: number
  /** Margin drawn on the left/right edges. Omit to match the top/bottom canvas
   *  margin; 0 stops the imaged area at the design so the pre-cut roll edge is
   *  the only side margin. */
  sideMarginInches?: number | null
  xOffsetInches?: number
  skewCorrectionInches?: number
  yScale?: number
  includeAlignmentTest?: boolean
}

export async function downloadRollPrintPdf(
  projectIds: string[],
  accessToken: string,
  opts: RollPrintOptions = {},
): Promise<void> {
  const res = await fetch(`${API_BASE}/admin/roll-print`, {
    method: 'POST',
    headers: { ...jsonHeaders(accessToken) },
    body: JSON.stringify({
      project_ids: projectIds,
      print_order_ids: opts.printOrderIds ?? [],
      copies: opts.copies ?? 1,
      roll_width_inches: opts.rollWidthInches ?? MAX_ROLL_WIDTH_INCHES,
      gap_inches: opts.gapInches ?? 0,
      logo_x_offset_inches: opts.logoXOffsetInches ?? 0,
      logo_y_offset_inches: opts.logoYOffsetInches ?? 0,
      side_margin_inches: opts.sideMarginInches ?? null,
      x_offset_inches: opts.xOffsetInches ?? 0,
      skew_correction_inches: opts.skewCorrectionInches ?? 0,
      y_scale: opts.yScale ?? 1.0,
      include_alignment_test: opts.includeAlignmentTest ?? false,
    }),
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
