// Compiles ASCII-art glyphs into the row-bitmap format used by bitmapFonts.ts:
// each row is a width-bit number where the MSB (bit width-1) = leftmost column.
// '#' marks a lit cell; any other character is unlit. Dimensions are validated
// so a malformed glyph fails loudly at module load instead of rendering garbage.

export function compileGlyphs(
  art: Record<string, string[]>,
  width: number,
  height: number,
): Record<string, number[]> {
  const out: Record<string, number[]> = {}
  for (const [char, rows] of Object.entries(art)) {
    if (rows.length !== height) {
      throw new Error(`Glyph "${char}": expected ${height} rows, got ${rows.length}`)
    }
    out[char] = rows.map((row, i) => {
      if (row.length !== width) {
        throw new Error(`Glyph "${char}" row ${i}: expected width ${width}, got ${row.length}`)
      }
      let bits = 0
      for (let c = 0; c < width; c++) {
        if (row[c] === '#') bits |= 1 << (width - 1 - c)
      }
      return bits
    })
  }
  return out
}
