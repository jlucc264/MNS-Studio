from pathlib import Path
from io import BytesIO
from collections import Counter
from datetime import datetime
from reportlab.lib.pagesizes import letter, landscape
from reportlab.lib import colors
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from PIL import Image, ImageDraw

from .storage import finalized_output_path, ASSETS_DIR

DISPLAY_CELL_SIZE = 12
GRID_COLOR = (180, 180, 180, 255)
BORDER_INCHES = 1.0
PAGE_MARGIN = 42
CARD_RADIUS = 12


def _resolve_asset_path(asset_url: str) -> Path:
    cleaned = asset_url.lstrip("/")
    return ASSETS_DIR.parent / cleaned


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    cleaned = hex_color.lstrip("#")
    return tuple(int(cleaned[i:i+2], 16) for i in (0, 2, 4))


def _rgb_to_reportlab(hex_color: str) -> colors.Color:
    red, green, blue = _hex_to_rgb(hex_color)
    return colors.Color(red / 255, green / 255, blue / 255)


def _render_preview_image_from_cells(
    cells: list[list[str]],
    mesh_count: int,
    show_grid: bool,
) -> Image.Image:
    stitch_height = len(cells)
    stitch_width = len(cells[0]) if stitch_height else 0
    border_stitches = int(BORDER_INCHES * mesh_count)

    total_width = stitch_width + (2 * border_stitches)
    total_height = stitch_height + (2 * border_stitches)

    quantized = Image.new("RGB", (stitch_width, stitch_height), (255, 255, 255))
    if stitch_width and stitch_height:
        quantized.putdata([
            _hex_to_rgb(cell)
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
            draw.line([(x, 0), (x, display_h)], fill=GRID_COLOR, width=1)
        for y in range(0, display_h + 1, DISPLAY_CELL_SIZE):
            draw.line([(0, y), (display_w, y)], fill=GRID_COLOR, width=1)

    return preview


def _build_report_rows(cells: list[list[str]], palette: list[dict]) -> list[dict]:
    counts = Counter(
        cell
        for row in cells
        for cell in row
        if cell != "#FFFFFF"
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
    color_count: int,
    contrast_level: str,
    palette: list[dict],
    cells: list[list[str]],
) -> None:
    page_width, page_height = page_size
    margin = PAGE_MARGIN
    content_width = page_width - margin * 2
    y = page_height - margin

    rows = _build_report_rows(cells, palette)
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

    thumb_width = 94
    thumb_height = 94
    thumb_buffer = BytesIO()
    preview_image.save(thumb_buffer, format="PNG")
    thumb_buffer.seek(0)
    thumb = ImageReader(thumb_buffer)
    pdf.drawImage(
        thumb,
        page_width - margin - thumb_width - 18,
        page_height - 132,
        width=thumb_width,
        height=thumb_height,
        preserveAspectRatio=True,
        mask='auto',
    )

    summary_x = margin + 18
    summary_y = page_height - 112
    summary_pairs = [
        ("Finished size", f'{width_inches:.1f}" x {height_inches:.1f}"'),
        ("Canvas size", f'{width_inches + BORDER_INCHES * 2:.1f}" x {height_inches + BORDER_INCHES * 2:.1f}"'),
        ("Mesh", str(mesh_count)),
        ("Requested colors", str(color_count)),
        ("Colors used", str(used_colors)),
        ("Total stitches", str(total_stitches)),
        ("Contrast", contrast_level.replace('_', ' ')),
        ("Exported", export_date),
    ]

    pdf.setFont("Helvetica-Bold", 10)
    pdf.setFillColor(colors.HexColor("#3A413B"))
    for index, (label, value) in enumerate(summary_pairs):
        column = index // 4
        row = index % 4
        x = summary_x + column * 178
        y_position = summary_y - row * 18
        pdf.drawString(x, y_position, f"{label}:")
        pdf.setFont("Helvetica", 10)
        pdf.drawString(x + 82, y_position, value)
        pdf.setFont("Helvetica-Bold", 10)

    y = page_height - 182
    pdf.setStrokeColor(colors.HexColor("#D9D9D9"))
    pdf.line(margin, y, margin + content_width, y)
    y -= 22

    swatch_x = margin
    code_x = swatch_x + 28
    name_x = margin + 140
    count_x = page_width - margin - 90

    pdf.setFont("Helvetica-Bold", 11)
    pdf.setFillColor(colors.HexColor("#222222"))
    pdf.drawString(code_x, y, "Code")
    pdf.drawString(name_x, y, "Color")
    pdf.drawRightString(page_width - margin, y, "Stitches")
    y -= 14
    pdf.setStrokeColor(colors.HexColor("#E6E6E6"))
    pdf.line(margin, y, margin + content_width, y)
    y -= 16

    row_height = 24
    swatch_size = 14
    pdf.setFont("Helvetica", 10)

    for index, row in enumerate(rows):
        if y < margin + 24:
            pdf.showPage()
            pdf.setFillColor(colors.HexColor("#F7F5F0"))
            pdf.roundRect(margin, page_height - 74, content_width, 40, CARD_RADIUS, fill=1, stroke=0)
            pdf.setFont("Helvetica-Bold", 16)
            pdf.setFillColor(colors.HexColor("#173F2A"))
            pdf.drawString(margin + 16, page_height - 58, "MNS Studio Finalized Report")
            y = page_height - 98
            pdf.setFont("Helvetica-Bold", 11)
            pdf.setFillColor(colors.HexColor("#222222"))
            pdf.drawString(code_x, y, "Code")
            pdf.drawString(name_x, y, "Color")
            pdf.drawRightString(page_width - margin, y, "Stitches")
            y -= 14
            pdf.line(margin, y, margin + content_width, y)
            y -= 16
            pdf.setFont("Helvetica", 10)

        if index % 2 == 0:
            pdf.setFillColor(colors.HexColor("#FBFBFB"))
            pdf.roundRect(margin - 6, y - 16, content_width + 12, 20, 6, fill=1, stroke=0)

        pdf.setFillColor(_rgb_to_reportlab(row["hex"]))
        pdf.rect(swatch_x, y - swatch_size + 3, swatch_size, swatch_size, fill=1, stroke=0)
        pdf.setStrokeColor(colors.HexColor("#B8B8B8"))
        pdf.rect(swatch_x, y - swatch_size + 3, swatch_size, swatch_size, fill=0, stroke=1)

        pdf.setFillColor(colors.black)
        pdf.drawString(code_x, y, row["dmc_code"])
        pdf.drawString(name_x, y, row["dmc_name"])
        pdf.drawRightString(page_width - margin, y, str(row["count"]))
        y -= row_height


def _draw_cover_page(
    pdf: canvas.Canvas,
    page_size: tuple[float, float],
    preview_image: Image.Image,
    width_inches: float,
    height_inches: float,
    mesh_count: int,
    color_count: int,
    contrast_level: str,
    used_colors: int,
    total_stitches: int,
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

    total_width_inches = width_inches + BORDER_INCHES * 2
    total_height_inches = height_inches + BORDER_INCHES * 2
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
        ("Design", f'{width_inches:.1f}" x {height_inches:.1f}"'),
        ("Mesh", str(mesh_count)),
        ("Requested", str(color_count)),
        ("Used", str(used_colors)),
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


def _draw_true_size_reference_page(
    pdf: canvas.Canvas,
    width_inches: float,
    height_inches: float,
    mesh_count: int,
    preview_image: Image.Image,
) -> None:
    total_width_inches = width_inches + BORDER_INCHES * 2
    total_height_inches = height_inches + BORDER_INCHES * 2
    draw_width = total_width_inches * 72
    draw_height = total_height_inches * 72

    page_width = draw_width + 72
    page_height = draw_height + 108
    pdf.setPageSize((page_width, page_height))

    pdf.setFillColor(colors.HexColor("#173F2A"))
    pdf.setFont("Helvetica-Bold", 18)
    pdf.drawString(36, page_height - 34, "Internal reference")
    pdf.setFillColor(colors.HexColor("#5B635C"))
    pdf.setFont("Helvetica", 10)
    pdf.drawString(
        36,
        page_height - 50,
        f"True-size gridded canvas at {mesh_count} mesh ({total_width_inches:.1f}\" x {total_height_inches:.1f}\")",
    )

    preview_buffer = BytesIO()
    preview_image.save(preview_buffer, format="PNG")
    preview_buffer.seek(0)
    img = ImageReader(preview_buffer)

    x = (page_width - draw_width) / 2
    y = 30
    pdf.drawImage(
        img,
        x,
        y,
        width=draw_width,
        height=draw_height,
        preserveAspectRatio=True,
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
) -> str:
    out_path, out_url = finalized_output_path()

    page_size = landscape(letter) if width_inches > height_inches else letter
    c = canvas.Canvas(str(out_path), pagesize=page_size)

    preview_image = _render_preview_image_from_cells(cells, mesh_count, show_grid)
    report_rows = _build_report_rows(cells, palette)
    total_stitches = sum(row["count"] for row in report_rows)
    used_colors = len(report_rows)

    _draw_cover_page(
        c,
        page_size,
        preview_image,
        width_inches,
        height_inches,
        mesh_count,
        color_count,
        contrast_level,
        used_colors,
        total_stitches,
    )

    c.showPage()
    _draw_report_page(
        c,
        page_size,
        preview_image,
        width_inches,
        height_inches,
        mesh_count,
        color_count,
        contrast_level,
        palette,
        cells,
    )

    c.showPage()
    true_size_grid_image = _render_preview_image_from_cells(cells, mesh_count, True)
    _draw_true_size_reference_page(
        c,
        width_inches,
        height_inches,
        mesh_count,
        true_size_grid_image,
    )

    c.save()
    return out_url
