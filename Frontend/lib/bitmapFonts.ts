// Bitmap font data for the text tool.
// Each character maps to an array of row bitmaps. For a W-wide font,
// each row is a W-bit number where the MSB (bit W-1) = leftmost column.
// New fonts are authored as ASCII art under lib/fonts/ and compiled at load.

import { LOWERCASE_5x7 } from './fonts/lowercase5x7'
import { SCRIPT_9x12 } from './fonts/script9x12'
import { type RasterFontId, isRasterFamily, rasterizeText } from './fonts/rasterFonts'

export { RASTER_FONTS, isRasterFamily, ensureFontLoaded, type RasterFontId } from './fonts/rasterFonts'

// ── 3×5 font (sans) ──────────────────────────────────────────────────────────
const FONT_3x5: Record<string, number[]> = {
  ' ': [0,0,0,0,0],
  'A': [2,5,7,5,5], 'B': [6,5,6,5,6], 'C': [3,4,4,4,3], 'D': [6,5,5,5,6],
  'E': [7,4,6,4,7], 'F': [7,4,6,4,4], 'G': [3,4,5,5,3], 'H': [5,5,7,5,5],
  'I': [7,2,2,2,7], 'J': [1,1,1,5,2], 'K': [5,5,6,5,5], 'L': [4,4,4,4,7],
  'M': [5,7,7,5,5], 'N': [6,5,5,5,5], 'O': [2,5,5,5,2], 'P': [6,5,6,4,4],
  'Q': [2,5,5,6,3], 'R': [6,5,6,5,5], 'S': [3,4,2,1,6], 'T': [7,2,2,2,2],
  'U': [5,5,5,5,3], 'V': [5,5,5,5,2], 'W': [5,5,7,7,5], 'X': [5,5,2,5,5],
  'Y': [5,5,2,2,2], 'Z': [7,1,2,4,7],
  '0': [2,5,7,5,2], '1': [6,2,2,2,7], '2': [6,1,2,4,7], '3': [6,1,3,1,6],
  '4': [5,5,7,1,1], '5': [7,4,6,1,6], '6': [3,4,6,5,2], '7': [7,1,2,2,2],
  '8': [2,5,2,5,2], '9': [3,5,3,1,6],
  '!': [2,2,2,0,2], '?': [6,1,2,0,2], '.': [0,0,0,0,2], ',': [0,0,0,2,4],
  '-': [0,0,7,0,0], ':': [0,2,0,2,0], ';': [0,2,0,2,4], "'": [2,2,0,0,0],
  '"': [5,5,0,0,0], '&': [2,5,3,5,3], '(': [2,4,4,4,2], ')': [2,1,1,1,2],
  '+': [0,2,7,2,0], '=': [0,7,0,7,0], '/': [1,1,2,4,4], '@': [3,5,5,4,3],
  '#': [5,7,5,7,5], '%': [5,1,2,4,5], '*': [0,5,2,5,0], '_': [0,0,0,0,7],
  '^': [2,5,0,0,0], '<': [1,2,4,2,1], '>': [4,2,1,2,4], '[': [6,4,4,4,6],
  ']': [3,1,1,1,3], '|': [2,2,2,2,2], '\\': [4,4,2,1,1], '~': [0,3,6,0,0],
}

