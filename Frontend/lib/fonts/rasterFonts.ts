// Real-font rasterization for the text tool: renders text through bundled
// TTFs (all OFL/Apache licensed, served from /public/fonts) onto an offscreen
// canvas and thresholds pixel coverage onto the stitch grid. This is how apps
// like Stitchly offer unlimited fonts — the tradeoff is quality collapses
// below ~16px glyph height, so these are offered only at display sizes while
// the hand-tuned bitmap fonts cover small lettering.
//
// Whole strings are rasterized in one fillText call (not per glyph) so
// kerning and connecting scripts come out right.

export const RASTER_FONT_IDS = [
  'dancing-script',
  'pacifico',
  'playfair-display',
  'alfa-slab-one',
  'luckiest-guy',
] as const

export type RasterFontId = (typeof RASTER_FONT_IDS)[number]

export type RasterFontDef = {
  id: RasterFontId
  label: string
  cssFamily: string
  file: string
}

export const RASTER_FONTS: RasterFontDef[] = [
  { id: 'dancing-script',   label: 'Dancing Script',   cssFamily: 'MNS Dancing Script',   file: '/fonts/dancing-script.ttf' },
  { id: 'pacifico',         label: 'Pacifico',         cssFamily: 'MNS Pacifico',         file: '/fonts/pacifico.ttf' },
  { id: 'playfair-display', label: 'Playfair Display', cssFamily: 'MNS Playfair Display', file: '/fonts/playfair-display.ttf' },
  { id: 'alfa-slab-one',    label: 'Alfa Slab One',    cssFamily: 'MNS Alfa Slab One',    file: '/fonts/alfa-slab-one.ttf' },
  { id: 'luckiest-guy',     label: 'Luckiest Guy',     cssFamily: 'MNS Luckiest Guy',     file: '/fonts/luckiest-guy.ttf' },
]

export function getRasterFont(id: string): RasterFontDef | undefined {
  return RASTER_FONTS.find((f) => f.id === id)
}

export function isRasterFamily(id: string): id is RasterFontId {
  return RASTER_FONTS.some((f) => f.id === id)
}

// ── Loading ──────────────────────────────────────────────────────────────────

const loadedIds = new Set<string>()
const loadPromises = new Map<string, Promise<void>>()

export function isRasterFontReady(id: string): boolean {
  return loadedIds.has(id)
}

// Resolves immediately for bitmap families and unknown ids, so callers can
// ensure unconditionally on any family value.
export function ensureFontLoaded(id: string): Promise<void> {
  const def = getRasterFont(id)
  if (!def || loadedIds.has(id) || typeof document === 'undefined') return Promise.resolve()
  let promise = loadPromises.get(id)
  if (!promise) {
    const face = new FontFace(def.cssFamily, `url(${def.file})`)
    promise = face
      .load()
      .then((loaded) => {
        document.fonts.add(loaded)
        loadedIds.add(id)
      })
      .catch((err) => {
        loadPromises.delete(id) // allow retry on transient failure
        throw err
      })
    loadPromises.set(id, promise)
  }
  return promise
}

// ── Rasterization ────────────────────────────────────────────────────────────

export type RasterBlock = { grid: boolean[][]; width: number; height: number }

const MAX_BLOCK_WIDTH = 4096

let scratchCanvas: HTMLCanvasElement | null = null

function getScratchContext(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null
  if (!scratchCanvas) scratchCanvas = document.createElement('canvas')
  return scratchCanvas.getContext('2d', { willReadFrequently: true })
}

const blockCache = new Map<string, RasterBlock>()
const BLOCK_CACHE_MAX = 80

function fontString(def: RasterFontDef, em: number, bold: boolean, italic: boolean): string {
  return `${italic ? 'italic ' : ''}${bold ? '700' : '400'} ${em.toFixed(2)}px "${def.cssFamily}"`
}

// Rasterize a full text run at a target stitch height. Returns null while the
// font hasn't loaded (never silently substitutes the browser fallback font —
// wrong glyphs must not get stamped into a design).
export function rasterizeText(
  id: string,
  text: string,
  targetHeight: number,
  opts: { bold?: boolean; italic?: boolean } = {},
): RasterBlock | null {
  if (!text) return null
  const def = getRasterFont(id)
  if (!def || !isRasterFontReady(id)) return null
  const ctx = getScratchContext()
  if (!ctx || !scratchCanvas) return null

  const bold = !!opts.bold
  const italic = !!opts.italic
  const cacheKey = `${id}|${targetHeight}|${bold ? 'b' : ''}${italic ? 'i' : ''}|${text}`
  const cached = blockCache.get(cacheKey)
  if (cached) return cached

  // Probe at a large em to learn the font's ascent+descent ratio, then pick
  // the em that makes the full line box span the target stitch height.
  const probeEm = 100
  ctx.font = fontString(def, probeEm, bold, italic)
  let metrics = ctx.measureText(text)
  const probeAscent = metrics.fontBoundingBoxAscent ?? probeEm * 0.8
  const probeDescent = metrics.fontBoundingBoxDescent ?? probeEm * 0.25
  const em = Math.max(4, (probeEm * targetHeight) / Math.max(1, probeAscent + probeDescent))

  ctx.font = fontString(def, em, bold, italic)
  metrics = ctx.measureText(text)
  const overhangLeft = Math.ceil(Math.max(0, metrics.actualBoundingBoxLeft ?? 0))
  const extentRight = Math.ceil(Math.max(1, metrics.actualBoundingBoxRight ?? metrics.width))
  const width = Math.min(MAX_BLOCK_WIDTH, overhangLeft + extentRight + 1)
  const height = targetHeight

  // Resizing resets all context state, so the font is set again after.
  scratchCanvas.width = width
  scratchCanvas.height = height
  ctx.font = fontString(def, em, bold, italic)
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#000'
  const ascent = ctx.measureText(text).fontBoundingBoxAscent ?? em * 0.8
  ctx.fillText(text, overhangLeft, Math.round(ascent))

  const image = ctx.getImageData(0, 0, width, height)
  const grid: boolean[][] = []
  for (let r = 0; r < height; r++) {
    const row: boolean[] = new Array(width)
    for (let c = 0; c < width; c++) {
      row[c] = image.data[(r * width + c) * 4 + 3] >= 128
    }
    grid.push(row)
  }

  const block: RasterBlock = { grid, width, height }
  if (blockCache.size >= BLOCK_CACHE_MAX) {
    const oldest = blockCache.keys().next().value
    if (oldest !== undefined) blockCache.delete(oldest)
  }
  blockCache.set(cacheKey, block)
  return block
}
