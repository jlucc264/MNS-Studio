import json
import logging
import math
import os
from dataclasses import dataclass
from pathlib import Path
from io import BytesIO
from collections import Counter
from datetime import datetime
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen
from uuid import uuid4
from reportlab.lib.pagesizes import letter, landscape
from reportlab.lib import colors
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from reportlab.pdfbase.pdfdoc import ViewerPreferencesPDFDictionary
from PIL import Image, ImageDraw, ImageFont
import qrcode
import reportlab

from .canvas_pricing import MAX_ROLL_WIDTH_IN, CANVAS_MARGIN_IN, canvas_margin_inches
from .storage import finalized_output_path, preview_output_path, ASSETS_DIR, FINALIZED_DIR
from .supabase_storage import upload_file_to_supabase

logger = logging.getLogger(__name__)

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")

DISPLAY_CELL_SIZE = 12

def _fmt_canvas(n: float) -> str:
    return str(int(n)) if n == int(n) else f"{n:.1f}"


def crop_to_content(cells: list[list[str]]) -> list[list[str]]:
    """Crop cells to the bounding box of non-blank content."""
    if not cells or not cells[0]:
        return cells
    rows, cols = len(cells), len(cells[0])
    min_r, max_r, min_c, max_c = rows, -1, cols, -1
    for r, row in enumerate(cells):
        for c, cell in enumerate(row):
            if cell != BLANK_CELL:
                if r < min_r: min_r = r
                if r > max_r: max_r = r
                if c < min_c: min_c = c
                if c > max_c: max_c = c
    if max_r < 0:
        return cells
    return [row[min_c:max_c + 1] for row in cells[min_r:max_r + 1]]
GRID_COLOR = (180, 180, 180, 255)
BORDER_INCHES = 1.0
PAGE_MARGIN = 42
CARD_RADIUS = 12
BLANK_CELL = "__BLANK__"
FINISH_OUTLINE_CELL = "__FINISH_OUTLINE__"

# Bitstream Vera Bold ships as installed package data with reportlab (an
# existing hard dependency), so this is available in every environment
# without vendoring a font file into the backend ourselves.
_ALIGNMENT_TEST_FONT_PATH = Path(reportlab.__file__).resolve().parent / "fonts" / "VeraBd.ttf"
_ALIGNMENT_TEST_INK = "#211c15"

# Signature placement: anchored to the printed canvas's own bottom-right
# corner (not the design's edge), 1/2" in from it on each axis, so the gap
# to the fabric corner stays fixed regardless of signature size. Clamped
# in _render_preview_image_from_cells so an unusually large signature can
# never creep into the design itself.
SIGNATURE_CORNER_INSET_IN = 0.5
SIGNATURE_MAX_WIDTH_IN = 1.5
SIGNATURE_MAX_HEIGHT_IN = 1.5

# SKU placement: same mechanics as the signature above, mirrored to the
# canvas's own bottom-left corner instead of bottom-right. Per-project (not
# per-creator) — see load_sku_asset.
SKU_CORNER_INSET_IN = 0.5
SKU_MAX_WIDTH_IN = 1.5
SKU_MAX_HEIGHT_IN = 1.0



def _resolve_asset_path(asset_url: str) -> Path:
    cleaned = asset_url.lstrip("/")
    return ASSETS_DIR.parent / cleaned


@dataclass
class SignatureAsset:
    image: "Image.Image | None" = None
    # Present only for pixel-drawn signatures — the raw stitch grid (hex
    # colors + BLANK_CELL), rendered stitch-for-stitch at print time instead
    # of resampling `image`, so it lines up exactly with the design's own
    # mesh regardless of what mesh the signature was originally drawn at.
    grid: "list[list[str]] | None" = None


def load_signature_image(signature: dict | None) -> SignatureAsset | None:
    """Load a creator signature from the record returned by
    `get_creator_signature` (`{"image_url": ..., "grid_json": ...}`). The
    image is always loaded (used for profile display and as the drawn-
    signature print source); grid_json, when present, takes priority for
    printing. Returns None on any failure so a missing/broken signature
    never blocks a print job."""
    if not signature or not signature.get("image_url"):
        return None
    image_url = signature["image_url"]
    try:
        if image_url.startswith("http://") or image_url.startswith("https://"):
            request = Request(image_url, headers={"User-Agent": "MNS/1.0"})
            with urlopen(request, timeout=15) as response:
                data = response.read()
        else:
            data = _resolve_asset_path(image_url).read_bytes()
        image = Image.open(BytesIO(data)).convert("RGBA")
        return SignatureAsset(image=image, grid=signature.get("grid_json"))
    except (OSError, HTTPError, URLError, Image.UnidentifiedImageError) as exc:
        logger.warning("Failed to load signature image %s: %s", image_url, exc)
        return None


@dataclass
class SkuAsset:
    image: "Image.Image | None" = None
    # Present only for pixel-drawn/imported SKUs — see SignatureAsset.grid.
    grid: "list[list[str]] | None" = None


def load_sku_asset(sku: dict | None) -> SkuAsset | None:
    """Load a project's SKU mark from the record returned by
    `get_project_sku` (`{"image_url": ..., "grid_json": ...}`). Mirrors
    `load_signature_image` exactly, just per-project instead of per-creator —
    returns None on any failure so a missing/broken SKU never blocks a print
    job."""
    if not sku or not sku.get("image_url"):
        return None
    image_url = sku["image_url"]
    try:
        if image_url.startswith("http://") or image_url.startswith("https://"):
            request = Request(image_url, headers={"User-Agent": "MNS/1.0"})
            with urlopen(request, timeout=15) as response:
                data = response.read()
        else:
            data = _resolve_asset_path(image_url).read_bytes()
        image = Image.open(BytesIO(data)).convert("RGBA")
        return SkuAsset(image=image, grid=sku.get("grid_json"))
    except (OSError, HTTPError, URLError, Image.UnidentifiedImageError) as exc:
        logger.warning("Failed to load SKU image %s: %s", image_url, exc)
        return None


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    cleaned = hex_color.lstrip("#")
    return tuple(int(cleaned[i:i+2], 16) for i in (0, 2, 4))


def _rgb_to_reportlab(hex_color: str) -> colors.Color:
    red, green, blue = _hex_to_rgb(hex_color)
    return colors.Color(red / 255, green / 255, blue / 255)


def _truncate_text(value: str, max_chars: int) -> str:
    if len(value) <= max_chars:
        return value
    return f"{value[:max_chars - 1]}..."