// ── 5×7 sans-serif ────────────────────────────────────────────────────────────
const FONT_5x7: Record<string, number[]> = {
  ' ': [0,0,0,0,0,0,0],
  'A': [14,17,17,31,17,17,17], 'B': [30,17,17,30,17,17,30], 'C': [14,17,16,16,16,17,14],
  'D': [30,17,17,17,17,17,30], 'E': [31,16,16,30,16,16,31], 'F': [31,16,16,30,16,16,16],
  'G': [14,17,16,19,17,17,15], 'H': [17,17,17,31,17,17,17], 'I': [14,4,4,4,4,4,14],
  'J': [3,1,1,1,1,17,14],     'K': [17,18,20,24,20,18,17], 'L': [16,16,16,16,16,16,31],
  'M': [17,27,21,17,17,17,17],'N': [17,25,21,19,17,17,17], 'O': [14,17,17,17,17,17,14],
  'P': [30,17,17,30,16,16,16],'Q': [14,17,17,17,21,18,13], 'R': [30,17,17,30,20,18,17],
  'S': [14,17,16,14,1,17,14], 'T': [31,4,4,4,4,4,4],       'U': [17,17,17,17,17,17,14],
  'V': [17,17,17,17,17,10,4], 'W': [17,17,17,21,21,27,17], 'X': [17,17,10,4,10,17,17],
  'Y': [17,17,10,4,4,4,4],    'Z': [31,1,2,4,8,16,31],
  '0': [14,17,19,21,25,17,14],'1': [4,12,4,4,4,4,14],      '2': [14,17,1,2,4,8,31],
  '3': [30,1,1,14,1,1,30],    '4': [17,17,17,31,1,1,1],    '5': [31,16,16,30,1,1,30],
  '6': [14,16,16,30,17,17,14],'7': [31,1,1,2,4,4,4],       '8': [14,17,17,14,17,17,14],
  '9': [14,17,17,15,1,1,14],
  '!': [4,4,4,4,4,0,4],       '?': [14,17,1,2,4,0,4],      '.': [0,0,0,0,0,0,4],
  ',': [0,0,0,0,0,4,8],       '-': [0,0,0,31,0,0,0],       ':': [0,4,0,0,4,0,0],
  ';': [0,0,4,0,0,4,8],       "'": [4,4,0,0,0,0,0],        '"': [10,10,0,0,0,0,0],
  '&': [12,18,18,12,21,17,13],'(': [4,8,16,16,16,8,4],     ')': [4,2,1,1,1,2,4],
  '+': [0,4,4,31,4,4,0],      '=': [0,0,31,0,31,0,0],      '/': [1,1,2,4,8,16,16],
  '@': [14,17,23,21,23,16,14],'#': [10,10,31,10,31,10,10], '%': [24,25,2,4,8,19,3],
  '*': [0,21,14,4,14,21,0],   '_': [0,0,0,0,0,0,31],       '^': [4,10,17,0,0,0,0],
  '<': [2,4,8,16,8,4,2],      '>': [8,4,2,1,2,4,8],        '[': [24,16,16,16,16,16,24],
  ']': [3,1,1,1,1,1,3],       '|': [4,4,4,4,4,4,4],        '\\': [16,16,8,4,2,1,1],
  '~': [0,9,22,0,0,0,0],
}

