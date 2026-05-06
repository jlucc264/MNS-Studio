CANVAS_SIZES = [
    {"label": "5×6", "width": 5, "height": 6, "price_cents": 900},
    {"label": "6×8", "width": 6, "height": 8, "price_cents": 1200},
    {"label": "8×12", "width": 8, "height": 12, "price_cents": 1400},
]

PRINT_OWN_BASE_CENTS = 1500       # $15
PRINT_GALLERY_BASE_CENTS = 2000   # $20
TEMPLATE_PRICE_CENTS = 500        # $5
CREATOR_EARNINGS_CENTS = 450      # $4.50 per template or gallery print sale


def get_canvas_for_design(width_inches: float, height_inches: float) -> dict | None:
    """Return the smallest canvas that fits the design including the 1" border on each side."""
    canvas_w = width_inches + 2.0
    canvas_h = height_inches + 2.0
    for size in CANVAS_SIZES:
        fits_portrait = canvas_w <= size["width"] and canvas_h <= size["height"]
        fits_landscape = canvas_w <= size["height"] and canvas_h <= size["width"]
        if fits_portrait or fits_landscape:
            return size
    return None


def print_own_total_cents(canvas: dict) -> int:
    return PRINT_OWN_BASE_CENTS + canvas["price_cents"]


def print_gallery_total_cents(canvas: dict) -> int:
    return PRINT_GALLERY_BASE_CENTS + canvas["price_cents"]
