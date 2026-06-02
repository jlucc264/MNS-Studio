import math

# Three known price points: (canvas_sq_in, price_cents)
_ANCHORS = [
    (30, 900),    # 5×6  = $9
    (48, 1200),   # 6×8  = $12
    (96, 1400),   # 8×12 = $14
]

PRINT_OWN_BASE_CENTS = 1500       # $15
PRINT_GALLERY_BASE_CENTS = 2000   # $20
TEMPLATE_PRICE_CENTS = 500        # $5
CREATOR_EARNINGS_CENTS = 450      # $4.50 per template or gallery print sale


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


def get_canvas_for_design(width_inches: float, height_inches: float) -> dict:
    """Compute canvas dimensions (2" waste on each side, rounded up) and interpolated price."""
    canvas_w = math.ceil(width_inches + 4)
    canvas_h = math.ceil(height_inches + 4)
    price = _interpolate_price_cents(canvas_w * canvas_h)
    return {
        "label": f"{canvas_w}×{canvas_h}",
        "width": canvas_w,
        "height": canvas_h,
        "price_cents": price,
    }


def print_own_total_cents(canvas: dict) -> int:
    return PRINT_OWN_BASE_CENTS + canvas["price_cents"]


def print_gallery_total_cents(canvas: dict) -> int:
    return PRINT_GALLERY_BASE_CENTS + canvas["price_cents"]
