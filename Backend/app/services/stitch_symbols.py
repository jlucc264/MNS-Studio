"""Symbol set for the purchaser-facing stitch guide.

Glyphs are DRAWN, not typeset. The PDF pipeline has only Helvetica plus
reportlab's bundled Bitstream Vera, and neither carries the geometric block a
chart needs (filled circles, half-filled squares, crossed boxes). Typesetting
them would silently produce blank cells or tofu on whatever machine renders the
job.

Drawing them also buys the thing the whole set depends on: exact control of ink
weight. At chart size the eye resolves how dark a cell is well before it
resolves what shape is in it, so the set is tiered by coverage first and
topology second. A misread then costs you a neighbour inside one tier rather
than anywhere in the alphabet.

Each glyph is a small program over the unit square, so one definition serves
both the renderer and the confusability measurement below — a symbol cannot
score well in testing and then draw differently on the page.
"""

from dataclasses import dataclass, field

# Ink coverage bands, as a fraction of the cell. The gaps between bands are
# deliberate: two glyphs one band apart must differ in weight by enough to
# survive a cheap printer and a squint.
TIER_LIGHT = "light"
TIER_MEDIUM = "medium"
TIER_HEAVY = "heavy"


@dataclass(frozen=True)
class Glyph:
    """`ops` are unit-square primitives, all coordinates in 0..1:
        ("circle", cx, cy, r, filled)
        ("rect", x, y, w, h, filled)
        ("poly", [(x, y), ...], filled)
        ("line", x1, y1, x2, y2)
        ("hole_circle", cx, cy, r)      -- knocked out in white
        ("hole_rect", x, y, w, h)       -- knocked out in white

    A hole is a distinct primitive rather than an unfilled shape drawn on top:
    an outline stroked in ink over an inked fill is invisible, which is how the
    first draft of bullseye and boxed_dot rendered identically to a plain disc
    and square. The confusability measurement caught it at 1.000.
    """
    key: str
    tier: str
    ops: list = field(default_factory=list)


def _c(cx, cy, r, filled=True): return ("circle", cx, cy, r, filled)
def _r(x, y, w, h, filled=True): return ("rect", x, y, w, h, filled)
def _p(points, filled=True): return ("poly", points, filled)
def _l(x1, y1, x2, y2): return ("line", x1, y1, x2, y2)
def _hc(cx, cy, r): return ("hole_circle", cx, cy, r)
def _hr(x, y, w, h): return ("hole_rect", x, y, w, h)


# Shared outlines, so an open glyph and its filled twin are the same shape at
# different weights rather than two hand-drawn near-misses.
_TRI_UP = [(0.5, 0.14), (0.90, 0.83), (0.10, 0.83)]
_TRI_DOWN = [(0.10, 0.17), (0.90, 0.17), (0.5, 0.86)]
_DIAMOND = [(0.5, 0.10), (0.90, 0.5), (0.5, 0.90), (0.10, 0.5)]
_STAR = [
    (0.50, 0.06), (0.61, 0.38), (0.95, 0.38), (0.68, 0.58),
    (0.78, 0.92), (0.50, 0.72), (0.22, 0.92), (0.32, 0.58),
    (0.05, 0.38), (0.39, 0.38),
]


