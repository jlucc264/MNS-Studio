const API_BASE = (
  process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, '') || 'http://localhost:8000'
)

export type VisualizePayload = {
  image_url: string
  stitch_width: number
  stitch_height: number
  color_count: number
  show_grid: boolean
  mesh_count: number
  contrast_level: 'low' | 'normal' | 'high' | 'super_high' | 'super_super_high'
  source_type: 'photo' | 'stitched_photo'
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

export type CandidateImage = {
  id: string
  url: string
  title?: string | null
  provider?: string | null
}

export type ChatResponse = {
  action: string
  message: string
  active_image_url?: string | null
  stitch_preview_url?: string | null
  candidate_images?: CandidateImage[]
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

export async function searchWebImages(query: string): Promise<CandidateImage[]> {
  const res = await fetch(`${API_BASE}/search-images?query=${encodeURIComponent(query)}`)

  if (!res.ok) {
    let message = 'Image search failed'
    try {
      const data = await res.json()
      message = data.detail ?? message
    } catch {}
    throw new Error(message)
  }

  const data: { candidates: CandidateImage[] } = await res.json()
  return data.candidates
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
  preview_url: string
  width_inches: number
  height_inches: number
  mesh_count: number
  color_count: number
  contrast_level: 'low' | 'normal' | 'high' | 'super_high' | 'super_super_high'
  show_grid: boolean
  palette: PaletteColor[]
  cells: string[][]
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
