import math

# Canvas price is derived from a target gross margin on material, not from
# hand-set anchors. The previous three-anchor curve interpolated between
# 30/48/96 sq in and then extrapolated flat, so the effective rate collapsed
# with size — ~30c/sq in at 30 sq in down to ~5.5c at 680. In margin terms
# that was 90%+ on small canvases and ~35% on large ones, i.e. the biggest
# orders were the least profitable.
#
# Roll economics (owner's sizing sheet, 2026-08):
#   A 40" x 270" roll is 10,800 sq in gross and costs $343.50. Roughly 25% is
#   lost to reprints, so ~8,100 sq in is actually sellable. ROLL_SELLABLE_SQ_IN
#   is that post-loss figure — the reprint allowance is ALREADY baked in, so do
#   not apply it a second time when reasoning about cost per square inch.
ROLL_COST_CENTS = 34_350          # $343.50 per roll
ROLL_SELLABLE_SQ_IN = 8_100       # 75% of a 40" x 270" roll; reprint loss removed
TARGET_MATERIAL_MARGIN = 0.80

# price = cost / (1 - margin) holds the margin at every size, which makes the
# canvas charge a flat per-square-inch rate. Small orders stay viable because
# the per-order base fee (PRINT_OWN_BASE_CENTS / PRINT_GALLERY_BASE_CENTS) is
# added on top: that covers payment processing, packaging and handling, none of
# which are in ROLL_COST_CENTS. Margin on the *total* therefore lands above the
# target at small sizes and converges down toward it as area grows.
_MATERIAL_COST_PER_SQ_IN_CENTS = ROLL_COST_CENTS / ROLL_SELLABLE_SQ_IN
PRICE_PER_SQ_IN_CENTS = _MATERIAL_COST_PER_SQ_IN_CENTS / (1 - TARGET_MATERIAL_MARGIN)

# Floor for pathologically small canvases (the smallest design the editor
# allows is 0.5", i.e. a 4.5x4.5 canvas at ~20 sq in). Retained from the
# previous model so a canvas is never priced at a couple of dollars.
MIN_CANVAS_PRICE_CENTS = 500

PRINT_OWN_BASE_CENTS = 700        # $7
TEMPLATE_PRICE_CENTS = 500        # $5

# A gallery print costs this much more than printing your own design. The
# markup is not profit — it is passed through to the creator 1:1 (see
# creator_earnings_cents), so the business nets the same either way and the
# premium is what nudges people toward designing their own.
#
# Note the markup and the creator's share are the SAME number by design. That
# only works because the share is taken off the print-own base, not off the
# marked-up gallery total: 20% of the marked-up price would exceed the 20% the
# buyer paid, and the difference would come out of the business. (Replaces the
# old flat $5 PRINT_GALLERY_BASE_CENTS adder, which fell further behind the
# creator payout as canvases got bigger — at 13x20 it was a ~$15 subsidy.)
GALLERY_MARKUP = 0.20
CREATOR_SHARE_OF_PRINT_OWN = 0.20

# Belts are priced off the legacy anchor curve rather than the per-sq-in rate.
# The canvas math adds 2" of margin per side, so a 1.25"-tall strap becomes a
# 5"-tall canvas and ~80% of a flat-rate belt charge would be margin the
# customer never sees. Owner's call (2026-08): 1.5x the previous belt price.
BELT_PRICE_MULTIPLIER = 1.5
_LEGACY_ANCHORS = [
    (30, 900),    # 5×6  = $9
    (48, 1200),   # 6×8  = $12
    (96, 1400),   # 8×12 = $14
]

# Widest canvas the printer can feed. Rolls arrive 40" wide from the supplier
# and get cut down to whatever feed width a job needs, so this is a property of
# the printer, not of the stock.
MAX_ROLL_WIDTH_IN = 17.0