SYMBOLS: list[Glyph] = [
    # ── Heavy: reads as a dark cell ────────────────────────────────────────
    Glyph("disc",          TIER_HEAVY,  [_c(0.5, 0.5, 0.40)]),
    Glyph("square",        TIER_HEAVY,  [_r(0.12, 0.12, 0.76, 0.76)]),
    Glyph("diamond",       TIER_HEAVY,  [_p(_DIAMOND)]),
    Glyph("triangle_up",   TIER_HEAVY,  [_p(_TRI_UP)]),
    Glyph("triangle_down", TIER_HEAVY,  [_p(_TRI_DOWN)]),
    Glyph("star",          TIER_HEAVY,  [_p(_STAR)]),
    # Half-filled cells: unmistakable at any size, and the split direction is
    # a strong cue precisely because it is a straight edge through the middle.
    Glyph("half_left",     TIER_HEAVY,  [_r(0.10, 0.10, 0.40, 0.80)]),
    Glyph("half_bottom",   TIER_HEAVY,  [_r(0.10, 0.50, 0.80, 0.40)]),
    Glyph("box_cross",     TIER_MEDIUM, [_r(0.14, 0.14, 0.72, 0.72, False), _l(0.14, 0.14, 0.86, 0.86), _l(0.86, 0.14, 0.14, 0.86)]),
    Glyph("thick_cross",   TIER_MEDIUM, [_p([(0.22, 0.10), (0.50, 0.38), (0.78, 0.10), (0.90, 0.22),
                                             (0.62, 0.50), (0.90, 0.78), (0.78, 0.90), (0.50, 0.62),
                                             (0.22, 0.90), (0.10, 0.78), (0.38, 0.50), (0.10, 0.22)])]),
    Glyph("stripes_h",     TIER_MEDIUM, [_r(0.10, 0.18, 0.80, 0.14), _r(0.10, 0.43, 0.80, 0.14), _r(0.10, 0.68, 0.80, 0.14)]),
    Glyph("checker",       TIER_MEDIUM, [_r(0.12, 0.12, 0.38, 0.38), _r(0.50, 0.50, 0.38, 0.38)]),
    Glyph("chevron_up",    TIER_MEDIUM, [_p([(0.5, 0.14), (0.90, 0.52), (0.74, 0.52), (0.5, 0.32),
                                             (0.26, 0.52), (0.10, 0.52)]),
                                         _p([(0.5, 0.48), (0.90, 0.86), (0.74, 0.86), (0.5, 0.66),
                                             (0.26, 0.86), (0.10, 0.86)])]),
    Glyph("hourglass",     TIER_MEDIUM, [_p([(0.14, 0.12), (0.86, 0.12), (0.5, 0.5), (0.86, 0.88), (0.14, 0.88), (0.5, 0.5)])]),
    Glyph("bowtie",        TIER_MEDIUM, [_p([(0.12, 0.14), (0.12, 0.86), (0.5, 0.5)]), _p([(0.88, 0.14), (0.88, 0.86), (0.5, 0.5)])]),
    Glyph("ring_dot",      TIER_MEDIUM, [_c(0.5, 0.5, 0.40, False), _c(0.5, 0.5, 0.15)]),
    Glyph("corner_marks",  TIER_MEDIUM, [_r(0.10, 0.10, 0.26, 0.26), _r(0.64, 0.10, 0.26, 0.26),
                                         _r(0.10, 0.64, 0.26, 0.26), _r(0.64, 0.64, 0.26, 0.26)]),

    # ── Light: reads as a pale cell ───────────────────────────────────────
    Glyph("circle_open",   TIER_LIGHT,  [_c(0.5, 0.5, 0.38, False)]),
    Glyph("square_open",   TIER_LIGHT,  [_r(0.14, 0.14, 0.72, 0.72, False)]),
    Glyph("diamond_open",  TIER_LIGHT,  [_p(_DIAMOND, False)]),
    Glyph("tri_up_open",   TIER_LIGHT,  [_p(_TRI_UP, False)]),
    Glyph("tri_down_open", TIER_LIGHT,  [_p(_TRI_DOWN, False)]),
    Glyph("star_open",     TIER_LIGHT,  [_p(_STAR, False)]),
    Glyph("plus",          TIER_LIGHT,  [_l(0.5, 0.16, 0.5, 0.84), _l(0.16, 0.5, 0.84, 0.5)]),
    Glyph("cross",         TIER_LIGHT,  [_l(0.20, 0.20, 0.80, 0.80), _l(0.80, 0.20, 0.20, 0.80)]),
    Glyph("dot",           TIER_LIGHT,  [_c(0.5, 0.5, 0.17)]),
    Glyph("two_dots",      TIER_LIGHT,  [_c(0.32, 0.5, 0.14), _c(0.68, 0.5, 0.14)]),
    Glyph("corner_L",      TIER_LIGHT,  [_l(0.20, 0.16, 0.20, 0.82), _l(0.20, 0.82, 0.82, 0.82)]),
]


def symbols_by_tier(tier: str) -> list[Glyph]:
    return [glyph for glyph in SYMBOLS if glyph.tier == tier]