def _render_preview_image_from_cells(
    cells: list[list[str]],
    mesh_count: int,
    show_grid: bool,
    include_border: bool = True,
    grid_color: tuple = GRID_COLOR,
    grid_line_width: int = 1,
    signature: SignatureAsset | None = None,
    sku: SkuAsset | None = None,
    border_inches: float = BORDER_INCHES,
    side_border_inches: float | None = None,
    signature_offset_in: tuple[float, float] = (0.0, 0.0),
) -> Image.Image:
    """`signature_offset_in` nudges the signature off its usual corner
    position, in inches, +x right and +y down. A roll-print calibration knob
    for when the mark lands wrong on the physical canvas — applied after the
    keep-out clamp, so it has effect even when the signature is already
    pressed against the design, and can therefore be pushed over the stitches
    if driven far enough. Callers that aren't calibrating leave it at 0."""
    stitch_height = len(cells)
    stitch_width = len(cells[0]) if stitch_height else 0
    border_stitches = int(border_inches * mesh_count) if include_border else 0
    # Sides can carry a different margin to top/bottom. The roll is cut to
    # width before it's loaded, so that physical edge already IS the side
    # margin — drawing another one inside it leaves two margins to reconcile
    # when aligning across the roll. Defaults to matching top/bottom, so
    # callers that don't care are unaffected.
    side_border_stitches = (
        border_stitches if side_border_inches is None
        else (int(side_border_inches * mesh_count) if include_border else 0)
    )

    total_width = stitch_width + (2 * side_border_stitches)
    total_height = stitch_height + (2 * border_stitches)

    quantized = Image.new("RGB", (stitch_width, stitch_height), (255, 255, 255))
    if stitch_width and stitch_height:
        quantized.putdata([
            (255, 255, 255)
            if cell == BLANK_CELL
            else (0, 0, 0)
            if cell == FINISH_OUTLINE_CELL
            else _hex_to_rgb(cell)
            for row in cells
            for cell in row
        ])

    canvas_image = Image.new("RGB", (total_width, total_height), (255, 255, 255))
    if stitch_width and stitch_height:
        canvas_image.paste(quantized, (side_border_stitches, border_stitches))

    display_w = total_width * DISPLAY_CELL_SIZE
    display_h = total_height * DISPLAY_CELL_SIZE
    preview = canvas_image.resize((display_w, display_h), Image.Resampling.NEAREST).convert("RGBA")

    if show_grid:
        draw = ImageDraw.Draw(preview)
        for x in range(0, display_w + 1, DISPLAY_CELL_SIZE):
            draw.line([(x, 0), (x, display_h)], fill=grid_color, width=grid_line_width)
        for y in range(0, display_h + 1, DISPLAY_CELL_SIZE):
            draw.line([(0, y), (display_w, y)], fill=grid_color, width=grid_line_width)

    if include_border and signature and border_stitches > 0:
        px_per_inch = mesh_count * DISPLAY_CELL_SIZE
        design_right_px = side_border_stitches * DISPLAY_CELL_SIZE + stitch_width * DISPLAY_CELL_SIZE
        design_bottom_px = border_stitches * DISPLAY_CELL_SIZE + stitch_height * DISPLAY_CELL_SIZE
        # Anchor from the canvas's own bottom-right corner (display_w /
        # display_h), not the design's edge — so the gap to the fabric
        # corner is the same fixed 3/4" no matter how big the signature is.
        corner_inset_px = SIGNATURE_CORNER_INSET_IN * px_per_inch

        if signature.grid:
            # Pixel signature: draw each authored stitch as one printed
            # stitch at this design's own DISPLAY_CELL_SIZE — the same unit
            # every other stitch in the canvas is rendered at — instead of
            # resampling a raster image into a fixed inch box. That keeps it
            # pixel-for-pixel/stitch-for-stitch exact regardless of mesh, at
            # the cost of the signature's physical size varying slightly
            # with mesh (true to the stitch count, not a fixed inch size).
            grid = signature.grid
            grid_rows = len(grid)
            grid_cols = len(grid[0]) if grid_rows else 0
            box_w = grid_cols * DISPLAY_CELL_SIZE
            box_h = grid_rows * DISPLAY_CELL_SIZE
            # Snap to the nearest whole stitch column/row, not just the
            # nearest pixel — otherwise the corner inset can land mid-cell,
            # splitting a drawn block across two real stitches instead of
            # filling one. Prefer to keep clear of the design, but staying on
            # the image wins: with a narrow side margin there is no room
            # beside the design, and a mark pushed off the edge is silently
            # dropped by PIL rather than erroring.
            raw_x = display_w - corner_inset_px - box_w
            raw_y = display_h - corner_inset_px - box_h
            paste_x = min(display_w - box_w, max(design_right_px, round(raw_x / DISPLAY_CELL_SIZE) * DISPLAY_CELL_SIZE))
            paste_y = min(display_h - box_h, max(design_bottom_px, round(raw_y / DISPLAY_CELL_SIZE) * DISPLAY_CELL_SIZE))
            # Nudge in whole stitches so the calibration can't undo the
            # snapping above and split a drawn block across two real stitches.
            # Clamped to the canvas itself: PIL clips out-of-bounds rectangles
            # silently, so without this a large offset makes the mark vanish
            # from the print with no error.
            paste_x = min(max(0, paste_x + round(signature_offset_in[0] * mesh_count) * DISPLAY_CELL_SIZE), display_w - box_w)
            paste_y = min(max(0, paste_y + round(signature_offset_in[1] * mesh_count) * DISPLAY_CELL_SIZE), display_h - box_h)
            draw = ImageDraw.Draw(preview)
            for r, row in enumerate(grid):
                for c, hex_color in enumerate(row):
                    if hex_color == BLANK_CELL:
                        continue
                    x0 = paste_x + c * DISPLAY_CELL_SIZE
                    y0 = paste_y + r * DISPLAY_CELL_SIZE
                    draw.rectangle(
                        [x0, y0, x0 + DISPLAY_CELL_SIZE - 1, y0 + DISPLAY_CELL_SIZE - 1],
                        fill=_hex_to_rgb(hex_color),
                    )
        elif signature.image:
            max_w_px = SIGNATURE_MAX_WIDTH_IN * px_per_inch
            max_h_px = SIGNATURE_MAX_HEIGHT_IN * px_per_inch
            sig_w, sig_h = signature.image.size
            if sig_w and sig_h:
                scale = min(max_w_px / sig_w, max_h_px / sig_h, 1.0)
                box_w = max(1, round(sig_w * scale))
                box_h = max(1, round(sig_h * scale))
                sig_scaled = signature.image.resize((box_w, box_h), Image.Resampling.LANCZOS)
                paste_x = min(display_w - box_w, max(design_right_px, round(display_w - corner_inset_px - box_w)))
                paste_y = min(display_h - box_h, max(design_bottom_px, round(display_h - corner_inset_px - box_h)))
                # Clamped to the canvas — see the grid path above.
                paste_x = min(max(0, paste_x + round(signature_offset_in[0] * px_per_inch)), display_w - box_w)
                paste_y = min(max(0, paste_y + round(signature_offset_in[1] * px_per_inch)), display_h - box_h)
                preview.paste(sig_scaled, (paste_x, paste_y), sig_scaled)

    if include_border and sku and border_stitches > 0:
        px_per_inch = mesh_count * DISPLAY_CELL_SIZE
        design_left_px = side_border_stitches * DISPLAY_CELL_SIZE
        design_bottom_px = border_stitches * DISPLAY_CELL_SIZE + stitch_height * DISPLAY_CELL_SIZE
        # Mirror of the signature block above, anchored to the canvas's own
        # bottom-left corner instead of bottom-right.
        corner_inset_px = SKU_CORNER_INSET_IN * px_per_inch

        if sku.grid:
            grid = sku.grid
            grid_rows = len(grid)
            grid_cols = len(grid[0]) if grid_rows else 0
            box_w = grid_cols * DISPLAY_CELL_SIZE
            box_h = grid_rows * DISPLAY_CELL_SIZE
            raw_x = corner_inset_px
            raw_y = display_h - corner_inset_px - box_h
            # Prefer to keep clear of the design, but staying on the image
            # wins — with a narrow side margin there is no room beside it.
            # Mirrors the signature clamp above.
            paste_x = max(0, min(design_left_px - box_w, round(raw_x / DISPLAY_CELL_SIZE) * DISPLAY_CELL_SIZE))
            paste_y = min(display_h - box_h, max(design_bottom_px, round(raw_y / DISPLAY_CELL_SIZE) * DISPLAY_CELL_SIZE))
            draw = ImageDraw.Draw(preview)
            for r, row in enumerate(grid):
                for c, hex_color in enumerate(row):
                    if hex_color == BLANK_CELL:
                        continue
                    x0 = paste_x + c * DISPLAY_CELL_SIZE
                    y0 = paste_y + r * DISPLAY_CELL_SIZE
                    draw.rectangle(
                        [x0, y0, x0 + DISPLAY_CELL_SIZE - 1, y0 + DISPLAY_CELL_SIZE - 1],
                        fill=_hex_to_rgb(hex_color),
                    )
        elif sku.image:
            max_w_px = SKU_MAX_WIDTH_IN * px_per_inch
            max_h_px = SKU_MAX_HEIGHT_IN * px_per_inch
            sku_w, sku_h = sku.image.size
            if sku_w and sku_h:
                scale = min(max_w_px / sku_w, max_h_px / sku_h, 1.0)
                box_w = max(1, round(sku_w * scale))
                box_h = max(1, round(sku_h * scale))
                sku_scaled = sku.image.resize((box_w, box_h), Image.Resampling.LANCZOS)
                paste_x = max(0, min(design_left_px - box_w, round(corner_inset_px)))
                paste_y = max(design_bottom_px, round(display_h - corner_inset_px - box_h))
                preview.paste(sku_scaled, (paste_x, paste_y), sku_scaled)

    return preview