# Unstitched canvas left around the design for blocking and framing. 2" is what
# we want; 1" is the least that's still workable. Designs wide enough that 2"
# per side would overrun the roll get the margin trimmed toward the floor rather
# than being refused — that's what lets a 15" design (17" at 1") print at all.
# Anything needing less than the floor is genuinely unprintable.
CANVAS_MARGIN_IN = 2.0
MIN_CANVAS_MARGIN_IN = 1.0

# Maximum printable design dimensions (short side × long side).
# Short side is the roll minus the *minimum* margin on both edges; long side is
# bounded by the editor's 20" canvas stage, not by the printer, since the long
# axis runs down the roll's unbounded feed direction.
_MAX_PRINT_SHORT_IN = MAX_ROLL_WIDTH_IN - 2 * MIN_CANVAS_MARGIN_IN  # 15.0
_MAX_PRINT_LONG_IN = 20.0

# Belt mode: a long, narrow strip that doesn't fit the normal short/long
# envelope above. Mirrors the frontend's belt constants (studio/page.tsx) —
# geometry-only, so any belt-shaped design clears the same printability gate
# used by checkout/cart/gallery without threading an is_belt flag through them.
BELT_HEIGHT_INCHES = 1.25
BELT_MESH_COUNT = 18
BELT_TAIL_INCHES = 4.0
BELT_MIN_LENGTH_IN = 20.0
BELT_MAX_LENGTH_IN = 60.0
_BELT_SHORT_MAX_IN = 1.75  # headroom above BELT_HEIGHT_INCHES for float drift


def is_belt_design(width_inches: float, height_inches: float) -> bool:
    short = min(width_inches, height_inches)
    long = max(width_inches, height_inches)
    return short <= _BELT_SHORT_MAX_IN and long <= BELT_MAX_LENGTH_IN


def is_design_printable(width_inches: float, height_inches: float) -> bool:
    if is_belt_design(width_inches, height_inches):
        return True
    short = min(width_inches, height_inches)
    long = max(width_inches, height_inches)
    return short <= _MAX_PRINT_SHORT_IN and long <= _MAX_PRINT_LONG_IN


def canvas_margin_inches(width_inches: float, height_inches: float) -> float:
    """Unstitched margin on every side of the design, in inches.

    The full CANVAS_MARGIN_IN wherever it fits the roll, shrinking toward
    MIN_CANVAS_MARGIN_IN for designs too wide to afford it. The roll only
    constrains the short side — the long side runs down the feed direction —
    so the trim is driven by min(width, height).

    Both the price and the printed border must come from this one function: if
    pricing assumed 1" and the printer drew 2", the canvas would be 2" wider
    than the roll and generate_roll_print_pdf would reject the job.
    """
    short = min(width_inches, height_inches)
    affordable = (MAX_ROLL_WIDTH_IN - short) / 2
    return max(MIN_CANVAS_MARGIN_IN, min(CANVAS_MARGIN_IN, affordable))


def canvas_price_cents(sq_in: float) -> int:
    """Material charge for a canvas of `sq_in`, at TARGET_MATERIAL_MARGIN.

    Flat per-square-inch by construction — see PRICE_PER_SQ_IN_CENTS. The
    per-order base fee is added by print_own_total_cents / print_gallery_total_cents.

    Rounds half UP via floor(x + 0.5) rather than using round(), which is
    banker's rounding and would disagree with JavaScript's Math.round on exact
    .5 values (783 sq in lands on exactly 16602.5). The frontend mirrors this
    function to quote prices in the editor, so any divergence shows the user
    one price and charges another at checkout.
    """
    return max(MIN_CANVAS_PRICE_CENTS, math.floor(PRICE_PER_SQ_IN_CENTS * sq_in + 0.5))