# The guide supports exactly as many colours as there are symbols that stay
# apart at chart size. The number falls out of the set rather than the set
# being padded to hit a number: a design past it gets the colour chart and an
# explicit message, never a symbol quietly reused or two colours merged.
MAX_GUIDE_COLORS = len(SYMBOLS)


# ── Rendering ────────────────────────────────────────────────────────────────

def render_glyph_bitmap(glyph: Glyph, size: int = 24, stroke: float = 0.10):
    """Rasterize to a size x size L-mode image, 0 = ink. Used for the
    confusability measurement; the PDF draws the same ops as vectors.

    `stroke` is in unit-square terms so line weight scales with the cell rather
    than being fixed in points — a hairline that survives at 24px would vanish
    on a chart printed small.
    """
    from PIL import Image, ImageDraw

    image = Image.new("L", (size, size), 255)
    draw = ImageDraw.Draw(image)
    width = max(1, round(stroke * size))
    s = lambda v: v * size  # noqa: E731

    for op in glyph.ops:
        kind = op[0]
        if kind == "circle":
            _, cx, cy, r, filled = op
            box = [s(cx - r), s(cy - r), s(cx + r), s(cy + r)]
            draw.ellipse(box, fill=0 if filled else None, outline=0, width=width)
        elif kind == "rect":
            _, x, y, w, h, filled = op
            box = [s(x), s(y), s(x + w), s(y + h)]
            draw.rectangle(box, fill=0 if filled else None, outline=0, width=width)
        elif kind == "poly":
            _, points, filled = op
            xy = [(s(px), s(py)) for px, py in points]
            if filled:
                draw.polygon(xy, fill=0)
            else:
                draw.line(xy + [xy[0]], fill=0, width=width, joint="curve")
        elif kind == "hole_circle":
            _, cx, cy, r = op
            draw.ellipse([s(cx - r), s(cy - r), s(cx + r), s(cy + r)], fill=255)
        elif kind == "hole_rect":
            _, x, y, w, h = op
            draw.rectangle([s(x), s(y), s(x + w), s(y + h)], fill=255)
        elif kind == "line":
            _, x1, y1, x2, y2 = op
            draw.line([s(x1), s(y1), s(x2), s(y2)], fill=0, width=width)
    return image


def ink_coverage(glyph: Glyph, size: int = 24) -> float:
    """Fraction of the cell that is ink — the value the tiers are meant to
    separate, measured rather than eyeballed."""
    image = render_glyph_bitmap(glyph, size)
    pixels = list(image.getdata())
    return sum(1 for p in pixels if p < 128) / len(pixels)