def _calculate_skeins(stitch_count: int, mesh_count: int) -> int:
    stitches_per_skein = 1750 if mesh_count >= 18 else 1250
    return max(1, math.ceil(stitch_count / stitches_per_skein))


def _build_report_rows(cells: list[list[str]], palette: list[dict], mesh_count: int = 13) -> list[dict]:
    counts = Counter(
        cell
        for row in cells
        for cell in row
        if cell not in {BLANK_CELL, FINISH_OUTLINE_CELL}
    )
    palette_by_hex = {color["hex"]: color for color in palette}

    rows: list[dict] = []
    for hex_color, count in counts.most_common():
        color = palette_by_hex.get(
            hex_color,
            {
                "hex": hex_color,
                "dmc_code": hex_color,
                "dmc_name": "Unmapped color",
            },
        )
        rows.append(
            {
                "hex": hex_color,
                "dmc_code": color["dmc_code"],
                "dmc_name": color["dmc_name"],
                "count": count,
                "skeins": _calculate_skeins(count, mesh_count),
            }
        )

    return rows


def _build_thread_list_qr_url(
    rows: list[dict],
    width_inches: float,
    height_inches: float,
    mesh_count: int,
) -> str | None:
    """Uploads the same color/skein data as the report table to a small public
    JSON blob and returns a link to the mobile-friendly /thread-list page that
    renders it — the target for the report page's QR code. Lets someone pull
    the color list up on their phone in a thread store instead of squinting at
    printed codes. Returns None (and the caller skips drawing a QR at all)
    when Supabase storage isn't configured, same fallback upload_pdf_to_supabase
    and upload_png_to_supabase already use elsewhere in this pipeline — a
    broken/unreachable QR code is worse than no QR code."""
    payload = {
        "width_inches": round(width_inches, 2),
        "height_inches": round(height_inches, 2),
        "mesh_count": mesh_count,
        "colors_used": len(rows),
        "total_stitches": sum(row["count"] for row in rows),
        "rows": [
            {
                "hex": row["hex"],
                "dmc_code": row["dmc_code"],
                "dmc_name": row["dmc_name"],
                "count": row["count"],
                "skeins": row["skeins"],
            }
            for row in rows
        ],
    }
    json_path = FINALIZED_DIR / f"thread-list_{uuid4().hex}.json"
    json_path.write_text(json.dumps(payload), encoding="utf-8")
    public_json_url = upload_file_to_supabase(
        json_path, prefix="public-thread-lists", content_type="application/json",
    )
    if not public_json_url:
        return None
    return f"{FRONTEND_URL}/thread-list?src={quote(public_json_url, safe='')}"


def _draw_report_page(
    pdf: canvas.Canvas,
    page_size: tuple[float, float],
    preview_image: Image.Image,
    width_inches: float,
    height_inches: float,
    mesh_count: int,
    contrast_level: str,
    palette: list[dict],
    cells: list[list[str]],
    has_outline: bool = False,
    qr_url: str | None = None,
) -> None:
    page_width, page_height = page_size
    margin = PAGE_MARGIN
    content_width = page_width - margin * 2
    y = page_height - margin

    rows = _build_report_rows(cells, palette, mesh_count)
    total_stitches = sum(row["count"] for row in rows)
    used_colors = len(rows)
    export_date = datetime.now().strftime("%b %d, %Y")

    pdf.setFillColor(colors.HexColor("#F7F5F0"))
    pdf.roundRect(margin, page_height - 154, content_width, 112, CARD_RADIUS, fill=1, stroke=0)

    pdf.setFillColor(colors.HexColor("#173F2A"))
    pdf.setFont("Helvetica-Bold", 20)
    pdf.drawString(margin + 18, page_height - 68, "MNS Studio Finalized Report")
    pdf.setFont("Helvetica", 11)
    pdf.setFillColor(colors.HexColor("#5B635C"))
    pdf.drawString(margin + 18, page_height - 88, "Stitch canvas summary, palette, and production counts")

    thumb_size = 82
    thumb_x = page_width - margin - thumb_size - 14
    thumb_y = page_height - 52 - thumb_size
    thumb_buffer = BytesIO()
    preview_image.save(thumb_buffer, format="PNG")
    thumb_buffer.seek(0)
    thumb = ImageReader(thumb_buffer)
    pdf.drawImage(
        thumb,
        thumb_x,
        thumb_y,
        width=thumb_size,
        height=thumb_size,
        preserveAspectRatio=True,
        mask='auto',
    )
    pdf.setFont("Helvetica", 8)
    pdf.setFillColor(colors.HexColor("#7A817A"))
    pdf.drawRightString(thumb_x + thumb_size, thumb_y - 10, f"Exported {export_date}")

    if qr_url:
        qr_size = 62
        qr_x = thumb_x - qr_size - 16
        qr_y = thumb_y + (thumb_size - qr_size) / 2
        qr_image = qrcode.make(qr_url, box_size=8, border=1)
        qr_buffer = BytesIO()
        qr_image.save(qr_buffer, format="PNG")
        qr_buffer.seek(0)
        pdf.drawImage(ImageReader(qr_buffer), qr_x, qr_y, width=qr_size, height=qr_size)
        pdf.setFont("Helvetica", 7)
        pdf.setFillColor(colors.HexColor("#7A817A"))
        pdf.drawCentredString(qr_x + qr_size / 2, qr_y - 10, "Scan for mobile")
        pdf.drawCentredString(qr_x + qr_size / 2, qr_y - 19, "color list")

    summary_x = margin + 18
    summary_y = page_height - 112
    summary_pairs = [
        ("Finished size", f'{width_inches:.1f}" x {height_inches:.1f}"'),
        ("Canvas", f'{_fmt_canvas(round((width_inches + 4) * 2) / 2)}" × {_fmt_canvas(round((height_inches + 4) * 2) / 2)}"'),
        ("Mesh", str(mesh_count)),
        ("Colors used", str(used_colors)),
        ("Total stitches", str(total_stitches)),
        ("Contrast", contrast_level.replace('_', ' ')),
    ]

    pdf.setFont("Helvetica-Bold", 10)
    pdf.setFillColor(colors.HexColor("#3A413B"))
    for index, (label, value) in enumerate(summary_pairs):
        column = index // 3
        row = index % 3
        x = summary_x + column * 180
        y_position = summary_y - row * 18
        pdf.drawString(x, y_position, f"{label}:")
        pdf.setFont("Helvetica", 10)
        pdf.drawString(x + 88, y_position, value)
        pdf.setFont("Helvetica-Bold", 10)

    y = page_height - 182
    if has_outline:
        pdf.setFillColor(colors.HexColor("#F0F4EF"))
        note_h = 20
        pdf.roundRect(margin, y - note_h, content_width, note_h, 4, fill=1, stroke=0)
        pdf.setFillColor(colors.HexColor("#2D5A27"))
        pdf.setFont("Helvetica-Bold", 9)
        pdf.drawString(margin + 10, y - 13, "✓ Black finish outline applied")
        pdf.setFont("Helvetica", 9)
        pdf.setFillColor(colors.HexColor("#5B635C"))
        pdf.drawString(margin + 148, y - 13, "— outline stitches are not included in the totals above")
        y -= note_h + 6

    pdf.setStrokeColor(colors.HexColor("#D9D9D9"))
    pdf.line(margin, y, margin + content_width, y)
    y -= 22

    swatch_x = margin + 6
    code_x = swatch_x + 28
    name_x = margin + 132
    stitches_x = page_width - margin - 58
    skeins_x = page_width - margin
    table_text_color = colors.HexColor("#2D332F")

    def _draw_table_header(y_pos: float) -> None:
        pdf.setFont("Helvetica-Bold", 11)
        pdf.setFillColor(table_text_color)
        pdf.drawString(code_x, y_pos, "Code")
        pdf.drawString(name_x, y_pos, "Color")
        pdf.drawRightString(stitches_x, y_pos, "Stitches")
        pdf.drawRightString(skeins_x, y_pos, "Skeins")

    _draw_table_header(y)
    y -= 14
    pdf.setStrokeColor(colors.HexColor("#E6E6E6"))
    pdf.line(margin, y, margin + content_width, y)
    y -= 16

    row_height = 26
    swatch_size = 16
    row_background_height = 22
    pdf.setFont("Helvetica", 10)

    for index, row in enumerate(rows):
        if y < margin + row_height:
            pdf.showPage()
            pdf.setFillColor(colors.HexColor("#F7F5F0"))
            pdf.roundRect(margin, page_height - 74, content_width, 40, 8, fill=1, stroke=0)
            pdf.setFont("Helvetica-Bold", 16)
            pdf.setFillColor(colors.HexColor("#173F2A"))
            pdf.drawString(margin + 16, page_height - 58, "MNS Studio Finalized Report")
            y = page_height - 98
            _draw_table_header(y)
            y -= 14
            pdf.setStrokeColor(colors.HexColor("#E6E6E6"))
            pdf.line(margin, y, margin + content_width, y)
            y -= 16
            pdf.setFont("Helvetica", 10)

        row_center_y = y - row_height / 2
        text_y = row_center_y - 3.5

        if index % 2 == 0:
            pdf.setFillColor(colors.HexColor("#FBFBFB"))
            pdf.rect(
                margin,
                row_center_y - row_background_height / 2,
                content_width,
                row_background_height,
                fill=1,
                stroke=0,
            )

        pdf.setFillColor(_rgb_to_reportlab(row["hex"]))
        pdf.rect(swatch_x, row_center_y - swatch_size / 2, swatch_size, swatch_size, fill=1, stroke=0)
        pdf.setStrokeColor(colors.HexColor("#B8B8B8"))
        pdf.rect(swatch_x, row_center_y - swatch_size / 2, swatch_size, swatch_size, fill=0, stroke=1)

        pdf.setFillColor(table_text_color)
        pdf.drawString(code_x, text_y, row["dmc_code"])
        pdf.drawString(name_x, text_y, _truncate_text(row["dmc_name"], 36))
        pdf.drawRightString(stitches_x, text_y, str(row["count"]))
        pdf.drawRightString(skeins_x, text_y, str(row["skeins"]))
        y -= row_height


