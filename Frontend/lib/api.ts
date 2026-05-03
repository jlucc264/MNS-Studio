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

export type ChatResponse = {
  action: string
  message: string
  active_image_url?: string | null
  stitch_preview_url?: string | null
  metadata?: Record<string, unknown>
}

export type VisualizeResponse = {
  message: string
  stitch_preview_url: string
  palette: PaletteColor[]
  settings: Record<string, unknown>
  cells: string[][]
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

export async function chatAssistant(message: string): Promise<ChatResponse> {
  const res = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
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

export function assetUrl(path: string | null) {
  if (!path) return null
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
  palette: PaletteColor[] | null
  cells: string[][] | null
  source_image_url: string | null
  preview_image_url: string | null
  pdf_url: string | null
}

export type ProjectSavePayload = Partial<Omit<Project, 'id' | 'created_at' | 'updated_at'>> & {
  name: string
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

export type GalleryItem = {
  id: string
  created_at: string
  user_id: string
  title: string
  tags: string[]
  preview_image_url: string | null
  pdf_url: string
  width_inches: number | null
  height_inches: number | null
  mesh_count: number | null
  color_count: number | null
  like_count: number
  liked_by_me: boolean
}

export type GalleryCreatePayload = {
  title: string
  tags: string[]
  preview_image_url?: string | null
  pdf_url: string
  width_inches?: number | null
  height_inches?: number | null
  mesh_count?: number | null
  color_count?: number | null
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
  if (!res.ok) throw new Error('Could not load gallery')
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