// ── 5×7 serif ─────────────────────────────────────────────────────────────────
// Key differences: head/foot serifs on stems (##.## at terminals), cap bars on I/T,
// terminal hooks on C/G, full base bars on B/D/E.
const FONT_SERIF_5x7: Record<string, number[]> = {
  ' ': [0,0,0,0,0,0,0],
  // Foot serifs on legs: ##.## = 27 at bottom of A's stems
  'A': [14,17,17,31,17,17,27],
  // Full bottom bar instead of curved close
  'B': [30,17,17,30,17,17,31],
  // Terminal hooks: ##..# = 25 (serif on open end)
  'C': [14,25,16,16,16,25,14],
  // Full top bar
  'D': [31,17,17,17,17,17,30],
  // Bracketed arms: ##... = 24 on arm ends
  'E': [31,24,16,28,16,24,31],
  // Similar to E top, stem foot serif at bottom
  'F': [31,24,16,30,16,16,24],
  // Terminal hooks like C
  'G': [14,25,16,19,17,25,14],
  // Head and foot serifs: ##.## = 27 top and bottom
  'H': [27,17,17,31,17,17,27],
  // Classic cap serif bars top and bottom
  'I': [31,4,4,4,4,4,31],
  // Top cap serif on J
  'J': [7,1,1,1,1,17,14],
  // Foot serifs on terminal strokes
  'K': [25,18,20,24,20,18,25],
  // Head serif on stem top
  'L': [24,16,16,16,16,16,31],
  // Head and foot serifs on outer stems
  'M': [27,27,21,17,17,17,27],
  // Head and foot serifs
  'N': [27,25,21,19,17,17,27],
  // Same as sans (round)
  'O': [14,17,17,17,17,17,14],
  // Foot serif on stem
  'P': [30,17,17,30,16,16,24],
  // Same as sans (tail letter)
  'Q': [14,17,17,17,21,18,13],
  // Foot serif on leg
  'R': [30,17,17,30,20,18,25],
  // Same as sans (S is flowing)
  'S': [14,17,16,14,1,17,14],
  // Foot serif on stem bottom
  'T': [31,4,4,4,4,4,14],
  // Head serifs on stems
  'U': [27,17,17,17,17,17,14],
  // Head serifs on tops of V legs
  'V': [27,17,17,17,10,10,4],
  // Head and bottom serifs
  'W': [27,17,17,21,21,27,27],
  // Corner serifs at all four arm ends
  'X': [27,17,10,4,10,17,27],
  // Head serifs + foot serif on stem
  'Y': [27,17,10,4,4,4,14],
  // Heavier diagonal corners
  'Z': [31,3,2,4,8,24,31],
  // Digits: mostly same, 1 and 7 get foot serifs
  '0': [14,17,19,21,25,17,14], '1': [6,2,2,2,2,2,7],
  '2': [14,17,1,2,4,8,31],     '3': [30,1,1,14,1,1,30],
  '4': [17,17,17,31,1,1,1],    '5': [31,16,16,30,1,1,30],
  '6': [14,16,16,30,17,17,14], '7': [31,1,1,2,4,4,14],
  '8': [14,17,17,14,17,17,14], '9': [14,17,17,15,1,1,14],
  // Punctuation same as sans
  '!': [4,4,4,4,4,0,4],        '?': [14,17,1,2,4,0,4],      '.': [0,0,0,0,0,0,4],
  ',': [0,0,0,0,0,4,8],        '-': [0,0,0,31,0,0,0],       ':': [0,4,0,0,4,0,0],
  ';': [0,0,4,0,0,4,8],        "'": [4,4,0,0,0,0,0],        '"': [10,10,0,0,0,0,0],
  '&': [12,18,18,12,21,17,13], '(': [4,8,16,16,16,8,4],     ')': [4,2,1,1,1,2,4],
  '+': [0,4,4,31,4,4,0],       '=': [0,0,31,0,31,0,0],      '/': [1,1,2,4,8,16,16],
  '@': [14,17,23,21,23,16,14], '#': [10,10,31,10,31,10,10], '%': [24,25,2,4,8,19,3],
  '*': [0,21,14,4,14,21,0],    '_': [0,0,0,0,0,0,31],       '^': [4,10,17,0,0,0,0],
  '<': [2,4,8,16,8,4,2],       '>': [8,4,2,1,2,4,8],        '[': [24,16,16,16,16,16,24],
  ']': [3,1,1,1,1,1,3],        '|': [4,4,4,4,4,4,4],        '\\': [16,16,8,4,2,1,1],
  '~': [0,9,22,0,0,0,0],
}

// ── Scale 5×7 → 9×13 ─────────────────────────────────────────────────────────
// Column mapping (5→9): bit4→cols 0,1 | bit3→cols 2,3 | bit2→col 4 | bit1→cols 5,6 | bit0→cols 7,8
// Row mapping (7→13): rows 0,1 / 2,3 / 4,5 / 6 / 7,8 / 9,10 / 11,12
// Both mappings double the outer pairs and single the middle (2,2,1,2,2), so
// left/right stems come out the same weight — an 8-wide target can't do that.
function scale5x7to9x13(rows5: number[]): number[] {
  const result = new Array(13).fill(0)
  const rowMap = [[0,1],[2,3],[4,5],[6],[7,8],[9,10],[11,12]]
  for (let r5 = 0; r5 < 7; r5++) {
    const row5 = rows5[r5] ?? 0
    let row9 = 0
    if (row5 & 0b10000) row9 |= 0b110000000
    if (row5 & 0b01000) row9 |= 0b001100000
    if (row5 & 0b00100) row9 |= 0b000010000
    if (row5 & 0b00010) row9 |= 0b000001100
    if (row5 & 0b00001) row9 |= 0b000000011
    for (const r13 of rowMap[r5]) result[r13] = row9
  }
  return result
}