def _draw_cover_page(
    pdf: canvas.Canvas,
    page_size: tuple[float, float],
    preview_image: Image.Image,
    width_inches: float,
    height_inches: float,
    mesh_count: int,
    contrast_level: str,
    used_colors: int,
    total_stitches: int,
    has_outline: bool = False,
    preview_border_inches: float = BORDER_INCHES,
) -> None:
    page_width, page_height = page_size
    margin = PAGE_MARGIN
    content_width = page_width - margin * 2
    content_height = page_height - margin * 2

    pdf.setFillColor(colors.HexColor("#F4F1E8"))
    pdf.roundRect(margin, margin, content_width, content_height, 18, fill=1, stroke=0)

    pdf.setFillColor(colors.HexColor("#173F2A"))
    pdf.setFont("Helvetica-Bold", 24)
    pdf.drawString(margin + 24, page_height - margin - 32, "MNS Studio")
    pdf.setFont("Helvetica", 12)
    pdf.setFillColor(colors.HexColor("#576057"))
    pdf.drawString(margin + 24, page_height - margin - 52, "Finalized stitch canvas")

    preview_buffer = BytesIO()
    preview_image.save(preview_buffer, format="PNG")
    preview_buffer.seek(0)
    img = ImageReader(preview_buffer)

    total_width_inches = width_inches + preview_border_inches * 2
    total_height_inches = height_inches + preview_border_inches * 2
    preview_print_width = total_width_inches * 72
    preview_print_height = total_height_inches * 72
    max_preview_width = content_width - 48
    max_preview_height = content_height - 170
    scale = min(
        1,
        max_preview_width / max(1, preview_print_width),
        max_preview_height / max(1, preview_print_height),
    )
    draw_width = preview_print_width * scale
    draw_height = preview_print_height * scale
    preview_x = margin + (content_width - draw_width) / 2
    preview_y = margin + 86 + (max_preview_height - draw_height) / 2

    pdf.setFillColor(colors.white)
    pdf.roundRect(preview_x - 16, preview_y - 16, draw_width + 32, draw_height + 32, 14, fill=1, stroke=0)
    pdf.drawImage(
        img,
        preview_x,
        preview_y,
        width=draw_width,
        height=draw_height,
        preserveAspectRatio=True,
        mask='auto',
    )

    footer_y = margin + 28
    stat_pairs = [
        ("Finished size", f'{width_inches:.1f}" x {height_inches:.1f}"'),
        ("Canvas", f'{_fmt_canvas(round((width_inches + 4) * 2) / 2)}" × {_fmt_canvas(round((height_inches + 4) * 2) / 2)}"'),
        ("Mesh", str(mesh_count)),
        ("Colors used", str(used_colors)),
        ("Stitches", str(total_stitches)),
        ("Contrast", contrast_level.replace('_', ' ')),
    ]
    for index, (label, value) in enumerate(stat_pairs):
        x = margin + 24 + index * ((content_width - 48) / len(stat_pairs))
        pdf.setFillColor(colors.HexColor("#7A817A"))
        pdf.setFont("Helvetica-Bold", 9)
        pdf.drawString(x, footer_y + 18, label.upper())
        pdf.setFillColor(colors.HexColor("#1E241F"))
        pdf.setFont("Helvetica", 11)
        pdf.drawString(x, footer_y, value)

    if has_outline:
        pdf.setFillColor(colors.HexColor("#2D5A27"))
        pdf.setFont("Helvetica-Bold", 8)
        outline_label_x = margin + 24
        pdf.drawString(outline_label_x, footer_y - 16, "✓ Black finish outline applied")


def _draw_true_size_reference_page(
    pdf: canvas.Canvas,
    width_inches: float,
    height_inches: float,
    mesh_count: int,
    cells: list[list[str]],
) -> None:
    # Derive physical dimensions from the stitch grid — cells are the ground truth.
    # Stored width_inches/height_inches may have drifted; stitch_count/mesh_count never lies.
    stitch_height = len(cells)
    stitch_width = len(cells[0]) if stitch_height else 0
    draw_width = (stitch_width / mesh_count) * 72
    draw_height = (stitch_height / mesh_count) * 72

    page_size = landscape(letter) if stitch_width > stitch_height else letter
    if draw_width > page_size[0] - 36 or draw_height > page_size[1] - 36:
        # Larger than letter paper: emit a custom-size page (design + 0.5"
        # margin per side) so the true-size reference stays true-size on
        # roll printers instead of clipping.
        page_size = (draw_width + 72, draw_height + 72)
    page_width, page_height = page_size
    pdf.setPageSize(page_size)

    true_size_image = _render_preview_image_from_cells(
        cells, mesh_count, show_grid=True, include_border=False,
        grid_color=(60, 60, 60, 255), grid_line_width=2,
    )
    preview_buffer = BytesIO()
    true_size_image.save(preview_buffer, format="PNG")
    preview_buffer.seek(0)
    img = ImageReader(preview_buffer)

    x = (page_width - draw_width) / 2
    y = (page_height - draw_height) / 2
    pdf.drawImage(
        img,
        x,
        y,
        width=draw_width,
        height=draw_height,
        preserveAspectRatio=False,
        mask='auto',
    )