def _legacy_anchor_price_cents(sq_in: float) -> int:
    """The pre-2026-08 interpolated anchor curve. Retained only as the basis for
    belt pricing (see belt_canvas_price_cents) — everything else uses the flat
    per-sq-in rate."""
    if sq_in <= _LEGACY_ANCHORS[0][0]:
        slope = (_LEGACY_ANCHORS[1][1] - _LEGACY_ANCHORS[0][1]) / (_LEGACY_ANCHORS[1][0] - _LEGACY_ANCHORS[0][0])
        return max(MIN_CANVAS_PRICE_CENTS, math.floor(_LEGACY_ANCHORS[0][1] + slope * (sq_in - _LEGACY_ANCHORS[0][0]) + 0.5))
    for i in range(len(_LEGACY_ANCHORS) - 1):
        a1_sq, a1_p = _LEGACY_ANCHORS[i]
        a2_sq, a2_p = _LEGACY_ANCHORS[i + 1]
        if sq_in <= a2_sq:
            t = (sq_in - a1_sq) / (a2_sq - a1_sq)
            return math.floor(a1_p + t * (a2_p - a1_p) + 0.5)
    a1_sq, a1_p = _LEGACY_ANCHORS[-2]
    a2_sq, a2_p = _LEGACY_ANCHORS[-1]
    slope = (a2_p - a1_p) / (a2_sq - a1_sq)
    return math.floor(a2_p + slope * (sq_in - a2_sq) + 0.5)


def belt_canvas_price_cents(sq_in: float) -> int:
    """Belt material charge, set so the print-own TOTAL comes out at exactly
    BELT_PRICE_MULTIPLIER x the old total (base fee included, which is what the
    customer actually sees). Solving base + price = mult * (base + legacy) gives
    price = mult * legacy + (mult - 1) * base."""
    legacy = _legacy_anchor_price_cents(sq_in)
    return math.floor(
        BELT_PRICE_MULTIPLIER * legacy + (BELT_PRICE_MULTIPLIER - 1) * PRINT_OWN_BASE_CENTS + 0.5
    )


def _fmt_canvas(n: float) -> str:
    return str(int(n)) if n == int(n) else f"{n:.1f}"


def get_canvas_for_design(width_inches: float, height_inches: float) -> dict:
    """Canvas dimensions (design plus waste on each side, rounded to the nearest
    0.5") and the material price for that area."""
    margin = canvas_margin_inches(width_inches, height_inches)
    canvas_w = round((width_inches + 2 * margin) * 2) / 2
    canvas_h = round((height_inches + 2 * margin) * 2) / 2
    sq_in = canvas_w * canvas_h
    price = (
        belt_canvas_price_cents(sq_in)
        if is_belt_design(width_inches, height_inches)
        else canvas_price_cents(sq_in)
    )
    return {
        "label": f"{_fmt_canvas(canvas_w)}×{_fmt_canvas(canvas_h)}",
        "width": canvas_w,
        "height": canvas_h,
        "price_cents": price,
    }


def print_own_total_cents(canvas: dict) -> int:
    return PRINT_OWN_BASE_CENTS + canvas["price_cents"]


def print_gallery_total_cents(canvas: dict) -> int:
    """Print-own plus the creator markup. Derived from the print-own total (not
    a separate base fee) so the two can never drift apart."""
    return math.floor(print_own_total_cents(canvas) * (1 + GALLERY_MARKUP) + 0.5)


def creator_earnings_cents(gallery_total_cents: int) -> int:
    """The creator's cut of a gallery sale.

    Deliberately equal to the markup the buyer paid: the share is taken off the
    print-own base, recovered by dividing the markup back out, NOT off the
    gallery total. Taking 20% of the gallery total would pay out more than the
    buyer contributed and the business would eat the difference.

    `gallery_total_cents` must be the item's own price — never Stripe's
    amount_total, which includes shipping.
    """
    print_own_equivalent = gallery_total_cents / (1 + GALLERY_MARKUP)
    return math.floor(print_own_equivalent * CREATOR_SHARE_OF_PRINT_OWN + 0.5)