function scaleFont(source: Record<string, number[]>): Record<string, number[]> {
  return Object.fromEntries(Object.entries(source).map(([ch, rows]) => [ch, scale5x7to9x13(rows)]))
}

// Lowercase merges into both 5×7 families (serif detail doesn't survive at a
// 5-pixel x-height, so they share glyphs — same call the 3×5 size makes).
const FONT_5x7_FULL       = { ...FONT_5x7, ...LOWERCASE_5x7 }
const FONT_SERIF_5x7_FULL = { ...FONT_SERIF_5x7, ...LOWERCASE_5x7 }

const FONT_9x13       = scaleFont(FONT_5x7_FULL)
const FONT_SERIF_9x13 = scaleFont(FONT_SERIF_5x7_FULL)

// ── Generic 2× scale (each pixel → 2×2 block) ────────────────────────────────
function scaleRows2x(rows: number[], width: number): number[] {
  const out: number[] = []
  for (const row of rows) {
    let wide = 0
    for (let c = 0; c < width; c++) {
      if ((row >> (width - 1 - c)) & 1) wide |= 0b11 << (2 * (width - 1 - c))
    }
    out.push(wide, wide)
  }
  return out
}

function scaleFont2x(source: Record<string, number[]>, width: number): Record<string, number[]> {
  return Object.fromEntries(Object.entries(source).map(([ch, rows]) => [ch, scaleRows2x(rows, width)]))
}

const SCRIPT_18x24 = scaleFont2x(SCRIPT_9x12, 9)

// ── Style modifiers ───────────────────────────────────────────────────────────

// Thicken each lit pixel rightward by one cell.
function applyBold(rows: number[], width: number): number[] {
  const mask = (1 << width) - 1
  return rows.map(row => (row | (row >> 1)) & mask)
}

// Shear each row so top leans right (forward italic).
// Returns new rows and the expanded width.
function applyItalic(rows: number[], width: number, height: number): { rows: number[]; width: number } {
  const totalShift = Math.max(1, Math.floor((height - 1) / 3))
  const newWidth = width + totalShift
  const newMask = (1 << newWidth) - 1
  const newRows = rows.map((row, r) => {
    const shift = Math.round((height - 1 - r) * totalShift / Math.max(1, height - 1))
    const extended = row << (newWidth - width) // left-align in wider space
    return (extended >> shift) & newMask
  })
  return { rows: newRows, width: newWidth }
}

// Keep only border pixels (lit pixels with at least one unlit 4-neighbor).
function applyOutline(rows: number[], width: number): number[] {
  const mask = (1 << width) - 1
  return rows.map((row, r) => {
    const above = rows[r - 1] ?? 0
    const below = rows[r + 1] ?? 0
    const leftN  = row >> 1           // each bit p: was bit p+1 set? (left neighbor)
    const rightN = (row << 1) & mask  // each bit p: was bit p-1 set? (right neighbor)
    const interior = row & above & below & leftN & rightN
    return row & ~interior
  })
}

// ── Public API ────────────────────────────────────────────────────────────────

export type FontSize        = 'small' | 'medium' | 'large'
// Bitmap families are hand-tuned for small lettering; raster ids are real
// TTFs thresholded onto the grid, only offered at display sizes (16+ tall).
export type BitmapFamily    = 'sans'  | 'serif' | 'script'
export type FontFamily      = BitmapFamily | RasterFontId
export type TextStyle       = { bold?: boolean; italic?: boolean; outline?: boolean }
// horizontal: normal · stacked: upright letters top-to-bottom ·
// down: rotated 90° CW (reads downward) · up: rotated 90° CCW (reads upward)
export type TextOrientation = 'horizontal' | 'stacked' | 'down' | 'up'

type FontMeta = { width: number; height: number; data: Record<string, number[]>; spacing: number }