def generate_preview_pdf(
    preview_url: str,
    width_inches: float,
    height_inches: float,
    mesh_count: int,
    color_count: int,
    contrast_level: str,
    show_grid: bool,
    palette: list[dict],
    cells: list[list[str]],
    signature: SignatureAsset | None = None,
    sku: SkuAsset | None = None,
) -> tuple[str, Path, Path, str, Path]:
    public_path, public_url = finalized_output_path("finalized")
    internal_path, _ = finalized_output_path("internal_finalized")
    preview_path, preview_url = preview_output_path()

    # Derive authoritative design dimensions from cell content, not import settings
    preview_cells = crop_to_content(cells)
    design_w = len(preview_cells[0]) / mesh_count if preview_cells and preview_cells[0] else width_inches
    design_h = len(preview_cells) / mesh_count if preview_cells else height_inches

    page_size = landscape(letter) if design_w > design_h else letter
    # Cover preview: design + the canvas margin on each side, with signature.
    # Same margin the customer was quoted, so the picture matches the canvas.
    cover_margin_in = canvas_margin_inches(design_w, design_h)
    preview_image = _render_preview_image_from_cells(
        preview_cells, mesh_count, show_grid, signature=signature, sku=sku,
        border_inches=cover_margin_in,
    )
    preview_image.save(preview_path, format="PNG")
    # Report thumbnail: just the design (no canvas border) so it fills the small thumb area
    thumb_image = _render_preview_image_from_cells(
        preview_cells, mesh_count, show_grid, include_border=False,
    )
    report_rows = _build_report_rows(cells, palette, mesh_count)
    total_stitches = sum(row["count"] for row in report_rows)
    used_colors = len(report_rows)
    has_outline = any(cell == FINISH_OUTLINE_CELL for row in cells for cell in row)
    qr_url = _build_thread_list_qr_url(report_rows, design_w, design_h, mesh_count)

    def draw_public_pages(pdf: canvas.Canvas) -> None:
        _draw_cover_page(
            pdf,
            page_size,
            preview_image,
            design_w,
            design_h,
            mesh_count,
            contrast_level,
            used_colors,
            total_stitches,
            has_outline,
            preview_border_inches=cover_margin_in,
        )

        pdf.showPage()
        _draw_report_page(
            pdf,
            page_size,
            thumb_image,
            design_w,
            design_h,
            mesh_count,
            contrast_level,
            palette,
            cells,
            has_outline,
            qr_url,
        )

    public_pdf = canvas.Canvas(str(public_path), pagesize=page_size)
    draw_public_pages(public_pdf)
    public_pdf.save()

    internal_pdf = canvas.Canvas(str(internal_path), pagesize=page_size)
    draw_public_pages(internal_pdf)
    internal_pdf.showPage()
    _draw_true_size_reference_page(
        internal_pdf,
        design_w,
        design_h,
        mesh_count,
        preview_cells,
    )
    internal_pdf.save()

    # The public URL is returned to the app for completion tracking; the internal file
    # is sent by the finalize endpoint and intentionally not exposed in the UI.
    return public_url, public_path, internal_path, preview_url, preview_path


_NOZZLE_CHECK_COLORS = [
    ("#E02020", "Red"),
    ("#FF8C00", "Orange"),
    ("#F5D000", "Yellow"),
    ("#00A550", "Green"),
    ("#0070C0", "Blue"),
    ("#7030A0", "Purple"),
    ("#808080", "Gray"),
    ("#1A1A1A", "Black"),
]


def _set_print_actual_size(pdf: canvas.Canvas) -> None:
    vp = ViewerPreferencesPDFDictionary()
    vp['PrintScaling'] = 'None'
    pdf._doc.Catalog.ViewerPreferences = vp


def _draw_roll_cut_line(pdf: canvas.Canvas, y: float, roll_width_pts: float, gap_pts: float) -> None:
    reg_inset = 18.0  # 0.25" from each edge
    gap_half = gap_pts / 2

    # Vertical registration lines — full height of gap zone
    pdf.setStrokeColor(colors.HexColor("#555555"))
    pdf.setLineWidth(1.0)
    pdf.line(reg_inset, y + gap_half, reg_inset, y - gap_half)
    pdf.line(roll_width_pts - reg_inset, y + gap_half, roll_width_pts - reg_inset, y - gap_half)

    # Horizontal cut line — dashed
    pdf.saveState()
    pdf.setStrokeColor(colors.HexColor("#AAAAAA"))
    pdf.setDash([5, 4])
    pdf.setLineWidth(0.5)
    pdf.line(0, y, roll_width_pts, y)
    pdf.restoreState()

    pdf.setFont("Helvetica", 7)
    pdf.setFillColor(colors.HexColor("#999999"))
    pdf.drawString(4, y + 3, "CUT")
    pdf.drawRightString(roll_width_pts - 4, y + 3, "CUT")


