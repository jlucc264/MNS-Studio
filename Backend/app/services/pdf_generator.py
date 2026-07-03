import math
from pathlib import Path
from io import BytesIO
from collections import Counter
from datetime import datetime
from reportlab.lib.pagesizes import letter, landscape
from reportlab.lib import colors
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from reportlab.pdfbase.pdfdoc import ViewerPreferencesPDFDictionary
from PIL import Image, ImageDraw

from .storage import finalized_output_path, preview_output_path, ASSETS_DIR, FINALIZED_DIR

DISPLAY_CELL_SIZE = 12

def _fmt_canvas(n: float) -> str:
    return str(int(n)) if n == int(n) else f"{n:.1f}"


def _crop_to_content(cells: list[list[str]]) -> list[list[str]]:
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



def _resolve_asset_path(asset_url: str) -> Path:
    cleaned = asset_url.lstrip("/")
    return ASSETS_DIR.parent / cleaned


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
    logo_cells: list[list[str]] | None = None,
    border_inches: float = BORDER_INCHES,
) -> Image.Image:
    stitch_height = len(cells)
    stitch_width = len(cells[0]) if stitch_height else 0
    border_stitches = int(border_inches * mesh_count) if include_border else 0

    total_width = stitch_width + (2 * border_stitches)
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
        canvas_image.paste(quantized, (border_stitches, border_stitches))

    display_w = total_width * DISPLAY_CELL_SIZE
    display_h = total_height * DISPLAY_CELL_SIZE
    preview = canvas_image.resize((display_w, display_h), Image.Resampling.NEAREST).convert("RGBA")

    if show_grid:
        draw = ImageDraw.Draw(preview)
        for x in range(0, display_w + 1, DISPLAY_CELL_SIZE):
            draw.line([(x, 0), (x, display_h)], fill=grid_color, width=grid_line_width)
        for y in range(0, display_h + 1, DISPLAY_CELL_SIZE):
            draw.line([(0, y), (display_w, y)], fill=grid_color, width=grid_line_width)

    if include_border and logo_cells and border_stitches > 0:
        cropped_logo = _crop_to_content(logo_cells)
        logo_h = len(cropped_logo)
        logo_w = len(cropped_logo[0]) if logo_h else 0
        if logo_w and logo_h:
            logo_img = Image.new("RGBA", (logo_w, logo_h), (255, 255, 255, 0))
            logo_img.putdata([
                (255, 255, 255, 0) if cell == BLANK_CELL
                else (0, 0, 0, 255) if cell == FINISH_OUTLINE_CELL
                else (*_hex_to_rgb(cell), 255)
                for row in cropped_logo
                for cell in row
            ])
            logo_display_w = logo_w * DISPLAY_CELL_SIZE
            logo_display_h = logo_h * DISPLAY_CELL_SIZE
            logo_scaled = logo_img.resize((logo_display_w, logo_display_h), Image.Resampling.NEAREST)
            padding = DISPLAY_CELL_SIZE
            paste_x = display_w - logo_display_w - padding
            paste_y = display_h - logo_display_h - padding
            preview.paste(logo_scaled, (paste_x, paste_y), logo_scaled)

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
    logo_cells: list[list[str]] | None = None,
) -> tuple[str, Path, Path, str, Path]:
    public_path, public_url = finalized_output_path("finalized")
    internal_path, _ = finalized_output_path("internal_finalized")
    preview_path, preview_url = preview_output_path()

    # Derive authoritative design dimensions from cell content, not import settings
    preview_cells = _crop_to_content(cells)
    design_w = len(preview_cells[0]) / mesh_count if preview_cells and preview_cells[0] else width_inches
    design_h = len(preview_cells) / mesh_count if preview_cells else height_inches

    page_size = landscape(letter) if design_w > design_h else letter
    # Cover preview: design + 2" canvas margin on each side, with logo
    preview_image = _render_preview_image_from_cells(
        preview_cells, mesh_count, show_grid, logo_cells=logo_cells, border_inches=2.0,
    )
    preview_image.save(preview_path, format="PNG")
    # Report thumbnail: just the design (no canvas border) so it fills the small thumb area
    thumb_image = _render_preview_image_from_cells(
        preview_cells, mesh_count, show_grid, include_border=False,
    )
    report_rows = _build_report_rows(cells, palette)
    total_stitches = sum(row["count"] for row in report_rows)
    used_colors = len(report_rows)
    has_outline = any(cell == FINISH_OUTLINE_CELL for row in cells for cell in row)

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
            preview_border_inches=2.0,
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