// Script has one drawn size (9×12); large uses a 2× scale. small/medium share
// the native size rather than offering an unreadable shrunken variant.
const SCRIPT_META:    FontMeta = { width: 9,  height: 12, data: SCRIPT_9x12,  spacing: 1 }
const SCRIPT_META_2X: FontMeta = { width: 18, height: 24, data: SCRIPT_18x24, spacing: 2 }

// Stitch heights for rasterized fonts — nothing below 16, where TTF
// thresholding turns to mush and the hand-tuned bitmap fonts take over.
const RASTER_SIZES: Record<FontSize, number> = { small: 16, medium: 22, large: 30 }

const FONT_META: Record<FontSize, Record<BitmapFamily, FontMeta>> = {
  small:  {
    sans:   { width: 3, height: 5,  data: FONT_3x5,       spacing: 1 },
    serif:  { width: 3, height: 5,  data: FONT_3x5,       spacing: 1 }, // same at 3×5
    script: SCRIPT_META,
  },
  medium: {
    sans:   { width: 5, height: 7,  data: FONT_5x7_FULL,       spacing: 1 },
    serif:  { width: 5, height: 7,  data: FONT_SERIF_5x7_FULL, spacing: 1 },
    script: SCRIPT_META,
  },
  large:  {
    sans:   { width: 9, height: 13, data: FONT_9x13,       spacing: 2 },
    serif:  { width: 9, height: 13, data: FONT_SERIF_9x13, spacing: 2 },
    script: SCRIPT_META_2X,
  },
}

const EMPTY_DATA: Record<string, number[]> = {}

export function getFontMeta(size: FontSize, family: FontFamily = 'sans'): FontMeta {
  if (isRasterFamily(family)) {
    // Raster fonts are proportional — width 0 signals "no fixed advance".
    return { width: 0, height: RASTER_SIZES[size], data: EMPTY_DATA, spacing: 1 }
  }
  return FONT_META[size][family]
}

// How far each character advances horizontally, accounting for italic
// expansion. Bitmap families only — raster fonts are proportional.
export function getCharAdvance(size: FontSize, family: FontFamily = 'sans', style: TextStyle = {}): number {
  const { width, height, spacing } = getFontMeta(size, family)
  let charWidth = width
  if (style.italic) {
    const totalShift = Math.max(1, Math.floor((height - 1) / 3))
    charWidth += totalShift
  }
  return charWidth + spacing
}

// Where the typing caret sits, in cells relative to the text anchor.
// axis is the direction the caret bar spans (it's drawn thin the other way).
// Takes the typed text itself because raster fonts are proportional.
export function getCaretPlacement(
  text: string,
  size: FontSize,
  family: FontFamily,
  style: TextStyle = {},
  orientation: TextOrientation = 'horizontal',
): { row: number; col: number; axis: 'vertical' | 'horizontal'; span: number } {
  const meta = getFontMeta(size, family)
  const height = meta.height
  const charCount = Array.from(text).length

  if (isRasterFamily(family)) {
    const advance = text ? (rasterizeText(family, text, height, style)?.width ?? 0) + 1 : 0
    const charSpan = Math.max(3, Math.round(height * 0.6))
    switch (orientation) {
      case 'stacked':    return { row: charCount * (height + 1), col: 0, axis: 'horizontal', span: charSpan }
      case 'down':       return { row: advance, col: 0, axis: 'horizontal', span: height }
      case 'up':         return { row: 0, col: 0, axis: 'horizontal', span: height }
      default:           return { row: 0, col: advance, axis: 'vertical', span: height }
    }
  }

  const advance = getCharAdvance(size, family, style)
  switch (orientation) {
    case 'stacked':
      return { row: charCount * (height + meta.spacing), col: 0, axis: 'horizontal', span: advance - meta.spacing }
    case 'down':
      return { row: charCount * advance, col: 0, axis: 'horizontal', span: height }
    case 'up':
      // Anchor stays the block's top-left, so new characters surface at the top.
      return { row: 0, col: 0, axis: 'horizontal', span: height }
    default:
      return { row: 0, col: charCount * advance, axis: 'vertical', span: height }
  }
}