def generate_calibration_pdf(
    mesh_count: int = 18,
    roll_width_inches: float = 8.0,
    leading_blank_inches: float = 0.5,
    include_nozzle_check: bool = True,
    include_header: bool = True,
    include_instructions: bool = True,
    cell_inches: float = 1.0,
    grid_rows_override: int | None = None,
) -> Path:
    roll_width_pts = roll_width_inches * 72
    side_margin = 36.0
    content_width = roll_width_pts - 2 * side_margin

    grid_cols = round(6 / cell_inches)
    grid_rows = grid_rows_override if grid_rows_override is not None else round(4 / cell_inches)
    cell_pts = cell_inches * 72
    grid_w = grid_cols * cell_pts
    grid_h = grid_rows * cell_pts

    leading_pts = leading_blank_inches * 72
    header_h = 60.0
    nozzle_h = 56.0
    grid_label_h = 20.0
    instructions_h = 28.0
    bottom_margin = 18.0

    total_h = (
        leading_pts
        + (header_h + 14 if (include_nozzle_check and include_header) else 0)
        + (nozzle_h + 20 if include_nozzle_check else 0)
        + (grid_label_h if include_instructions else 8.0)
        + grid_h
        + (instructions_h + 14 if include_instructions else 0)
        + bottom_margin
    )

    output_path = FINALIZED_DIR / "admin_calibration.pdf"
    pdf = canvas.Canvas(str(output_path), pagesize=(roll_width_pts, total_h))
    pdf.setTitle("MNS Roll Print Calibration")

    y = total_h - leading_pts

    if include_nozzle_check and include_header:
        pdf.setFillColor(colors.HexColor("#173F2A"))
        pdf.setFont("Helvetica-Bold", 16)
        pdf.drawString(side_margin, y - 18, "MNS Roll Print Calibration")
        pdf.setFont("Helvetica", 10)
        pdf.setFillColor(colors.HexColor("#5B635C"))
        pdf.drawString(side_margin, y - 34, f"{mesh_count} mesh  ·  {roll_width_inches}\" roll  ·  Print at 100% actual size — no scaling")
        pdf.setFont("Helvetica", 8)
        pdf.setFillColor(colors.HexColor("#7A817A"))
        pdf.drawString(side_margin, y - 50, datetime.now().strftime("%b %d, %Y"))
        y -= header_h
        pdf.setStrokeColor(colors.HexColor("#D9D9D9"))
        pdf.line(side_margin, y, side_margin + content_width, y)
        y -= 14

    if include_nozzle_check:
        pdf.setFont("Helvetica-Bold", 9)
        pdf.setFillColor(colors.HexColor("#3A413B"))
        pdf.drawString(side_margin, y - 12, "Nozzle Check")
        y -= 16

        bar_w = content_width / len(_NOZZLE_CHECK_COLORS)
        bar_h = 28.0
        for i, (hex_color, _) in enumerate(_NOZZLE_CHECK_COLORS):
            bx = side_margin + i * bar_w
            pdf.setFillColor(colors.HexColor(hex_color))
            pdf.rect(bx, y - bar_h, bar_w, bar_h, fill=1, stroke=0)
            pdf.saveState()
            pdf.setStrokeColor(colors.HexColor("#CCCCCC"))
            pdf.setLineWidth(0.3)
            pdf.rect(bx, y - bar_h, bar_w, bar_h, fill=0, stroke=1)
            pdf.restoreState()
        y -= bar_h

        pdf.setFont("Helvetica", 7)
        pdf.setFillColor(colors.HexColor("#666666"))
        for i, (_, label) in enumerate(_NOZZLE_CHECK_COLORS):
            cx = side_margin + i * bar_w + bar_w / 2
            pdf.drawCentredString(cx, y - 10, label)
        y -= 12

        y -= 8
        pdf.setStrokeColor(colors.HexColor("#D9D9D9"))
        pdf.line(side_margin, y, side_margin + content_width, y)
        y -= 20

    if include_instructions:
        pdf.setFont("Helvetica-Bold", 10)
        pdf.setFillColor(colors.HexColor("#3A413B"))
        pdf.drawString(side_margin, y - 14, f"Calibration Grid — each square = {cell_inches:.0f}\" exactly")
        y -= 20
    else:
        y -= 8

    grid_x = (roll_width_pts - grid_w) / 2
    grid_bottom = y - grid_h
    grid_top = y

    for row in range(grid_rows):
        for col in range(grid_cols):
            if (row + col) % 2 == 0:
                pdf.setFillColor(colors.HexColor("#EBEBEB"))
                pdf.rect(
                    grid_x + col * cell_pts,
                    grid_bottom + row * cell_pts,
                    cell_pts, cell_pts,
                    fill=1, stroke=0,
                )

    pdf.setStrokeColor(colors.HexColor("#333333"))
    pdf.setLineWidth(0.75)
    for col in range(grid_cols + 1):
        pdf.line(grid_x + col * cell_pts, grid_bottom, grid_x + col * cell_pts, grid_top)
    for row in range(grid_rows + 1):
        pdf.line(grid_x, grid_bottom + row * cell_pts, grid_x + grid_w, grid_bottom + row * cell_pts)

    if include_instructions:
        pdf.setFont("Helvetica-Bold", 8)
        pdf.setFillColor(colors.HexColor("#333333"))
        for col in range(grid_cols):
            cx = grid_x + col * cell_pts + cell_pts / 2
            pdf.drawCentredString(cx, grid_top - cell_pts / 2 - 4, f'{(col + 1) * cell_inches:.0f}"')
        for row in range(grid_rows):
            rl_y = grid_top - (row + 0.5) * cell_pts - 4
            pdf.drawRightString(grid_x - 6, rl_y, f'{(row + 1) * cell_inches:.0f}"')

        y = grid_bottom - 14
        pdf.setFont("Helvetica", 8)
        pdf.setFillColor(colors.HexColor("#555555"))
        pdf.drawString(side_margin, y - 12,
            "Measure any square — must be exactly 1.0\"  ·  If off, ensure print dialog is set to 100% / actual size with no fit-to-page scaling")

    _set_print_actual_size(pdf)
    pdf.save()
    return output_path


def generate_blank_roll_pdf(
    roll_width_inches: float = 8.0,
    height_inches: float = 4.0,
) -> Path:
    w = roll_width_inches * 72
    h = height_inches * 72
    output_path = FINALIZED_DIR / "admin_blank_roll.pdf"
    pdf = canvas.Canvas(str(output_path), pagesize=(w, h))
    pdf.setTitle("MNS Blank Roll")
    _set_print_actual_size(pdf)
    pdf.save()
    return output_path


# Fill/stroke pairs for the test line — swappable so a calibration run doesn't
# have to compete with real jobs for whichever ink cartridge is running low.
_TEST_LINE_COLORS = {
    "gray": ("#CCCCCC", "#888888"),
    "beige": ("#E8D9A0", "#A89060"),
    "yellow": ("#F0E68C", "#B8A030"),
    "pink": ("#F5C6D0", "#C08494"),
}


def generate_test_line_pdf(
    design_length_inches: float,
    roll_width_inches: float = 8.0,
    y_scale: float = 1.0,
    leading_blank_inches: float = 0.5,
    line_color: str = "gray",
    mesh_count: int | None = None,
    tick_every_stitches: int | None = None,
) -> Path:
    """A length-calibration aid: a single continuous line, two stitch widths
    thick, running exactly design_length_inches * y_scale tall, with
    the same 2"-per-side canvas margin (CANVAS_MARGIN_IN) a real design gets
    — blank above and below the line — before y_scale is applied to the
    whole thing. Print it, then measure the line's own length on the canvas
    with a ruler: if it matches design_length_inches, this y_scale is
    correct for a print of this length.

    Pass mesh_count to switch from length calibration to STITCH calibration
    (added 2026-08-31): cross-ticks are drawn every tick_every_stitches
    (default: 5 nominal inches' worth) and labelled with the cumulative
    stitch count they are supposed to land on. Instead of measuring the
    line, count real canvas holes from the top tick to each labelled tick.
    A tick reading "195 st" that sits over the 192nd hole means the print
    is running 3 stitches short over that span, and the correction is
    new_y_scale = y_scale * (195 / 192) — expected over counted, using
    whatever y_scale this sheet was actually printed at.

    Length-accurate and stitch-accurate are NOT the same target and do not
    share a scale: they differ by exactly nominal_mesh / real_holes_per_inch,
    which is ~1.6% on 13-mesh stock measured at ~12.8 holes/in. A scale
    tuned by ruler will be wrong by that factor for stitch alignment, which
    is why this mode exists rather than reusing the length numbers.

    The margin matters (added 2026-08-29): generate_roll_print_pdf scales
    content-plus-margin together as one combined length (see draw_h below),
    so a real 8.5" design's total commanded feed distance is (8.5 + 4") *
    y_scale, not 8.5 * y_scale. A margin-less test was quietly asking the
    printer to feed a shorter total distance than any real design of the
    same content length ever does — not the same test, however identical
    the content length looked on paper.

    Also deliberately continuous ink top to bottom within that content
    region, rather than two thin marks with blank canvas between them (the
    original design, through 2026-08-28) — the print head engages the
    canvas continuously the whole way down a real, fully-stitched design,
    and a mostly-blank test doesn't reproduce that. It does NOT need to be
    wide to test this, though (2026-08-28, second pass): what matters is
    the head's continuous engagement feeding down the length, not how much
    of the roll's width is inked — a narrow line burns far less canvas/ink
    than a wide bar while testing the identical hypothesis."""
    roll_width_pts = roll_width_inches * 72
    leading_pts = leading_blank_inches * 72
    margin_pts = CANVAS_MARGIN_IN * y_scale * 72
    bar_h_pts = design_length_inches * y_scale * 72
    label_h = 30.0
    bottom_margin = 18.0
    total_h = leading_pts + label_h + margin_pts + bar_h_pts + margin_pts + bottom_margin

    output_path = FINALIZED_DIR / "admin_test_line.pdf"
    pdf = canvas.Canvas(str(output_path), pagesize=(roll_width_pts, total_h))
    pdf.setTitle("MNS Roll Print Test Line")

    top_y = total_h - leading_pts
    bar_top = top_y - label_h - margin_pts
    bar_bottom = bar_top - bar_h_pts

    pdf.setFont("Helvetica", 8)
    pdf.setFillColor(colors.HexColor("#999999"))
    caption = (
        f'Testing {design_length_inches:.2f}" @ yScale {y_scale:.4f}  ·  '
        f'{mesh_count} mesh  ·  count canvas HOLES from the top tick to each label'
        if mesh_count
        else f'Testing {design_length_inches:.2f}" @ yScale {y_scale:.4f}  ·  measure the line, not the blank margin above/below it'
    )
    pdf.drawCentredString(roll_width_pts / 2, top_y - 14, caption)

    # Two stitch widths at the mesh under test, so the line reads as a real
    # two-column run of stitches rather than an arbitrary rule. Falls back to
    # 18 mesh (2/18" = 8pt) for the original length-only mode.
    line_width_pts = 2 * (1 / (mesh_count or 18)) * 72
    line_x = (roll_width_pts - line_width_pts) / 2
    fill_hex, stroke_hex = _TEST_LINE_COLORS.get(line_color, _TEST_LINE_COLORS["gray"])
    pdf.setFillColor(colors.HexColor(fill_hex))
    pdf.setStrokeColor(colors.HexColor(stroke_hex))
    pdf.setLineWidth(0.75)
    pdf.rect(line_x, bar_bottom, line_width_pts, bar_h_pts, fill=1, stroke=1)

    if mesh_count:
        # Ticks sit at the scaled position of stitch k — k/mesh nominal inches
        # in, times y_scale — so the last tick lands exactly on bar_bottom.
        total_stitches = int(round(design_length_inches * mesh_count))
        interval = tick_every_stitches or mesh_count * 5
        marks = list(range(0, total_stitches + 1, interval))
        if marks[-1] != total_stitches:
            marks.append(total_stitches)

        tick_reach = 0.3 * 72
        pdf.setFont("Helvetica", 7)
        for k in marks:
            tick_y = bar_top - (k / mesh_count) * y_scale * 72
            pdf.setStrokeColor(colors.HexColor(stroke_hex))
            pdf.setLineWidth(0.5)
            pdf.line(line_x - tick_reach, tick_y, line_x + line_width_pts + tick_reach, tick_y)
            nominal_in = k / mesh_count
            pdf.setFillColor(colors.HexColor("#666666"))
            pdf.drawString(line_x + line_width_pts + tick_reach + 4, tick_y - 2.5, f"{k} st")
            pdf.drawRightString(
                line_x - tick_reach - 4, tick_y - 2.5,
                f'{nominal_in:g}"' if nominal_in == int(nominal_in) else f'{nominal_in:.2f}"',
            )

    _set_print_actual_size(pdf)
    pdf.save()
    return output_path


