// Bitmap font data for the text tool.
// Each character maps to an array of row bitmaps. For a W-wide font,
// each row is a W-bit number where the MSB (bit W-1) = leftmost column.

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

// ── Scale 5×7 → 8×13 ─────────────────────────────────────────────────────────
// Column mapping (5→8): bit4→cols 0,1 | bit3→cols 2,3 | bit2→col 4 | bit1→cols 5,6 | bit0→col 7
// Row mapping (7→13): rows 0,1 / 2,3 / 4,5 / 6 / 7,8 / 9,10 / 11,12
function scale5x7to8x13(rows5: number[]): number[] {
  const result = new Array(13).fill(0)
  const rowMap = [[0,1],[2,3],[4,5],[6],[7,8],[9,10],[11,12]]
  for (let r5 = 0; r5 < 7; r5++) {
    const row5 = rows5[r5] ?? 0
    let row8 = 0
    if (row5 & 0b10000) row8 |= 0b11000000
    if (row5 & 0b01000) row8 |= 0b00110000
    if (row5 & 0b00100) row8 |= 0b00001000
    if (row5 & 0b00010) row8 |= 0b00000110
    if (row5 & 0b00001) row8 |= 0b00000001
    for (const r8 of rowMap[r5]) result[r8] = row8
  }
  return result
}

function scaleFont(source: Record<string, number[]>): Record<string, number[]> {
  return Object.fromEntries(Object.entries(source).map(([ch, rows]) => [ch, scale5x7to8x13(rows)]))
}

const FONT_8x13      = scaleFont(FONT_5x7)
const FONT_SERIF_8x13 = scaleFont(FONT_SERIF_5x7)

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

export type FontSize   = 'small' | 'medium' | 'large'
export type FontFamily = 'sans'  | 'serif'
export type TextStyle  = { bold?: boolean; italic?: boolean; outline?: boolean }

type FontMeta = { width: number; height: number; data: Record<string, number[]>; spacing: number }

const FONT_META: Record<FontSize, Record<FontFamily, FontMeta>> = {
  small:  {
    sans:  { width: 3, height: 5,  data: FONT_3x5,       spacing: 1 },
    serif: { width: 3, height: 5,  data: FONT_3x5,       spacing: 1 }, // same at 3×5
  },
  medium: {
    sans:  { width: 5, height: 7,  data: FONT_5x7,       spacing: 1 },
    serif: { width: 5, height: 7,  data: FONT_SERIF_5x7, spacing: 1 },
  },
  large:  {
    sans:  { width: 8, height: 13, data: FONT_8x13,       spacing: 2 },
    serif: { width: 8, height: 13, data: FONT_SERIF_8x13, spacing: 2 },
  },
}

export function getFontMeta(size: FontSize, family: FontFamily = 'sans'): FontMeta {
  return FONT_META[size][family]
}

// How far each character advances horizontally, accounting for italic expansion.
export function getCharAdvance(size: FontSize, style: TextStyle = {}): number {
  const { width, height, spacing } = getFontMeta(size)
  let charWidth = width
  if (style.italic) {
    const totalShift = Math.max(1, Math.floor((height - 1) / 3))
    charWidth += totalShift
  }
  return charWidth + spacing
}

export function getTextCells(
  text: string,
  anchorRow: number,
  anchorCol: number,
  size: FontSize,
  family: FontFamily,
  color: string,
  style: TextStyle = {},
): Array<{ row: number; col: number; color: string }> {
  const meta = getFontMeta(size, family)
  const { height, spacing } = meta
  const cells: Array<{ row: number; col: number; color: string }> = []
  let col = anchorCol

  for (const char of text) {
    const key = char.toUpperCase()
    let rows = [...(meta.data[key] ?? meta.data[' '] ?? new Array(height).fill(0))]
    let charWidth = meta.width

    if (style.bold)    rows = applyBold(rows, charWidth)
    if (style.italic)  { const r = applyItalic(rows, charWidth, height); rows = r.rows; charWidth = r.width }
    if (style.outline) rows = applyOutline(rows, charWidth)

    for (let r = 0; r < height; r++) {
      const rowBits = rows[r] ?? 0
      for (let c = 0; c < charWidth; c++) {
        if ((rowBits >> (charWidth - 1 - c)) & 1) {
          cells.push({ row: anchorRow + r, col: col + c, color })
        }
      }
    }
    col += charWidth + spacing
  }

  return cells
}