def generate_roll_print_pdf(
    designs: list[dict],
    roll_width_inches: float = 8.0,
    gap_inches: float = 2.0,
    logo_cells_by_mesh: dict[int, list[list[str]]] | None = None,
    x_offset_pts: float = 0.0,
    skew_correction_pts: float = 0.0,
    y_scale: float = 1.0,
) -> Path:
    roll_width_pts = roll_width_inches * 72
    gap_pts = gap_inches * 72
    top_margin_pts = 36.0
    bottom_margin_pts = 72.0
    label_h = 16.0

    rendered = []
    for design in designs:
        cells = design["cells"]
        mesh = design.get("mesh_count", 18)
        stitch_h = len(cells)
        stitch_w = len(cells[0]) if stitch_h else 0
        draw_w = (stitch_w / mesh) * 72
        draw_h = (stitch_h / mesh) * 72 * y_scale
        img = _render_preview_image_from_cells(cells, mesh, show_grid=False, include_border=False)
        rendered.append({
            "img": img,
            "draw_w": draw_w,
            "draw_h": draw_h,
            "label": design.get("label", ""),
            "mesh": mesh,
        })

    total_h = top_margin_pts
    for i, r in enumerate(rendered):
        if r["label"]:
            total_h += label_h
        total_h += r["draw_h"]
        if i < len(rendered) - 1:
            total_h += gap_pts
    total_h += bottom_margin_pts

    output_path = FINALIZED_DIR / "admin_roll_print.pdf"
    pdf = canvas.Canvas(str(output_path), pagesize=(roll_width_pts, total_h))
    pdf.setTitle("MNS Roll Print")

    # Apply shear to correct parallelogram drift: shifts bottom of print by
    # skew_correction_pts in X relative to the top. Positive = correct rightward drift.
    if skew_correction_pts:
        skew_factor = skew_correction_pts / total_h
        pdf.transform(1, 0, skew_factor, 1, -skew_factor * total_h, 0)

    y = total_h - top_margin_pts  # top of available area

    for i, r in enumerate(rendered):
        if r["label"]:
            pdf.setFont("Helvetica", 8)
            pdf.setFillColor(colors.HexColor("#7A817A"))
            label_x = (roll_width_pts - r["draw_w"]) / 2
            pdf.drawString(label_x, y - label_h + 4, r["label"])
            y -= label_h

        img_x = (roll_width_pts - r["draw_w"]) / 2 + x_offset_pts
        img_bottom = y - r["draw_h"]

        buf = BytesIO()
        r["img"].save(buf, format="PNG")
        buf.seek(0)
        pdf.drawImage(
            ImageReader(buf),
            img_x,
            img_bottom,
            width=r["draw_w"],
            height=r["draw_h"],
            preserveAspectRatio=False,
            mask="auto",
        )
        # Draw logo in bottom-right of this design's canvas margin area
        logo_cells = (logo_cells_by_mesh or {}).get(rendered[i].get("mesh", 18))
        if logo_cells:
            logo_cells = _crop_to_content(logo_cells)
            logo_ch = len(logo_cells)
            logo_cw = len(logo_cells[0]) if logo_ch else 0
            mesh = rendered[i].get("mesh", 18)
            if logo_cw and logo_ch:
                logo_pts_w = (logo_cw / mesh) * 72
                logo_pts_h = (logo_ch / mesh) * 72
                logo_img_raw = Image.new("RGBA", (logo_cw, logo_ch), (255, 255, 255, 0))
                logo_img_raw.putdata([
                    (255, 255, 255, 0) if cell == BLANK_CELL
                    else (0, 0, 0, 255) if cell == FINISH_OUTLINE_CELL
                    else (*_hex_to_rgb(cell), 255)
                    for row in logo_cells
                    for cell in row
                ])
                logo_buf = BytesIO()
                logo_img_raw.save(logo_buf, format="PNG")
                logo_buf.seek(0)
                padding_pts = 4
                logo_x = roll_width_pts - logo_pts_w - padding_pts
                logo_y = img_bottom - logo_pts_h - padding_pts
                pdf.drawImage(
                    ImageReader(logo_buf),
                    logo_x, logo_y,
                    width=logo_pts_w, height=logo_pts_h,
                    preserveAspectRatio=False, mask="auto",
                )

        y = img_bottom

        if i < len(rendered) - 1:
            _draw_roll_cut_line(pdf, y - gap_pts / 2, roll_width_pts, gap_pts)
            y -= gap_pts

    _set_print_actual_size(pdf)
    pdf.save()
    return output_path