def generate_registration_test_pdf(
    roll_width_inches: float = 8.0,
    sheet_height_inches: float = 6.0,
) -> Path:
    w = roll_width_inches * 72
    h = sheet_height_inches * 72
    inset = 36.0  # 0.5" from edges for mark centres

    marks = [
        ("TL", inset, h - inset),
        ("TR", w - inset, h - inset),
        ("C",  w / 2,    h / 2),
        ("BL", inset,    inset),
        ("BR", w - inset, inset),
    ]

    output_path = FINALIZED_DIR / "admin_registration_test.pdf"
    pdf = canvas.Canvas(str(output_path), pagesize=(w, h))
    pdf.setTitle("MNS Registration Test")

    # Header
    pdf.setFont("Helvetica-Bold", 11)
    pdf.setFillColor(colors.HexColor("#173F2A"))
    pdf.drawCentredString(w / 2, h - 18, "MNS Registration Test")
    pdf.setFont("Helvetica", 8)
    pdf.setFillColor(colors.HexColor("#7A817A"))
    pdf.drawCentredString(w / 2, h - 30, "Feed twice — marks must land exactly on top of each other")

    arm = 14.0   # crosshair arm length
    radius = 8.0

    for label, mx, my in marks:
        pdf.setStrokeColor(colors.HexColor("#111111"))
        pdf.setLineWidth(0.75)
        # Circle
        pdf.circle(mx, my, radius, fill=0, stroke=1)
        # Crosshair arms (don't draw inside circle)
        pdf.line(mx - arm, my, mx - radius, my)
        pdf.line(mx + radius, my, mx + arm, my)
        pdf.line(mx, my + radius, mx, my + arm)
        pdf.line(mx, my - arm, mx, my - radius)
        # Label
        pdf.setFont("Helvetica-Bold", 7)
        pdf.setFillColor(colors.HexColor("#333333"))
        pdf.drawCentredString(mx, my - arm - 9, label)

    # Outer border so the sheet boundary is clear
    pdf.setStrokeColor(colors.HexColor("#CCCCCC"))
    pdf.setLineWidth(0.5)
    pdf.rect(0, 0, w, h, fill=0, stroke=1)

    _set_print_actual_size(pdf)
    pdf.save()
    return output_path


def _rotate_cells_90(cells: list[list[str]]) -> list[list[str]]:
    """Rotate 90° clockwise. A plain transpose (zip(*cells)) mirrors
    asymmetric content instead of rotating it — harmless for symmetric
    designs but flips left/right-facing artwork (e.g. flags)."""
    if not cells or not cells[0]:
        return cells
    return [list(row) for row in zip(*cells[::-1])]


def generate_alignment_test_design(
    mesh_count: int = 18,
    width_inches: float = 3.0,
    text_height_inches: float = 1.0,
    text: str = "TEST",
) -> dict:
    """A small stitched word, sized to `text_height_inches` tall and padded
    out to `width_inches` wide overall — meant to be dropped into a roll
    print batch (same dict shape as `_build_roll_print_design`'s return
    value) so an operator can visually check feed/registration alignment
    against the real designs printed in the same run, through the exact
    same render path (mesh, border, DISPLAY_CELL_SIZE) rather than a
    disconnected vector overlay.

    Parametrized rather than hardcoded to "TEST" at 18 mesh / 3" so the same
    helper covers any future alignment strip (different mesh, wider strip,
    other text) without changes here.
    """
    glyph_rows = max(1, round(text_height_inches * mesh_count))
    total_cols = max(1, round(width_inches * mesh_count))

    # Rasterize at a higher resolution than the final stitch grid, then
    # downsample+threshold — same whole-string approach as
    # Frontend/lib/fonts/rasterFonts.ts, just done here since the backend
    # has no stitch-font system of its own.
    render_scale = 10
    font = ImageFont.truetype(str(_ALIGNMENT_TEST_FONT_PATH), glyph_rows * render_scale)
    probe_draw = ImageDraw.Draw(Image.new("L", (1, 1)))
    bbox = probe_draw.textbbox((0, 0), text, font=font)
    text_w, text_h = bbox[2] - bbox[0], bbox[3] - bbox[1]

    rendered = Image.new("L", (max(1, text_w), max(1, text_h)), 0)
    ImageDraw.Draw(rendered).text((-bbox[0], -bbox[1]), text, font=font, fill=255)

    glyph_cols = min(total_cols, max(1, round(text_w / text_h * glyph_rows))) if text_h else 1
    glyph = rendered.resize((glyph_cols, glyph_rows), Image.Resampling.LANCZOS)
    glyph_px = glyph.load()

    cells = [[BLANK_CELL] * total_cols for _ in range(glyph_rows)]
    col_offset = (total_cols - glyph_cols) // 2
    for r in range(glyph_rows):
        for c in range(glyph_cols):
            if glyph_px[c, r] >= 128:
                cells[r][col_offset + c] = _ALIGNMENT_TEST_INK

    return {
        "cells": cells,
        "mesh_count": mesh_count,
        "label": f'Alignment test — "{text}", {mesh_count} mesh, {width_inches:.0f}" wide',
        "signature": None,
    }


