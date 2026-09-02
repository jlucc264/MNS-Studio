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

# Price increase (owner's call), on top of the margin-derived rate above
# rather than folded into TARGET_MATERIAL_MARGIN, so the 80% material basis
# stays legible on its own. Calibrated so a 4x4 print-own design (an 8x8
# canvas, the flagship reference point) lands at exactly $18.00 before the
# round-up-to-50-cents step below: $18.00 / $13.57 original price. (A first
# pass targeted $15.00 = 1500/1357 for 2026-09-01; superseded before launch
# by this larger increase, done at the same time as opening the gallery to
# larger designs below.)
PRICE_INCREASE_MULTIPLIER = 1800 / 1357
PRICE_PER_SQ_IN_CENTS = (
    _MATERIAL_COST_PER_SQ_IN_CENTS / (1 - TARGET_MATERIAL_MARGIN) * PRICE_INCREASE_MULTIPLIER
)


def round_up_to_50_cents(cents: int) -> int:
    """Every customer-facing price rounds up to the nearest 50 cents — cleaner
    price tags, and rounding up (never down) is deliberate for the 2026-09-01
    increase: it never gives back any of the raise."""
    return -(-cents // 50) * 50


# Floor for pathologically small canvases (the smallest design the editor
# allows is 0.5", i.e. a 4.5x4.5 canvas at ~20 sq in). Retained from the
# previous model so a canvas is never priced at a couple of dollars.
# $5.00 originally, scaled by PRICE_INCREASE_MULTIPLIER and rounded up.
MIN_CANVAS_PRICE_CENTS = 700

PRINT_OWN_BASE_CENTS = 950        # $9.50 ($7 originally, scaled + rounded up)
# Kept at the original $5 — owner's call, not scaled with the rest of the
# increase. This is a flat PDF-only product (no printing/material cost), not
# something the rest of this file's margin reasoning applies to.
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
# Anchor prices scaled by PRICE_INCREASE_MULTIPLIER (originally $9/$12/$14).
# These are curve inputs, not a price shown to anyone directly, so they're
# rounded to the cent rather than to 50 cents — belt_canvas_price_cents
# rounds the final output instead.
_LEGACY_ANCHORS = [
    (30, 1194),   # 5×6  = $11.94
    (48, 1592),   # 6×8  = $15.92
    (96, 1857),   # 8×12 = $18.57
]

# Widest canvas the printer can feed. Rolls arrive 40" wide from the supplier
# and get cut down to whatever feed width a job needs, so this is a property of
# the printer, not of the stock. Corrected 2026-08-30 from an assumed 19" —
# 17" is the printer's real practical max, and even a 17" print struggled.
MAX_ROLL_WIDTH_IN = 17.0

# Unstitched canvas left around the design for blocking and framing. 2" is what
# we want; 1" is the least that's still workable. Designs wide enough that 2"
# per side would overrun the roll get the margin trimmed toward the floor rather
# than being refused. Anything needing less than the floor is genuinely
# unprintable.
CANVAS_MARGIN_IN = 2.0
MIN_CANVAS_MARGIN_IN = 1.0

# Floor for a *voluntary* margin trim, which is a different thing from
# MIN_CANVAS_MARGIN_IN entirely. MIN_CANVAS_MARGIN_IN is physics: below it the
# roll cannot print the job at all. This is a comfort floor for a buyer who
# chooses a slightly narrower border to drop a roll tier (see
# tier_downgrade_margin_inches). We would not ship a 1.75" border by default,
# but we will if the buyer picks it over paying a tier more.
DOWNGRADE_MIN_MARGIN_IN = 1.75

# Maximum printable design dimensions (short side × long side) — the hard
# ceiling on what can even be drafted in studio, deliberately below what
# MAX_ROLL_WIDTH_IN - 2*MIN_CANVAS_MARGIN_IN would allow (15"): the owner
# wants real headroom under the printer's practical max, not the theoretical
# one. Long side is bounded by the editor's 20" canvas stage, not the
# printer, since the long axis runs down the roll's unbounded feed direction.
_MAX_PRINT_SHORT_IN = 14.0
_MAX_PRINT_LONG_IN = 20.0

# Self-serve/gallery envelope — see is_standard_order. Short side up to 12"
# (needing at most the 16" roll tier, see STANDARD_WIDTH_TIERS_IN below);
# long side has no separate cap beyond the overall printable ceiling above.
# Anything with a short side over 12" (up to the 14" printable ceiling) still
# prints, but is quoted by hand and cannot be posted to the gallery.
STANDARD_MAX_SHORT_IN = 12.0
STANDARD_MAX_LONG_IN = _MAX_PRINT_LONG_IN

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
    """A belt is narrow *and* long. The minimum length matters: without it any
    small narrow design — a 1.5"x5" strip — was billed at belt rates, which cost
    $21.59 of canvas instead of $10.50 and made it dearer than designs twice its
    size. Keep this in step with isBeltDesign in Frontend/lib/api.ts."""
    short = min(width_inches, height_inches)
    long = max(width_inches, height_inches)
    return short <= _BELT_SHORT_MAX_IN and BELT_MIN_LENGTH_IN <= long <= BELT_MAX_LENGTH_IN


def is_design_printable(width_inches: float, height_inches: float) -> bool:
    if is_belt_design(width_inches, height_inches):
        return True
    short = min(width_inches, height_inches)
    long = max(width_inches, height_inches)
    return short <= _MAX_PRINT_SHORT_IN and long <= _MAX_PRINT_LONG_IN


def is_standard_order(width_inches: float, height_inches: float) -> bool:
    """Whether a design can be bought self-serve and posted to the gallery.

    Narrower than is_design_printable, which only asks whether the roll can
    physically print it. Gated on short side alone (up to 12", the largest
    size that still fits a pre-cut roll tier — see STANDARD_WIDTH_TIERS_IN);
    past that, large prints are quoted and invoiced by hand instead. Raised
    from 6"x10" to 12"x(printable long max) on 2026-08-30 alongside adding the
    12" and 16" roll tiers.

    Belts are exempt: they are long but narrow, ship in the same tube, and are
    priced off their own curve.
    """
    if is_belt_design(width_inches, height_inches):
        return True
    short = min(width_inches, height_inches)
    long = max(width_inches, height_inches)
    return short <= STANDARD_MAX_SHORT_IN and long <= STANDARD_MAX_LONG_IN


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
    """The canvas line on the invoice: the whole item at TARGET_MATERIAL_MARGIN,
    less the printing-and-fulfillment fee that print_own_total_cents adds back.

    TARGET_MATERIAL_MARGIN applies to the *bundle* of canvas plus fulfillment,
    not to the canvas alone (owner's call, 2026-08). Charging a full-margin
    canvas and then adding $7 of pure contribution on top put the real margin at
    82-87%, not 80. Subtracting the fee here means print_own_total_cents lands on
    exactly PRICE_PER_SQ_IN_CENTS * sq_in — i.e. 5x material cost, an even 80% —
    while the invoice still shows an honest canvas + fulfillment split.

    The floor is applied after the subtraction, so the smallest canvases still
    total $16.50 (a $7 canvas line plus the $9.50 fee) exactly as before.

    Rounds half UP via floor(x + 0.5) rather than using round(), which is
    banker's rounding and would disagree with JavaScript's Math.round on exact
    .5 values (783 sq in lands on exactly 16602.5). The frontend mirrors this
    function to quote prices in the editor, so any divergence shows the user
    one price and charges another at checkout.

    The result is then rounded up to the nearest 50 cents (round_up_to_50_cents)
    — the 2026-09-01 clean-pricing policy — so this is the last place the raw,
    unrounded per-sq-in math is visible.
    """
    item_total = math.floor(PRICE_PER_SQ_IN_CENTS * sq_in + 0.5)
    raw = max(MIN_CANVAS_PRICE_CENTS, item_total - PRINT_OWN_BASE_CENTS)
    return round_up_to_50_cents(raw)


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
    price = mult * legacy + (mult - 1) * base. Rounded up to the nearest 50
    cents like canvas_price_cents, for the same clean-pricing policy."""
    legacy = _legacy_anchor_price_cents(sq_in)
    raw = math.floor(
        BELT_PRICE_MULTIPLIER * legacy + (BELT_PRICE_MULTIPLIER - 1) * PRINT_OWN_BASE_CENTS + 0.5
    )
    return round_up_to_50_cents(raw)


def _fmt_canvas(n: float) -> str:
    return str(int(n)) if n == int(n) else f"{n:.1f}"


# Standard orders (see is_standard_order) are cut from a small set of
# pre-cut roll widths rather than a bespoke width per design — 8", 10", 12"
# and 16" are what's actually kept cut (added the latter two 2026-08-30 when
# the standard envelope grew to a 12" short side), so a design whose required
# width rounds to, say, 8.5" prints on the 10" stock rather than a one-off
# 8.5"/9" cut. This always tops out at STANDARD_MAX_SHORT_IN +
# 2*CANVAS_MARGIN_IN (16"), so 16" is always a safe last resort. Non-standard
# orders and belts stay fully continuous.
STANDARD_WIDTH_TIERS_IN = [8.0, 10.0, 12.0, 16.0]


def tier_downgrade_margin_inches(width_inches: float, height_inches: float) -> float | None:
    """The margin that drops this design one roll tier, or None if there isn't one.

    A design whose short side sits just above a tier boundary pays for a whole
    tier of canvas it barely uses: 12.15x8.15 needs 12.15" of width, clears the
    12" tier by 0.15" and lands on 16" — $74.50 against $54.00. We do not tell
    the designer to resize (a design's size is a design decision, not a pricing
    one); we offer the buyer the trade at the point of purchase instead.

    Deliberately offers only the tier immediately below, never a cascade down
    to the smallest stock that DOWNGRADE_MIN_MARGIN_IN would technically reach.
    One step is a judgement about border width; a cascade is a different design.

    Returns the largest margin that still fits the lower tier — the buyer gives
    up as little border as the tier actually requires, which is often more than
    the DOWNGRADE_MIN_MARGIN_IN floor. Qualifying is equivalent to the short
    side sitting within 0.5" above a tier boundary: it needs
    short + 2*DOWNGRADE_MIN_MARGIN_IN <= tier while short + 2*CANVAS_MARGIN_IN
    already exceeds it.
    """
    if is_belt_design(width_inches, height_inches):
        return None
    if not is_standard_order(width_inches, height_inches):
        return None

    default_margin = canvas_margin_inches(width_inches, height_inches)
    if default_margin <= DOWNGRADE_MIN_MARGIN_IN:
        return None

    short = min(width_inches, height_inches)
    default_tier = _short_side_tier(short + 2 * default_margin)
    index = STANDARD_WIDTH_TIERS_IN.index(default_tier)
    if index == 0:
        return None  # already on the narrowest stock we keep cut

    lower_tier = STANDARD_WIDTH_TIERS_IN[index - 1]
    margin = min(default_margin, (lower_tier - short) / 2)
    if margin < DOWNGRADE_MIN_MARGIN_IN:
        return None
    return margin


def _short_side_tier(short_side_inches: float) -> float:
    """Narrowest pre-cut stock that fits this canvas width.

    The epsilon matters: a downgrade margin is derived as (tier - short)/2, so
    short + 2*margin lands back on the tier through floating point and can come
    out a hair over it (12.000000000000002). Without the tolerance that design
    would be quoted the next tier up — exactly the jump the downgrade exists to
    avoid. 1e-9" is far below any real stitch-quantized dimension.
    """
    for tier in STANDARD_WIDTH_TIERS_IN:
        if tier >= short_side_inches - 1e-9:
            return tier
    return STANDARD_WIDTH_TIERS_IN[-1]


def get_canvas_for_design(
    width_inches: float,
    height_inches: float,
    margin_inches: float | None = None,
) -> dict:
    """Canvas dimensions (design plus waste on each side, rounded to the nearest
    0.5", always rounding UP) and the material price for that area.

    Rounding to the *nearest* half inch silently shaved the margin: a 12.15"
    design needs 16.15" of canvas and was given 16.0", so the quoted 2" margin
    arrived as 1.925". Any dimension landing just above a half-inch mark was
    affected. Ceiling instead, so the canvas is never smaller than the design
    plus the margin it was sold with.

    Standard orders snap their short side up to the nearest tier in
    STANDARD_WIDTH_TIERS_IN instead of a continuous width — see the comment
    there. Whichever of width/height is shorter gets the tiered value; the
    longer side stays continuous (it's the roll's feed direction, cut to
    length per job regardless of which width stock is loaded).

    margin_inches overrides the default margin, for a buyer who chose a tier
    downgrade (see tier_downgrade_margin_inches). Pass the SAME value here and
    to the printed border, or the canvas will not match the stock it was
    priced against.
    """
    margin = (
        canvas_margin_inches(width_inches, height_inches)
        if margin_inches is None
        else margin_inches
    )
    is_belt = is_belt_design(width_inches, height_inches)
    if is_standard_order(width_inches, height_inches) and not is_belt:
        short_side = min(width_inches, height_inches) + 2 * margin
        long_side = math.ceil((max(width_inches, height_inches) + 2 * margin) * 2) / 2
        tier = _short_side_tier(short_side)
        canvas_w, canvas_h = (tier, long_side) if width_inches <= height_inches else (long_side, tier)
    else:
        canvas_w = math.ceil((width_inches + 2 * margin) * 2) / 2
        canvas_h = math.ceil((height_inches + 2 * margin) * 2) / 2
    sq_in = canvas_w * canvas_h
    price = belt_canvas_price_cents(sq_in) if is_belt else canvas_price_cents(sq_in)
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
    a separate base fee) so the two can never drift apart.

    print_own_total_cents is always already a multiple of 50 (base fee plus a
    canvas price that's already rounded), but the 1.2x markup on top of that
    doesn't generally land on one — e.g. $14.00 * 1.2 = $16.80 — so this rounds
    up again rather than assuming the input's cleanliness carries through."""
    raw = math.floor(print_own_total_cents(canvas) * (1 + GALLERY_MARKUP) + 0.5)
    return round_up_to_50_cents(raw)


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
