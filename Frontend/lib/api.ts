function resolveApiBase() {
  const configuredBase = process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, '')
  if (configuredBase) return configuredBase

  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:8000`
  }

  return 'http://localhost:8000'
}

export const API_BASE = resolveApiBase()

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
  /** How the design was actually created — 'blank' (from-scratch canvas) or
   *  'import' (photo/graphic/pattern import). Null for projects saved before
   *  this field existed. Distinct from source_type, which is a stitching
   *  algorithm hint that defaults to 'photo' even for a blank canvas. */
  design_origin: 'blank' | 'import' | null
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
  /** Null for orders placed before this was tracked, or if the Stripe
   *  backfill couldn't recover a price for it. */
  amount_total_cents?: number | null
  /** The buyer chose a narrower border to drop a roll tier, and the margin
   *  they were priced at. The operator has to load that narrower stock:
   *  re-deriving the margin from width/height gives the standard 2" and a
   *  canvas that doesn't fit the roll it was sold for. Null margin means the
   *  default, i.e. every order placed before the option existed. */
  tier_downgrade?: boolean | null
  canvas_margin_inches?: number | null
  /** Resolved from the underlying gallery listing or project — never stored
   *  on the order itself. Null if both have since been deleted. */
  mesh_count?: number | null
}

export type ExpenseTemplate = {
  id: string
  created_at: string
  name: string
  category: string | null
  default_amount_cents: number | null
  notes: string | null
  archived: boolean
}

export type Expense = {
  id: string
  created_at: string
  template_id: string | null
  name: string
  category: string | null
  amount_cents: number
  incurred_on: string
  notes: string | null
}

export type SpendSummary = {
  revenue_cents: number
  expenses_cents: number
  net_cents: number
  order_count: number
  expense_count: number
  orders_missing_amount: number
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

/** Every order in a date range regardless of print status — the revenue view. */
export async function listOrdersInRange(accessToken: string, start?: string, end?: string): Promise<PrintOrder[]> {
  const params = new URLSearchParams()
  if (start) params.set('start', start)
  if (end) params.set('end', end)
  const res = await fetch(`${API_BASE}/admin/orders?${params}`, {
    headers: authHeaders(accessToken),
  })
  if (!res.ok) throw new Error('Could not load orders')
  return res.json()
}

export async function getSpendSummary(accessToken: string, start?: string, end?: string): Promise<SpendSummary> {
  const params = new URLSearchParams()
  if (start) params.set('start', start)
  if (end) params.set('end', end)
  const res = await fetch(`${API_BASE}/admin/spend/summary?${params}`, {
    headers: authHeaders(accessToken),
  })
  if (!res.ok) throw new Error('Could not load spend summary')
  return res.json()
}

export async function listExpenseTemplates(accessToken: string, includeArchived = false): Promise<ExpenseTemplate[]> {
  const res = await fetch(`${API_BASE}/admin/expense-templates?include_archived=${includeArchived}`, {
    headers: authHeaders(accessToken),
  })
  if (!res.ok) throw new Error('Could not load expense templates')
  return res.json()
}

export async function createExpenseTemplate(
  accessToken: string,
  data: { name: string; category?: string | null; default_amount_cents?: number | null; notes?: string | null },
): Promise<ExpenseTemplate> {
  const res = await fetch(`${API_BASE}/admin/expense-templates`, {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Could not create expense template')
  return res.json()
}

export async function updateExpenseTemplate(
  accessToken: string,
  id: string,
  data: Partial<Pick<ExpenseTemplate, 'name' | 'category' | 'default_amount_cents' | 'notes' | 'archived'>>,
): Promise<void> {
  const res = await fetch(`${API_BASE}/admin/expense-templates/${id}`, {
    method: 'PATCH',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Could not update expense template')
}

export async function deleteExpenseTemplate(accessToken: string, id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/admin/expense-templates/${id}`, {
    method: 'DELETE',
    headers: authHeaders(accessToken),
  })
  if (!res.ok) throw new Error('Could not delete expense template')
}

export async function listExpenses(accessToken: string, start?: string, end?: string): Promise<Expense[]> {
  const params = new URLSearchParams()
  if (start) params.set('start', start)
  if (end) params.set('end', end)
  const res = await fetch(`${API_BASE}/admin/expenses?${params}`, {
    headers: authHeaders(accessToken),
  })
  if (!res.ok) throw new Error('Could not load expenses')
  return res.json()
}

