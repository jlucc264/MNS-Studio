/** Resizing a stitch grid.
 *
 *  Every cell in these grids is a real thread someone has to buy, so this is
 *  pixel-art scaling, not image scaling: no averaging, no interpolation, no
 *  smoothing. A blended edge would produce a colour that exists on no shade
 *  card. Every cell in the output came from a cell in the input.
 */

const BLANK_CELL = '__BLANK__'

/** A cell with nothing stitched in it. Saved grids write the sentinel string; a
 *  floating stamp uses null for the same idea, because the cells outside a
 *  cut-out shape must let the canvas underneath show through. Both are empty
 *  and both lose ties on the way down. */
function isEmptyCell(cell: string | null): boolean {
  return cell === null || cell === BLANK_CELL
}

/** Below this, a one-stitch line has nowhere to go and drops out whichever way
 *  you resample. Callers warn rather than refuse — sometimes a blurry motif is
 *  what you wanted — but it is the point past which the result stops being a
 *  faithful shrink of the original. */
export const DETAIL_LOSS_SCALE = 0.5

/** How close a scale has to be to a whole-number factor before it snaps to it.
 *  Halving or thirding maps every target cell onto a tidy block of source
 *  cells; 0.47 smears the same content across an uneven one for no visible
 *  gain, so a few percent of size is worth trading for the cleaner grid. */
const SNAP_TOLERANCE = 0.08

function nearest<T extends string | null>(cells: T[][], rows: number, cols: number): T[][] {
  const srcRows = cells.length
  const srcCols = cells[0]?.length ?? 0
  return Array.from({ length: rows }, (_, r) => {
    const sr = Math.min(srcRows - 1, Math.floor((r * srcRows) / rows))
    return Array.from({ length: cols }, (_, c) => {
      const sc = Math.min(srcCols - 1, Math.floor((c * srcCols) / cols))
      return cells[sr][sc]
    })
  })
}

/** Most common colour in the block of source cells each target cell covers.
 *
 *  Nearest-neighbour samples one point per target cell, so shrinking can
 *  delete a feature outright when the point lands just beside it — a sampled
 *  outline survives or vanishes on where the arithmetic happens to land.
 *  Taking the majority of the block keeps shape and mass, and a colour that
 *  wins can only be a colour that was there.
 *
 *  Blank loses every tie it is in. Background is usually the largest area, and
 *  letting it win ties eats the edges of the very motif being imported.
 */
function majority<T extends string | null>(cells: T[][], rows: number, cols: number): T[][] {
  const srcRows = cells.length
  const srcCols = cells[0]?.length ?? 0

  return Array.from({ length: rows }, (_, r) => {
    const r0 = Math.floor((r * srcRows) / rows)
    const r1 = Math.max(r0 + 1, Math.floor(((r + 1) * srcRows) / rows))
    return Array.from({ length: cols }, (_, c) => {
      const c0 = Math.floor((c * srcCols) / cols)
      const c1 = Math.max(c0 + 1, Math.floor(((c + 1) * srcCols) / cols))

      const counts = new Map<T, number>()
      for (let sr = r0; sr < Math.min(r1, srcRows); sr += 1) {
        for (let sc = c0; sc < Math.min(c1, srcCols); sc += 1) {
          const cell = cells[sr][sc]
          counts.set(cell, (counts.get(cell) ?? 0) + 1)
        }
      }

      let best = cells[Math.min(r0, srcRows - 1)][Math.min(c0, srcCols - 1)]
      let bestCount = -1
      counts.forEach((count, cell) => {
        const beatsOnCount = count > bestCount
        const winsTieOverEmpty = count === bestCount && isEmptyCell(best) && !isEmptyCell(cell)
        if (beatsOnCount || winsTieOverEmpty) {
          best = cell
          bestCount = count
        }
      })
      return best
    })
  })
}

/** Resize a stitch grid to an exact cell count. */
export function scaleStitchCells<T extends string | null>(cells: T[][], rows: number, cols: number): T[][] {
  const srcRows = cells.length
  const srcCols = cells[0]?.length ?? 0
  if (!srcRows || !srcCols || rows < 1 || cols < 1) return cells
  if (srcRows === rows && srcCols === cols) return cells
  // Growing has no block to take a majority of, and nearest-neighbour is the
  // right answer there: it repeats cells rather than inventing them.
  return rows >= srcRows && cols >= srcCols ? nearest(cells, rows, cols) : majority(cells, rows, cols)
}