def confusability(a: Glyph, b: Glyph, size: int = 24) -> float:
    """0 = unmistakable, 1 = identical.

    Intersection-over-union of the two ink masks, blurred first. The blur is
    the point: it stands in for a chart printed small and read at arm's length,
    where fine interior detail closes up. Comparing crisp bitmaps would rate
    box_plus and box_cross as far apart when in practice they are the pair most
    likely to be misread.
    """
    from PIL import ImageFilter

    radius = max(1, size // 12)
    mask_a = render_glyph_bitmap(a, size).filter(ImageFilter.GaussianBlur(radius))
    mask_b = render_glyph_bitmap(b, size).filter(ImageFilter.GaussianBlur(radius))
    ink_a = [(255 - p) / 255 for p in mask_a.getdata()]
    ink_b = [(255 - p) / 255 for p in mask_b.getdata()]

    intersection = sum(min(x, y) for x, y in zip(ink_a, ink_b))
    union = sum(max(x, y) for x, y in zip(ink_a, ink_b))
    return intersection / union if union else 0.0


def worst_pairs(limit: int = 10, size: int = 24) -> list[tuple[str, str, float]]:
    """The pairs most likely to be misread, worst first. Run this after any
    change to SYMBOLS — a new glyph is only safe relative to the set it joins."""
    scored = []
    for i, a in enumerate(SYMBOLS):
        for b in SYMBOLS[i + 1:]:
            scored.append((a.key, b.key, confusability(a, b, size)))
    scored.sort(key=lambda row: row[2], reverse=True)
    return scored[:limit]


# ── Assignment ───────────────────────────────────────────────────────────────

def _hex_to_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def _oklab(hex_color: str) -> tuple[float, float, float]:
    from .stitch_visualizer import srgb_to_oklab
    return srgb_to_oklab(_hex_to_rgb(hex_color))


def color_distance(a: str, b: str) -> float:
    """Perceptual distance in OKLab — the same space the quantizer works in, so
    "these two colours look alike" means the same thing here as it does there."""
    la, aa, ba = _oklab(a)
    lb, ab, bb = _oklab(b)
    return ((la - lb) ** 2 + (aa - ab) ** 2 + (ba - bb) ** 2) ** 0.5


class PaletteTooLargeForSymbols(Exception):
    """More colours than the symbol set can keep apart. The caller falls back to
    the colour chart — never to a reused symbol or a merged palette, both of
    which mislead the stitcher rather than inconveniencing them."""

    def __init__(self, color_count: int):
        self.color_count = color_count
        self.max_colors = MAX_GUIDE_COLORS
        super().__init__(
            f"This design uses {color_count} colours. Stitch guides support up to "
            f"{MAX_GUIDE_COLORS} distinct symbols. A colour chart is included instead."
        )


def assign_symbols(
    palette: list[dict],
    confusable_at: float = 0.80,
) -> dict[str, Glyph]:
    """Map each palette colour to a symbol, keyed by hex.

    `palette` is [{"hex": "#RRGGBB", "count": int}, ...]; count is stitch usage.

    Primary rule is value matching: dark threads get heavy symbols and pale
    threads light ones, so the chart reads as a picture of the finished piece
    and the stitcher can orient on it at a glance instead of decoding cell by
    cell.

    That rule fights the second one in principle — glyphs of similar weight are
    the ones most likely to be confused, and value matching deliberately puts
    them on similar colours. A repair pass exists for it: a confusable pair
    landing on two near-identical colours gets swapped apart.

    In practice the pass is inert for the current set, and deliberately so. The
    default threshold sits above every remaining pair, because culling the
    redundant families already did this job properly — separating glyphs is a
    better fix than shuffling which colour wears them. Set lower only after
    adding a glyph that measures close to an existing one, and expect the value
    ordering to suffer where it fires: an early draft at 0.70 chased the
    disc/square false positive and put the heaviest symbol on the palest
    thread.

    Raises PaletteTooLargeForSymbols when there are more colours than symbols.
    """
    if len(palette) > MAX_GUIDE_COLORS:
        raise PaletteTooLargeForSymbols(len(palette))

    # Light threads to light symbols. Both sorted ascending, then zipped.
    by_lightness = sorted(palette, key=lambda entry: _oklab(entry["hex"])[0])
    by_ink = sorted(SYMBOLS, key=ink_coverage, reverse=True)
    assignment: dict[str, Glyph] = {
        entry["hex"]: glyph for entry, glyph in zip(by_lightness, by_ink)
    }

    # Precompute confusable glyph pairs once; the set is small and fixed.
    keys = list(assignment.values())
    pairs = [
        (a, b)
        for i, a in enumerate(keys)
        for b in keys[i + 1:]
        if confusability(a, b) >= confusable_at
    ]
    if not pairs:
        return assignment

    glyph_to_hex = {glyph.key: hex_value for hex_value, glyph in assignment.items()}
    hexes = list(assignment.keys())

    for a, b in pairs:
        hex_a, hex_b = glyph_to_hex[a.key], glyph_to_hex[b.key]
        if color_distance(hex_a, hex_b) >= 0.15:
            continue  # already far enough apart to be unambiguous
        # Swap one of them with whichever colour puts the most distance between
        # this pair, leaving every other colour's symbol untouched.
        best, best_gain = None, 0.0
        for candidate in hexes:
            if candidate in (hex_a, hex_b):
                continue
            gain = min(
                color_distance(hex_a, candidate),
                color_distance(candidate, hex_b),
            ) - color_distance(hex_a, hex_b)
            if gain > best_gain:
                best, best_gain = candidate, gain
        if best is None:
            continue
        moved = assignment[best]
        assignment[best], assignment[hex_b] = assignment[hex_b], moved
        glyph_to_hex[assignment[best].key] = best
        glyph_to_hex[assignment[hex_b].key] = hex_b

    return assignment
