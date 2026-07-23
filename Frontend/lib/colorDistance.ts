function hexToRgb(hex: string) {
  const cleaned = hex.replace('#', '')
  return [
    Number.parseInt(cleaned.slice(0, 2), 16),
    Number.parseInt(cleaned.slice(2, 4), 16),
    Number.parseInt(cleaned.slice(4, 6), 16),
  ] as const
}

export function colorDistance(a: string, b: string) {
  const [ar, ag, ab] = hexToRgb(a)
  const [br, bg, bb] = hexToRgb(b)
  return Math.sqrt((ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2)
}

function hexToHsl(hex: string) {
  const [r8, g8, b8] = hexToRgb(hex)
  const r = r8 / 255
  const g = g8 / 255
  const b = b8 / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l: l * 100 }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  switch (max) {
    case r: h = (g - b) / d + (g < b ? 6 : 0); break
    case g: h = (b - r) / d + 2; break
    default: h = (r - g) / d + 4; break
  }
  return { h: h * 60, s: s * 100, l: l * 100 }
}

function hueDistance(a: number, b: number) {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

const GRAYSCALE_SATURATION_THRESHOLD = 8
const HUE_WINDOW_STEP = 20

// Evenly sample across a lightness-sorted list instead of just taking the
// front of it — the front is whichever end happens to be denser in the DMC
// catalog (usually the dark end), so a plain slice(0, count) after sorting
// returns a cluster of similarly-dark colors instead of a light-to-dark
// spread.
function sampleAcross<T>(sorted: T[], count: number): T[] {
  if (sorted.length <= count) return sorted
  return Array.from({ length: count }, (_, i) => sorted[Math.round((i * (sorted.length - 1)) / (count - 1))])
}

// A "shade picker" ordering — same color family, graded light to dark —
// rather than nearest-by-raw-RGB-distance. Plain Euclidean distance mixes
// hues together (a muted red can be numerically "close" to a muted purple)
// and skews toward matches near the target's own lightness, so a warm red
// mostly surfaced other dark, muted colors instead of a lighter shade of
// red. This widens a hue window until there are enough same-family
// candidates, then samples that set across its lightness range.
export function nearestShades<T extends { hex: string }>(targetHex: string, candidates: T[], count: number): T[] {
  const target = hexToHsl(targetHex)
  const pool = candidates.filter((c) => c.hex.toLowerCase() !== targetHex.toLowerCase())

  // Near-neutral colors don't have a meaningful hue family — grade by lightness instead.
  if (target.s < GRAYSCALE_SATURATION_THRESHOLD) {
    return sampleAcross(
      [...pool].sort((a, b) => hexToHsl(a.hex).l - hexToHsl(b.hex).l),
      count
    )
  }

  for (let window = HUE_WINDOW_STEP; window <= 180; window += HUE_WINDOW_STEP) {
    // Low-saturation candidates (near-black/near-white/gray) have an
    // unstable hue that can coincidentally fall inside the window without
    // actually belonging to this color's family.
    const inFamily = pool.filter(
      (c) => hexToHsl(c.hex).s >= GRAYSCALE_SATURATION_THRESHOLD && hueDistance(hexToHsl(c.hex).h, target.h) <= window
    )
    if (inFamily.length >= count || window >= 180) {
      return sampleAcross(
        inFamily.sort((a, b) => hexToHsl(a.hex).l - hexToHsl(b.hex).l),
        count
      )
    }
  }
  return []
}