/** Snap to a whole-number factor when one is within reach, in either direction. */
function snapScale(scale: number): number {
  if (scale <= 0) return scale
  if (scale < 1) {
    const divisor = 1 / scale
    const whole = Math.round(divisor)
    if (whole >= 2 && Math.abs(divisor - whole) / whole <= SNAP_TOLERANCE) return 1 / whole
    return scale
  }
  const whole = Math.round(scale)
  if (whole >= 2 && Math.abs(scale - whole) / whole <= SNAP_TOLERANCE) return whole
  return scale
}

export type StampSize = {
  rows: number
  cols: number
  /** Applied scale as a percentage, for showing and for the size control. */
  scalePercent: number
  /** True once a one-stitch feature can no longer survive the shrink. */
  detailLoss: boolean
  /** True when the design had to be shrunk to fit rather than just re-meshed. */
  clampedToCanvas: boolean
}

export type StampFitOptions = {
  sourceMeshCount?: number | null
  targetMeshCount?: number | null
  maxRows: number
  maxCols: number
  scaleOverride?: number | null
}

/** The size a design would end up at, without building the grid to find out.
 *
 *  Separate from fitStampToCanvas because a picker showing fifty designs wants
 *  to label every row with what it will become, and materialising fifty full
 *  stitch grids to read two numbers off each is millions of cells of work per
 *  render for something the arithmetic already knows.
 */
export function stampSizeFor(
  sourceRows: number,
  sourceCols: number,
  options: StampFitOptions,
): StampSize | null {
  const { sourceMeshCount, targetMeshCount, maxRows, maxCols, scaleOverride } = options
  if (sourceRows < 1 || sourceCols < 1 || maxRows < 1 || maxCols < 1) return null

  const meshScale =
    scaleOverride != null
      ? scaleOverride / 100
      : sourceMeshCount && targetMeshCount
        ? targetMeshCount / sourceMeshCount
        : 1

  const fitScale = Math.min(maxRows / sourceRows, maxCols / sourceCols)
  const clampedToCanvas = meshScale > fitScale
  let scale = snapScale(Math.min(meshScale, fitScale))
  // Snapping rounds outward as often as inward, and outward can push a design
  // back over the edge it was just fitted inside. When the clean factor and the
  // canvas disagree, the canvas wins and the exact fit is used: a design that
  // needed two percent trimmed should not lose a third of its size to land on
  // a tidy divisor. Snapping still applies whenever it rounds inward, which is
  // the case where it costs nothing.
  if (scale > fitScale) scale = Math.min(meshScale, fitScale)

  const rows = Math.max(1, Math.min(maxRows, Math.round(sourceRows * scale)))
  const cols = Math.max(1, Math.min(maxCols, Math.round(sourceCols * scale)))
  return {
    rows,
    cols,
    scalePercent: Math.round((rows / sourceRows) * 100),
    detailLoss: rows / sourceRows < DETAIL_LOSS_SCALE,
    clampedToCanvas,
  }
}

export type StampFit<T extends string | null = string> = StampSize & {
  cells: T[][]
}

/** Fit a design onto a canvas as a stamp.
 *
 *  Default size is physical, not stitch-for-stitch. A design captured at 13
 *  mesh dropped onto an 18 mesh canvas at the same cell count comes out
 *  visibly smaller, because inches are cells over mesh — and inches are what
 *  someone placing a motif is actually thinking in. Scale by the ratio of the
 *  two mesh counts and it arrives the size it looked in the gallery.
 *
 *  Then it is held inside the canvas, since a stamp bigger than the grid can
 *  only ever be cropped. `scaleOverride` (a percentage) skips the mesh
 *  reasoning for someone who just wants it half size; the canvas clamp still
 *  applies, because the alternative is silently cropping their choice.
 */
export function fitStampToCanvas<T extends string | null>(cells: T[][], options: StampFitOptions): StampFit<T> {
  const size = stampSizeFor(cells.length, cells[0]?.length ?? 0, options)
  if (!size) return { cells, rows: cells.length, cols: cells[0]?.length ?? 0, scalePercent: 100, detailLoss: false, clampedToCanvas: false }
  return { ...size, cells: scaleStitchCells(cells, size.rows, size.cols) }
}