// Keep only cells with at least one unlit 4-neighbor (outline style for
// raster fonts, where the bit-mask version can't apply).
function outlineCells(rel: Array<{ r: number; c: number }>): Array<{ r: number; c: number }> {
  const lit = new Set(rel.map(({ r, c }) => `${r},${c}`))
  return rel.filter(({ r, c }) =>
    !lit.has(`${r - 1},${c}`) || !lit.has(`${r + 1},${c}`) || !lit.has(`${r},${c - 1}`) || !lit.has(`${r},${c + 1}`),
  )
}

function bitmapLayout(
  text: string,
  meta: FontMeta,
  style: TextStyle,
  stacked: boolean,
): Array<{ r: number; c: number }> {
  const { height, spacing } = meta
  const rel: Array<{ r: number; c: number }> = []
  let cursor = 0
  for (const char of text) {
    // Case-sensitive lookup, falling back to the capital for fonts without
    // lowercase (3×5, script) and to blank for unknown characters.
    const key = meta.data[char] ? char : char.toUpperCase()
    let rows = [...(meta.data[key] ?? meta.data[' '] ?? new Array(height).fill(0))]
    let charWidth = meta.width

    if (style.bold)    rows = applyBold(rows, charWidth)
    if (style.italic)  { const r = applyItalic(rows, charWidth, height); rows = r.rows; charWidth = r.width }
    if (style.outline) rows = applyOutline(rows, charWidth)

    for (let r = 0; r < height; r++) {
      const rowBits = rows[r] ?? 0
      for (let c = 0; c < charWidth; c++) {
        if ((rowBits >> (charWidth - 1 - c)) & 1) {
          rel.push({ r: (stacked ? cursor : 0) + r, c: (stacked ? 0 : cursor) + c })
        }
      }
    }
    cursor += stacked ? height + spacing : charWidth + spacing
  }
  return rel
}

function rasterLayout(
  family: RasterFontId,
  text: string,
  height: number,
  style: TextStyle,
  stacked: boolean,
): Array<{ r: number; c: number }> {
  const rel: Array<{ r: number; c: number }> = []
  if (stacked) {
    // Per-character blocks, centered on the widest, one blank row between.
    const blocks = Array.from(text).map((char) => rasterizeText(family, char, height, style))
    const maxWidth = blocks.reduce((m, b) => Math.max(m, b?.width ?? 0), 1)
    let rowOffset = 0
    for (const block of blocks) {
      if (block) {
        const colOffset = Math.floor((maxWidth - block.width) / 2)
        for (let r = 0; r < block.height; r++) {
          for (let c = 0; c < block.width; c++) {
            if (block.grid[r][c]) rel.push({ r: rowOffset + r, c: colOffset + c })
          }
        }
      }
      rowOffset += height + 1
    }
  } else {
    const block = rasterizeText(family, text, height, style)
    if (block) {
      for (let r = 0; r < block.height; r++) {
        for (let c = 0; c < block.width; c++) {
          if (block.grid[r][c]) rel.push({ r, c })
        }
      }
    }
  }
  return style.outline ? outlineCells(rel) : rel
}

export function getTextCells(
  text: string,
  anchorRow: number,
  anchorCol: number,
  size: FontSize,
  family: FontFamily,
  color: string,
  style: TextStyle = {},
  orientation: TextOrientation = 'horizontal',
): Array<{ row: number; col: number; color: string }> {
  const meta = getFontMeta(size, family)
  const stacked = orientation === 'stacked'

  const rel = isRasterFamily(family)
    ? rasterLayout(family, text, meta.height, style, stacked)
    : bitmapLayout(text, meta, style, stacked)

  // Rotate the laid-out block for the rotated orientations, keeping the
  // anchor at the block's top-left corner.
  let placed = rel
  if (orientation === 'down' || orientation === 'up') {
    const maxR = meta.height - 1
    const maxC = rel.reduce((m, p) => Math.max(m, p.c), 0)
    placed = rel.map(({ r, c }) =>
      orientation === 'down' ? { r: c, c: maxR - r } : { r: maxC - c, c: r },
    )
  }

  return placed.map(({ r, c }) => ({ row: anchorRow + r, col: anchorCol + c, color }))
}