export async function createExpense(
  accessToken: string,
  data: { name: string; category?: string | null; amount_cents: number; incurred_on: string; notes?: string | null; template_id?: string | null },
): Promise<Expense> {
  const res = await fetch(`${API_BASE}/admin/expenses`, {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Could not create expense')
  return res.json()
}

export async function updateExpense(
  accessToken: string,
  id: string,
  data: Partial<Pick<Expense, 'name' | 'category' | 'amount_cents' | 'incurred_on' | 'notes'>>,
): Promise<void> {
  const res = await fetch(`${API_BASE}/admin/expenses/${id}`, {
    method: 'PATCH',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Could not update expense')
}

export async function deleteExpense(accessToken: string, id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/admin/expenses/${id}`, {
    method: 'DELETE',
    headers: authHeaders(accessToken),
  })
  if (!res.ok) throw new Error('Could not delete expense')
}

export type PrintRun = {
  id: string
  created_at: string
  roll_width_inches: number | null
  copies: number | null
  y_scale: number | null
  x_offset_inches: number | null
  skew_correction_inches: number | null
  skew_correction_y_inches: number | null
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

/** Permanently remove a junk run from the log. Distinct from marking one bad
 *  (setPrintRunOutcome), which deliberately keeps it visible as a warning. */
export async function deletePrintRun(printRunId: string, accessToken: string): Promise<void> {
  const res = await fetch(`${API_BASE}/admin/print-runs/${printRunId}`, {
    method: 'DELETE',
    headers: authHeaders(accessToken),
  })
  if (!res.ok) throw new Error('Could not delete print run')
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

// Price increase (owner's call), layered on top of the margin-derived rate
// rather than folded into TARGET_MATERIAL_MARGIN. Calibrated so a 4x4
// print-own design (8x8 canvas) lands at exactly $18.00 before
// roundUpTo50Cents below. Keep in sync with canvas_pricing.py.
const PRICE_INCREASE_MULTIPLIER = 1800 / 1357

const PRICE_PER_SQ_IN_CENTS =
  ((ROLL_COST_CENTS / ROLL_SELLABLE_SQ_IN) / (1 - TARGET_MATERIAL_MARGIN)) * PRICE_INCREASE_MULTIPLIER

/** Every customer-facing price rounds up to the nearest 50 cents — cleaner
 *  price tags, and rounding up (never down) never gives back any of the
 *  2026-09-01 increase. Mirrors round_up_to_50_cents in canvas_pricing.py. */
function roundUpTo50Cents(cents: number): number {
  return Math.ceil(cents / 50) * 50
}

// $5.00 originally, scaled by PRICE_INCREASE_MULTIPLIER and rounded up.
const MIN_CANVAS_PRICE_CENTS = 700

export const PRINT_OWN_BASE_CENTS = 950 // $9.50 ($7 originally, scaled + rounded up)

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
// Anchor prices scaled by PRICE_INCREASE_MULTIPLIER (originally $9/$12/$14) —
// curve inputs, not a shown price, so rounded to the cent, not to 50 cents.
const _LEGACY_ANCHORS: [number, number][] = [[30, 1194], [48, 1592], [96, 1857]]

// The canvas line on the invoice: the whole item at TARGET_MATERIAL_MARGIN,
// less the fulfillment fee printOwnTotalCents adds back. The margin applies to
// canvas + fulfillment together, not the canvas alone — see canvas_price_cents
// in canvas_pricing.py. Floor applied after the subtraction so the smallest
// canvases still total $16.50 (a $7 canvas line plus the $9.50 fee).
function _canvasPriceCents(sqIn: number): number {
  const itemTotal = Math.round(PRICE_PER_SQ_IN_CENTS * sqIn)
  const raw = Math.max(MIN_CANVAS_PRICE_CENTS, itemTotal - PRINT_OWN_BASE_CENTS)
  return roundUpTo50Cents(raw)
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
  const raw = Math.round(
    BELT_PRICE_MULTIPLIER * _legacyAnchorPriceCents(sqIn) + (BELT_PRICE_MULTIPLIER - 1) * PRINT_OWN_BASE_CENTS
  )
  return roundUpTo50Cents(raw)
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

// Standard orders are cut from a small set of pre-cut roll widths rather
// than a bespoke width per design (8", 10", 12" and 16" are what's actually
// kept cut) — see get_canvas_for_design in canvas_pricing.py. Always <=
// STANDARD_MAX_SHORT_SIDE + 2*CANVAS_MARGIN_INCHES (16"), so 16 is a safe
// last resort. Non-standard orders and belts stay fully continuous.
const STANDARD_WIDTH_TIERS_IN = [8.0, 10.0, 12.0, 16.0]

/** Narrowest pre-cut stock that fits this canvas width. The epsilon matters: a
 *  downgrade margin is derived as (tier - short)/2, so short + 2*margin lands
 *  back on the tier through floating point and can come out a hair over it.
 *  Mirrors _short_side_tier in canvas_pricing.py. */
function shortSideTier(shortSideInches: number): number {
  return STANDARD_WIDTH_TIERS_IN.find(t => t >= shortSideInches - 1e-9)
    ?? STANDARD_WIDTH_TIERS_IN[STANDARD_WIDTH_TIERS_IN.length - 1]
}

/** The margin that drops this design one roll tier, or null if there isn't one.
 *  Mirrors tier_downgrade_margin_inches in canvas_pricing.py — keep in step.
 *  Offers only the tier immediately below, never a cascade, and returns the
 *  largest margin that still fits it rather than always the floor. */
export function tierDowngradeMarginInches(widthInches: number, heightInches: number): number | null {
  if (isBeltDesign(widthInches, heightInches)) return null
  if (!isStandardOrder(widthInches, heightInches)) return null

  const defaultMargin = canvasMarginInches(widthInches, heightInches)
  if (defaultMargin <= DOWNGRADE_MIN_MARGIN_INCHES) return null

  const short = Math.min(widthInches, heightInches)
  const defaultTier = shortSideTier(short + 2 * defaultMargin)
  const index = STANDARD_WIDTH_TIERS_IN.indexOf(defaultTier)
  if (index <= 0) return null

  const lowerTier = STANDARD_WIDTH_TIERS_IN[index - 1]
  const margin = Math.min(defaultMargin, (lowerTier - short) / 2)
  return margin < DOWNGRADE_MIN_MARGIN_INCHES ? null : margin
}

/** marginInches overrides the default margin, for a buyer who chose a tier
 *  downgrade. Pass the same value to the printed border or the canvas will not
 *  match the stock it was priced against. */
export function getCanvasForDesign(
  widthInches: number,
  heightInches: number,
  marginInches?: number,
): CanvasSize {
  const margin = marginInches ?? canvasMarginInches(widthInches, heightInches)
  const isBelt = isBeltDesign(widthInches, heightInches)
  let canvasW: number
  let canvasH: number
  if (isStandardOrder(widthInches, heightInches) && !isBelt) {
    const shortSide = Math.min(widthInches, heightInches) + 2 * margin
    const longSide = Math.ceil((Math.max(widthInches, heightInches) + 2 * margin) * 2) / 2
    const tier = shortSideTier(shortSide)
    ;[canvasW, canvasH] = widthInches <= heightInches ? [tier, longSide] : [longSide, tier]
  } else {
    // Ceiling, not nearest: rounding down shaved the margin the buyer paid
    // for. See get_canvas_for_design in canvas_pricing.py.
    canvasW = Math.ceil((widthInches + 2 * margin) * 2) / 2
    canvasH = Math.ceil((heightInches + 2 * margin) * 2) / 2
  }
  const sqIn = canvasW * canvasH
  const fmt = (n: number) => n % 1 === 0 ? `${n}` : `${n.toFixed(1)}`
  return {
    label: `${fmt(canvasW)}×${fmt(canvasH)}"`,
    canvasW,
    canvasH,
    priceCents: isBelt ? _beltCanvasPriceCents(sqIn) : _canvasPriceCents(sqIn),
  }
}

export function printOwnTotalCents(canvas: CanvasSize): number {
  return PRINT_OWN_BASE_CENTS + canvas.priceCents
}

/** Print-own plus the creator markup. Derived from the print-own total so the
 *  two can never drift apart — do not reintroduce a separate gallery base fee. */
export function printGalleryTotalCents(canvas: CanvasSize): number {
  const raw = Math.round(printOwnTotalCents(canvas) * (1 + GALLERY_MARKUP))
  return roundUpTo50Cents(raw)
}

/** What the original designer earns on a gallery print. Mirrors
 *  creator_earnings_cents in canvas_pricing.py — taken off the print-own base,
 *  not the marked-up total, which is what makes the markup self-funding. */
export function creatorEarningsCents(galleryTotalCents: number): number {
  return Math.round((galleryTotalCents / (1 + GALLERY_MARKUP)) * CREATOR_SHARE_OF_PRINT_OWN)
}

// Widest roll the printer can feed. Mirrors MAX_ROLL_WIDTH_IN in
// canvas_pricing.py. Corrected 2026-08-30 from an assumed 19" — 17" is the
// printer's real practical max, and even a 17" print struggled.
export const MAX_ROLL_WIDTH_INCHES = 17

// Unstitched canvas around the design: 2" preferred, 1" floor. Designs too
// wide for 2" per side get the margin trimmed rather than refused. See
// canvasMarginInches.
export const CANVAS_MARGIN_INCHES = 2
export const MIN_CANVAS_MARGIN_INCHES = 1

// Floor for a *voluntary* margin trim — a different thing from
// MIN_CANVAS_MARGIN_INCHES, which is physics (below it the roll cannot print
// the job at all). This is a comfort floor for a buyer who chooses a narrower
// border to drop a roll tier. Mirrors DOWNGRADE_MIN_MARGIN_IN in
// canvas_pricing.py.
export const DOWNGRADE_MIN_MARGIN_INCHES = 1.75

// Max printable — the hard ceiling on what can even be drafted in studio,
// deliberately below what MAX_ROLL_WIDTH_INCHES - 2*MIN_CANVAS_MARGIN_INCHES
// would allow (15"): real headroom under the printer's practical max, not
// the theoretical one. Long side is the editor's 20" stage, since the long
// axis runs down the roll's unbounded feed direction.
export const MAX_PRINTABLE_SHORT_SIDE = 14
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

// Self-serve/gallery envelope. Gated on short side alone (up to 12", the
// largest size that still fits a pre-cut roll tier — see
// STANDARD_WIDTH_TIERS_IN); long side has no separate cap beyond the overall
// printable ceiling. Larger designs still print and can still be designed
// and saved — they just can't be checked out or posted to the gallery.
// Raised from 6"x10" to 12"x(printable long max) on 2026-08-30 alongside
// adding the 12" and 16" roll tiers. Mirrors STANDARD_MAX_* /
// is_standard_order in canvas_pricing.py.
export const STANDARD_MAX_SHORT_SIDE = 12
export const STANDARD_MAX_LONG_SIDE = MAX_PRINTABLE_LONG_SIDE

/** Whether a design can be bought self-serve and posted to the gallery.
 *  Narrower than isDesignPrintable, which only asks whether the roll can print
 *  it. Belts are exempt — long but narrow, and they ship in the same tube. */
export function isStandardOrder(widthInches: number, heightInches: number): boolean {
  if (isBeltDesign(widthInches, heightInches)) return true
  const short = Math.min(widthInches, heightInches)
  const long = Math.max(widthInches, heightInches)
  return short <= STANDARD_MAX_SHORT_SIDE && long <= STANDARD_MAX_LONG_SIDE
}

/** Customer-facing canvas size wording. Standard, non-belt orders snap their
 *  short side to a pre-cut roll tier (see STANDARD_WIDTH_TIERS_IN) — naming
 *  that tier explicitly ("16" roll - 20 inch width") instead of a raw W×H
 *  makes it visible why, say, a 5x6 and a 6x8 design can price the same:
 *  they land on the same roll stock. Belts and oversized/quote-only designs
 *  have no fixed roll tier, so they keep the plain W×H label. Mirrors the
 *  tiering decision in getCanvasForDesign/get_canvas_for_design — do not use
 *  this for admin/print-queue or cart line-item titles, which stay in exact
 *  W×H terms for print records. */
export function formatCustomerCanvasLabel(canvas: CanvasSize, widthInches: number, heightInches: number): string {
  if (isBeltDesign(widthInches, heightInches) || !isStandardOrder(widthInches, heightInches)) {
    return `${canvas.label} canvas`
  }
  const [tier, longSide] = widthInches <= heightInches
    ? [canvas.canvasW, canvas.canvasH]
    : [canvas.canvasH, canvas.canvasW]
  const fmt = (n: number) => (n % 1 === 0 ? `${n}` : n.toFixed(1))
  return `${fmt(tier)}" roll - ${fmt(longSide)} inch width`
}

// Phrased on width alone — STANDARD_MAX_LONG_SIDE just equals the overall
// printable ceiling, so width is always what actually trips this gate.
export const LARGE_PRINT_MESSAGE =
  `Designs wider than ${STANDARD_MAX_SHORT_SIDE}" are printed to order — contact us for a quote on large prints.`

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
  payload: { pdf_url: string; width_inches: number; height_inches: number; parent_gallery_item_id?: string | null; internal_pdf_supabase_path?: string | null; project_id?: string | null; tier_downgrade?: boolean },
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

export type CreatorSlugEntry = { slug: string; updated_at: string | null }

/** Every creator's slug, for the sitemap — public, unauthenticated. */
export async function listCreatorSlugs(): Promise<CreatorSlugEntry[]> {
  const res = await fetch(`${API_BASE}/gallery/creators`)
  if (!res.ok) return []
  return res.json()
}

export async function createGalleryPrintCheckout(
  galleryItemId: string,
  tierDowngrade = false,
): Promise<CheckoutResponse> {
  const query = tierDowngrade ? '?tier_downgrade=true' : ''
  const res = await fetch(`${API_BASE}/checkout/print-gallery/${galleryItemId}${query}`, {
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
    tier_downgrade?: boolean
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

/** A length-calibration aid: one continuous line, two 18-mesh stitch widths
 *  thick, exactly lengthInches tall, with the same 2"-per-side canvas margin
 *  a real design gets (blank above/below) before yScale scales the whole
 *  thing — matching how a real roll-print design's total commanded feed
 *  distance is (content + 4") * yScale, not just content * yScale. Print it
 *  and measure the line itself (not the blank margin) with a ruler to check
 *  a candidate yScale before committing real canvas to a job. */
export type TestLineColor = 'gray' | 'beige' | 'yellow' | 'pink'

export async function downloadTestLinePdf(
  accessToken: string,
  lengthInches: number,
  rollWidthInches = 8,
  yScale = 1,
  color: TestLineColor = 'gray',
  /** 0 = length-only line. A real mesh adds labelled cross-ticks every 5
   *  nominal inches for counting canvas holes instead of measuring length. */
  meshCount = 0,
): Promise<void> {
  const params = new URLSearchParams({
    length: String(lengthInches),
    roll_width: String(rollWidthInches),
    y_scale: String(yScale),
    color,
    mesh: String(meshCount),
  })
  const res = await fetch(`${API_BASE}/admin/test-line-pdf?${params}`, {
    headers: authHeaders(accessToken),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { detail?: string }).detail ?? 'Failed to generate test line PDF')
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'mns_test_line.pdf'
  a.click()
  URL.revokeObjectURL(url)
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
  skewCorrectionYInches?: number
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
      skew_correction_y_inches: opts.skewCorrectionYInches ?? 0,
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

// ── Gallery takedowns (admin) ────────────────────────────────────────────────

export type AdminGalleryItem = GalleryItem & {
  user_id?: string | null
  suspended_at?: string | null
  suspended_reason?: string | null
  suspended_by?: string | null
  creator_suspension_count?: number
}

export type SuspendResult = {
  item: AdminGalleryItem
  /** Whether the §512(g) notice actually reached the creator. */
  notified: boolean
  /** Why it didn't, when it didn't. The takedown still applied either way. */
  notify_error: string | null
}

/** Every listing including suspended ones. Admin only. */
export async function adminListGallery(accessToken: string): Promise<AdminGalleryItem[]> {
  const res = await fetch(`${API_BASE}/admin/gallery`, { headers: authHeaders(accessToken) })
  if (!res.ok) throw new Error('Could not load gallery listings')
  return res.json()
}

/** Hide a listing. Never deletes — the row is retained as evidence. */
export async function adminSuspendGalleryItem(
  itemId: string,
  reason: string,
  notify: boolean,
  accessToken: string,
): Promise<SuspendResult> {
  const res = await fetch(`${API_BASE}/admin/gallery/${encodeURIComponent(itemId)}/suspend`, {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({ reason: reason || null, notify }),
  })
  if (!res.ok) throw new Error('Could not hide this listing')
  return res.json()
}

export async function adminRestoreGalleryItem(
  itemId: string,
  accessToken: string,
): Promise<{ item: AdminGalleryItem }> {
  const res = await fetch(`${API_BASE}/admin/gallery/${encodeURIComponent(itemId)}/restore`, {
    method: 'POST',
    headers: jsonHeaders(accessToken),
  })
  if (!res.ok) throw new Error('Could not restore this listing')
  return res.json()
}