def generate_roll_print_pdf(
    designs: list[dict],
    roll_width_inches: float = MAX_ROLL_WIDTH_IN,
    gap_inches: float = 0.0,
    x_offset_pts: float = 0.0,
    skew_correction_pts: float = 0.0,
    skew_correction_y_pts: float = 0.0,
    y_scale: float = 1.0,
    logo_offset_in: tuple[float, float] = (0.0, 0.0),
    side_margin_inches: float | None = None,
    info_out: dict | None = None,
) -> Path:
    """`designs` items may include an optional `signature` (a SignatureAsset,
    already resolved to the design's creator) and/or `sku` (a SkuAsset, read
    directly off the project) drawn into the design's own 2" margin — see
    `_render_preview_image_from_cells`.

    Raises ValueError if any design is wider than the roll even after rotation.
    """
    roll_width_pts = roll_width_inches * 72
    gap_pts = gap_inches * 72

    # Pass 1: geometry only. `pagesize` needs the total height before the canvas
    # can exist, but holding every rendered page in RAM to get it cost ~76MB per
    # copy (measured, 13x20 at 18 mesh) — the form allows 20 copies, which is
    # 1.9GB against a 2GB container. This pass is pure arithmetic on the cell
    # counts; pass 2 renders one page at a time and releases it once drawn.
    layouts = []
    for design in designs:
        cells = design["cells"]
        mesh = design.get("mesh_count", 18)
        stitch_h = len(cells)
        stitch_w = len(cells[0]) if stitch_h else 0
        # Margin must match what the customer was charged for — same function
        # feeds get_canvas_for_design. Orientation-independent, so the rotation
        # below can't change it.
        #
        # An order where the buyer chose a tier downgrade carries its own
        # margin, and it must win: re-deriving the default here would draw a 2"
        # border on a canvas cut for a 1.75" one, overrunning the narrower roll
        # the order was priced and cut for. Explicit None check, not `or` — a
        # margin is never legitimately 0 but silently falling back would be the
        # same misprint.
        stored_margin = design.get("canvas_margin_inches")
        margin_in = (
            stored_margin if stored_margin is not None
            else canvas_margin_inches(stitch_w / mesh, stitch_h / mesh)
        )
        border_stitches = int(margin_in * mesh)
        # The roll is cut to width before loading, so its physical edge is
        # already the side margin. Overriding lets the imaged area stop at the
        # design instead of carrying a second margin inside the first.
        side_margin = margin_in if side_margin_inches is None else side_margin_inches
        side_border_stitches = int(side_margin * mesh)
        draw_w = ((stitch_w + 2 * side_border_stitches) / mesh) * 72
        # Designs whose column count won't fit the roll's fixed width print
        # rotated 90° so the long axis runs along the unbounded feed
        # direction instead — belts (38"+ long, 1.25" tall) are the case
        # that hits this; ordinary canvases never trigger it.
        rotate = draw_w > roll_width_pts
        if rotate:
            rotated_w = ((stitch_h + 2 * side_border_stitches) / mesh) * 72
            if rotated_w > roll_width_pts:
                # Neither orientation fits. Drawing it anyway centres it at a
                # negative x and silently clips both edges, wasting the canvas
                # with no signal — fail before anything reaches the printer.
                # Report the narrower orientation: that's the roll to load.
                raise ValueError(
                    f'"{design.get("label", "Untitled")}" needs a roll at least '
                    f'{min(draw_w, rotated_w) / 72:.1f}" wide (including its '
                    f'{margin_in:g}" canvas margins), but the roll is '
                    f'{roll_width_inches:.1f}" wide.'
                )
            stitch_w, stitch_h = stitch_h, stitch_w
            draw_w = rotated_w
        layouts.append({
            "rotate": rotate,
            "draw_w": draw_w,
            "draw_h": ((stitch_h + 2 * border_stitches) / mesh) * 72 * y_scale,
            "margin_in": margin_in,
            "side_margin_in": side_margin,
        })

    total_h = sum(lay["draw_h"] for lay in layouts) + gap_pts * max(0, len(layouts) - 1)

    # Filled for the caller's print log. An out-param rather than a changed
    # return type because the page length is incidental to generating the PDF
    # but is the number every calibration value is relative to — a skew of
    # 0.3" means nothing without knowing it spanned 18".
    if info_out is not None:
        info_out["page_length_inches"] = round(total_h / 72, 4)
        info_out["roll_width_inches"] = roll_width_inches
        info_out["designs"] = [
            {
                "label": d.get("label") or "",
                "mesh": d.get("mesh_count", 18),
                "printed_w_in": round(lay["draw_w"] / 72, 4),
                "printed_h_in": round(lay["draw_h"] / 72, 4),
                "rotated": lay["rotate"],
            }
            for d, lay in zip(designs, layouts)
        ]

    output_path = FINALIZED_DIR / "admin_roll_print.pdf"
    pdf = canvas.Canvas(str(output_path), pagesize=(roll_width_pts, total_h))
    pdf.setTitle("MNS Roll Print")

    # Apply shear to correct parallelogram drift: shifts bottom of print by
    # skew_correction_pts in X relative to the top. Positive = correct rightward drift.
    if skew_correction_pts:
        skew_factor = skew_correction_pts / total_h
        pdf.transform(1, 0, skew_factor, 1, -skew_factor * total_h, 0)

    # Same idea, other axis: corrects one side of the roll printing "ahead" of
    # the other across its width (printhead not perfectly perpendicular to the
    # feed) rather than drift along the feed direction. Shifts the right edge
    # of the print by skew_correction_y_pts in Y relative to the left edge.
    if skew_correction_y_pts:
        skew_factor_y = skew_correction_y_pts / roll_width_pts
        pdf.transform(1, skew_factor_y, 0, 1, 0, 0)

    y = total_h  # top of available area

    # Pass 2: render, draw, discard — one page resident at a time.
    for i, (design, lay) in enumerate(zip(designs, layouts)):
        cells = design["cells"]
        if lay["rotate"]:
            # Render upright — signature and SKU included — then turn the whole
            # finished image 90° clockwise. Rotating the cells first and drawing
            # the marks afterwards left them upright on a turned design, so once
            # the customer squared the canvas up the signature was on its side
            # in the wrong corner. Rotating the composite keeps every element in
            # the same relationship to the design.
            #
            # The margins swap with it: what was drawn top/bottom ends up across
            # the roll, so the side margin is passed as the vertical one here and
            # lands on the correct axis after the turn.
            img = _render_preview_image_from_cells(
                cells, design.get("mesh_count", 18), show_grid=False,
                include_border=True, border_inches=lay["side_margin_in"],
                side_border_inches=lay["margin_in"],
                signature=design.get("signature"), sku=design.get("sku"),
                signature_offset_in=logo_offset_in,
            )
            img = img.transpose(Image.Transpose.ROTATE_270)
        else:
            img = _render_preview_image_from_cells(
                cells, design.get("mesh_count", 18), show_grid=False,
                include_border=True, border_inches=lay["margin_in"],
                side_border_inches=lay["side_margin_in"],
                signature=design.get("signature"), sku=design.get("sku"),
                signature_offset_in=logo_offset_in,
            )

        img_x = (roll_width_pts - lay["draw_w"]) / 2 + x_offset_pts
        img_bottom = y - lay["draw_h"]

        buf = BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        pdf.drawImage(
            ImageReader(buf),
            img_x,
            img_bottom,
            width=lay["draw_w"],
            height=lay["draw_h"],
            preserveAspectRatio=False,
            mask="auto",
        )
        img.close()
        del img, buf

        y = img_bottom

        if i < len(layouts) - 1:
            _draw_roll_cut_line(pdf, y - gap_pts / 2, roll_width_pts, gap_pts)
            y -= gap_pts

    _set_print_actual_size(pdf)
    pdf.save()
    return output_path
