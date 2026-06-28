import math

# Three known price points: (canvas_sq_in, price_cents)
_ANCHORS = [
    (30, 900),    # 5×6  = $9
    (48, 1200),   # 6×8  = $12
    (96, 1400),   # 8×12 = $14
]

PRINT_OWN_BASE_CENTS = 1200       # $12
PRINT_GALLERY_BASE_CENTS = 1700   # $17
TEMPLATE_PRICE_CENTS = 500        # $5
# Creator earnings: 18% of sale amount_total, recorded in main.py _record_creator_earnings

# Maximum printable design dimensions (short side × long side).
# Corresponds to an 8×12 canvas with 1" stitching margin each side.
_MAX_PRINT_SHORT_IN = 6.0
_MAX_PRINT_LONG_IN = 10.0


def is_design_printable(width_inches: float, height_inches: float) -> bool:
    short = min(width_inches, height_inches)
    long = max(width_inches, height_inches)
    return short <= _MAX_PRINT_SHORT_IN and long <= _MAX_PRINT_LONG_IN


def _interpolate_price_cents(sq_in: float) -> int:
    if sq_in <= _ANCHORS[0][0]:
        slope = (_ANCHORS[1][1] - _ANCHORS[0][1]) / (_ANCHORS[1][0] - _ANCHORS[0][0])
        return max(500, round(_ANCHORS[0][1] + slope * (sq_in - _ANCHORS[0][0])))
    for i in range(len(_ANCHORS) - 1):
        a1_sq, a1_p = _ANCHORS[i]
        a2_sq, a2_p = _ANCHORS[i + 1]
        if sq_in <= a2_sq:
            t = (sq_in - a1_sq) / (a2_sq - a1_sq)
            return round(a1_p + t * (a2_p - a1_p))
    a1_sq, a1_p = _ANCHORS[-2]
    a2_sq, a2_p = _ANCHORS[-1]
    slope = (a2_p - a1_p) / (a2_sq - a1_sq)
    return round(a2_p + slope * (sq_in - a2_sq))


def _fmt_canvas(n: float) -> str:
    return str(int(n)) if n == int(n) else f"{n:.1f}"


def get_canvas_for_design(width_inches: float, height_inches: float) -> dict:
    """Compute canvas dimensions (2" waste on each side, rounded to nearest 0.5") and interpolated price."""
    canvas_w = round((width_inches + 4) * 2) / 2
    canvas_h = round((height_inches + 4) * 2) / 2
    price = _interpolate_price_cents(canvas_w * canvas_h)
    return {
        "label": f"{_fmt_canvas(canvas_w)}×{_fmt_canvas(canvas_h)}",
        "width": canvas_w,
        "height": canvas_h,
        "price_cents": price,
    }


def print_own_total_cents(canvas: dict) -> int:
    return PRINT_OWN_BASE_CENTS + canvas["price_cents"]


def print_gallery_total_cents(canvas: dict) -> int:
    return PRINT_GALLERY_BASE_CENTS + canvas["price_cents"]
