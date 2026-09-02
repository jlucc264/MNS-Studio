// Silhouette masking: constrain an imported photo to the bounds of a shaped
// template (a stocking, an ornament) that the user pulled from the gallery.
//
// The shape is not derived from image analysis — the template is already a
// design in the system, so its own cells define it. That makes "inside the
// stocking" a grid question rather than a computer-vision one.

const BLANK_CELL = '__BLANK__'

/** Cells reachable from the grid border by walking only through blank cells are
 *  OUTSIDE the shape. Everything else — the drawn stitches themselves, and any
 *  blank region they enclose — is inside.
 *
 *  Deriving "inside" this way rather than as "cells that are non-blank" is what
 *  makes a hollow template work: a stocking drawn as an outline is almost
 *  entirely blank in the middle, and that middle is exactly where the photo is
 *  supposed to go. It costs nothing on a filled silhouette, where the flood
 *  simply never gets in.
 *
 *  4-connected on purpose. An 8-connected flood leaks through a shape whose
 *  outline is only diagonally continuous — a single-stitch diagonal staircase
 *  is a solid wall to a needle, so it must be a wall here too.
 */
export function deriveSilhouetteMask(cells: string[][]): boolean[][] | null {
  const rows = cells.length
  const cols = cells[0]?.length ?? 0
  if (!rows || !cols) return null

  const outside: boolean[][] = Array.from({ length: rows }, () => new Array(cols).fill(false))
  const queue: Array<[number, number]> = []

  const push = (r: number, c: number) => {
    if (r < 0 || r >= rows || c < 0 || c >= cols) return
    if (outside[r][c]) return
    if (cells[r][c] !== BLANK_CELL) return
    outside[r][c] = true
    queue.push([r, c])
  }

  for (let c = 0; c < cols; c++) { push(0, c); push(rows - 1, c) }
  for (let r = 0; r < rows; r++) { push(r, 0); push(r, cols - 1) }

  while (queue.length) {
    const [r, c] = queue.pop()!
    push(r + 1, c); push(r - 1, c); push(r, c + 1); push(r, c - 1)
  }

  const mask = outside.map((row) => row.map((isOutside) => !isOutside))
  // A template with nothing blank at its border encloses the whole grid, which
  // is not a silhouette — it is a rectangular design. Masking to it would be a
  // no-op that still costs every downstream path a branch, so report none.
  return mask.some((row) => row.some((inside) => !inside)) ? mask : null
}

/** Nearest-neighbour resample, for when the import runs at a different mesh or
 *  size than the template was captured at. Nearest-neighbour rather than any
 *  smoothing: a mask is boolean, and an interpolated edge would produce cells
 *  that are neither in nor out. */
export function resampleMask(mask: boolean[][], rows: number, cols: number): boolean[][] {
  const sourceRows = mask.length
  const sourceCols = mask[0]?.length ?? 0
  if (!sourceRows || !sourceCols) return Array.from({ length: rows }, () => new Array(cols).fill(true))
  if (sourceRows === rows && sourceCols === cols) return mask

  return Array.from({ length: rows }, (_, r) => {
    const sr = Math.min(sourceRows - 1, Math.floor((r * sourceRows) / rows))
    return Array.from({ length: cols }, (_, c) => {
      const sc = Math.min(sourceCols - 1, Math.floor((c * sourceCols) / cols))
      return mask[sr][sc]
    })
  })
}

/** Blank every cell outside the silhouette.
 *
 *  `keepTemplateCells` re-stamps the template's own stitches over the result.
 *  A stocking is usually an outline, and that outline is the line you cut and
 *  sew to — losing it under the photo defeats the point of importing into a
 *  shape. Off, the photo owns every cell inside the bounds, which is what a
 *  filled silhouette wants.
 */
export function applySilhouetteMask(
  cells: string[][],
  mask: boolean[][],
  templateCells?: string[][] | null,
  keepTemplateCells = false,
): string[][] {
  const rows = cells.length
  const cols = cells[0]?.length ?? 0
  const fitted = resampleMask(mask, rows, cols)
  const fittedTemplate =
    keepTemplateCells && templateCells?.length
      ? resampleCells(templateCells, rows, cols)
      : null

  return cells.map((row, r) =>
    row.map((cell, c) => {
      if (!fitted[r][c]) return BLANK_CELL
      const templateCell = fittedTemplate?.[r]?.[c]
      if (templateCell && templateCell !== BLANK_CELL) return templateCell
      return cell
    })
  )
}

/** Nearest-neighbour resample for the template's colours, so `keepTemplateCells`
 *  survives a mesh or size change alongside the mask it belongs to. */
function resampleCells(cells: string[][], rows: number, cols: number): string[][] {
  const sourceRows = cells.length
  const sourceCols = cells[0]?.length ?? 0
  if (!sourceRows || !sourceCols) return Array.from({ length: rows }, () => new Array(cols).fill(BLANK_CELL))
  if (sourceRows === rows && sourceCols === cols) return cells

  return Array.from({ length: rows }, (_, r) => {
    const sr = Math.min(sourceRows - 1, Math.floor((r * sourceRows) / rows))
    return Array.from({ length: cols }, (_, c) => {
      const sc = Math.min(sourceCols - 1, Math.floor((c * sourceCols) / cols))
      return cells[sr][sc]
    })
  })
}

/** Share of the grid the silhouette occupies — for telling the user how much of
 *  their photo is going to survive the crop before they commit to it. */
export function maskCoverage(mask: boolean[][]): number {
  let inside = 0
  let total = 0
  for (const row of mask) {
    for (const cell of row) {
      total += 1
      if (cell) inside += 1
    }
  }
  return total ? inside / total : 0
}
