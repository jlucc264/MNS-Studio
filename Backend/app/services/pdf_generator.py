from io import BytesIO
from reportlab.lib.pagesizes import letter, landscape
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from PIL import Image, ImageDraw

from .storage import finalized_output_path, ASSETS_DIR

DISPLAY_CELL_SIZE = 12
GRID_COLOR = (180, 180, 180, 255)
BORDER_INCHES = 1.0


def _resolve_asset_path(asset_url: str) -> Path:
    cleaned = asset_url.lstrip("/")
    return ASSETS_DIR.parent / cleaned


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    cleaned = hex_color.lstrip("#")
    return tuple(int(cleaned[i:i+2], 16) for i in (0, 2, 4))


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
    page_width, page_height = page_size

    preview_image = _render_preview_image_from_cells(cells, mesh_count, show_grid)
    image_buffer = BytesIO()
    preview_image.save(image_buffer, format="PNG")
    image_buffer.seek(0)
    img = ImageReader(image_buffer)

    total_width_inches = width_inches + BORDER_INCHES * 2
    total_height_inches = height_inches + BORDER_INCHES * 2

    preview_print_width = total_width_inches * 72
    preview_print_height = total_height_inches * 72

    x = (page_width - preview_print_width) / 2
    y = (page_height - preview_print_height) / 2

    c.drawImage(
        img,
        x,
        y,
        width=preview_print_width,
        height=preview_print_height,
        preserveAspectRatio=True,
        mask='auto',
    )

    c.save()
    return out_url
