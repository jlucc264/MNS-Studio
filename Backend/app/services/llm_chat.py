import io
import json
import logging
import os
from pathlib import Path
from urllib.request import Request, urlopen

from PIL import Image

import base64
from app.services.storage import save_remote_image, UPLOADS_DIR, PREVIEWS_DIR, ASSETS_DIR

logger = logging.getLogger(__name__)

def _get_anthropic():
    try:
        from anthropic import Anthropic
        key = os.environ.get("ANTHROPIC_API_KEY", "")
        if not key:
            return None
        return Anthropic(api_key=key)
    except ImportError:
        return None


def _get_openai():
    try:
        from openai import OpenAI
        key = os.environ.get("OPENAI_API_KEY", "")
        if not key:
            return None
        return OpenAI(api_key=key)
    except ImportError:
        return None

TOOLS = [
    {
        "name": "set_source_mode",
        "description": (
            "Change the source mode used when generating the stitch preview. "
            "photo: best for regular photos and artwork. "
            "stitched_photo: best for photos of existing stitched/needlepoint work. "
            "graphic_art: best for logos, text, screenshots, and crisp flat graphics."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "mode": {
                    "type": "string",
                    "enum": ["photo", "stitched_photo", "graphic_art"],
                }
            },
            "required": ["mode"],
        },
    },
    {
        "name": "set_dimensions",
        "description": "Set the design width, height (in inches), or mesh count. All fields are optional — only include what needs to change.",
        "input_schema": {
            "type": "object",
            "properties": {
                "width_inches": {"type": "number", "description": "Width in inches (0.5–18)"},
                "height_inches": {"type": "number", "description": "Height in inches (0.5–18)"},
                "mesh_count": {
                    "type": "integer",
                    "enum": [13, 18],
                    "description": "13 mesh = larger stitches, 18 mesh = finer detail",
                },
            },
        },
    },
    {
        "name": "set_color_count",
        "description": "Reduce the current palette to a target number of colors. Only works after a stitch preview has been generated.",
        "input_schema": {
            "type": "object",
            "properties": {
                "count": {"type": "integer", "description": "Target color count (2–64)"},
            },
            "required": ["count"],
        },
    },
    {
        "name": "toggle_setting",
        "description": (
            "Enable or disable a canvas processing setting. Options: "
            "clean_background (treat blank areas as unpainted canvas), "
            "simplify_colors (reduce noisy color variation), "
            "strengthen_dark_detail (preserve dark edges and lettering), "
            "preserve_accents (keep small bright accent colors), "
            "show_grid (grid overlay on the preview)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "setting": {
                    "type": "string",
                    "enum": [
                        "clean_background",
                        "simplify_colors",
                        "strengthen_dark_detail",
                        "preserve_accents",
                        "show_grid",
                    ],
                },
                "enabled": {"type": "boolean"},
            },
            "required": ["setting", "enabled"],
        },
    },
    {
        "name": "set_contrast",
        "description": "Set the contrast level for stitch preview generation.",
        "input_schema": {
            "type": "object",
            "properties": {
                "level": {
                    "type": "string",
                    "enum": ["low", "normal", "high", "super_high", "super_super_high"],
                }
            },
            "required": ["level"],
        },
    },
    {
        "name": "generate_stitch_preview",
        "description": "Generate or refresh the stitch preview from the current settings. Call this after changing settings when the user wants to see an updated preview.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "undo_last_edit",
        "description": "Undo the last color edit made to the stitch preview.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "redo_last_edit",
        "description": "Redo the last undone edit.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "reset_preview_edits",
        "description": "Reset all manual color edits and return to the generated base preview.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "remove_color",
        "description": "Remove a color from the stitch preview by its DMC thread code.",
        "input_schema": {
            "type": "object",
            "properties": {
                "dmc_code": {"type": "string", "description": "DMC thread code, e.g. '321' or 'blanc'"},
            },
            "required": ["dmc_code"],
        },
    },
    {
        "name": "restore_color",
        "description": "Restore a previously removed color in the stitch preview.",
        "input_schema": {
            "type": "object",
            "properties": {
                "dmc_code": {"type": "string"},
            },
            "required": ["dmc_code"],
        },
    },
    {
        "name": "merge_colors",
        "description": "Merge one or more palette colors into a target color, replacing all stitches of the source colors with the target.",
        "input_schema": {
            "type": "object",
            "properties": {
                "from_codes": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "DMC codes to merge away",
                },
                "to_code": {"type": "string", "description": "DMC code to merge into"},
            },
            "required": ["from_codes", "to_code"],
        },
    },
    {
        "name": "swap_color",
        "description": (
            "Replace a palette color with any DMC thread color, including colors not currently in the palette. "
            "Use this when the user wants to change a color to something specific, e.g. 'make the sky more orange' or 'swap the red to a coral'. "
            "Pick the closest matching DMC code by name or color family."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "from_code": {"type": "string", "description": "DMC code of the color to replace"},
                "to_code": {"type": "string", "description": "DMC code of the replacement color (can be any DMC color)"},
            },
            "required": ["from_code", "to_code"],
        },
    },
    {
        "name": "fill_selection",
        "description": (
            "Fill the user's currently highlighted/dragged selection region with a DMC color. "
            "Only call this when has_selection is true. Use for requests like 'make this area red' or 'fill the selected region with black'."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "color_code": {"type": "string", "description": "DMC code to fill the selection with"},
            },
            "required": ["color_code"],
        },
    },
    {
        "name": "clear_selection",
        "description": (
            "Blank out all cells in the user's currently highlighted selection region. "
            "Only call this when has_selection is true. Use for requests like 'erase this area' or 'clear the selected section'."
        ),
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "paint_border",
        "description": (
            "Paint the outer edge cells of the stitch grid with a specified DMC color. "
            "Use this to clean up or add a consistent border around the design, e.g. 'make the edge all black'."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "color_code": {"type": "string", "description": "DMC code to paint the border with, e.g. '310' for black"},
            },
            "required": ["color_code"],
        },
    },
    {
        "name": "clear_background",
        "description": (
            "Detect and remove the background of the design by flood-filling from the grid edges. "
            "Finds all cells of the specified color that are connected to the border and blanks or recolors them. "
            "Use this for requests like 'remove the yellow background' or 'clear the white around the subject'."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "color_code": {"type": "string", "description": "DMC code of the background color to remove"},
                "replacement_code": {"type": "string", "description": "DMC code to fill with instead of blanking (optional)"},
            },
            "required": ["color_code"],
        },
    },
    {
        "name": "set_removal_mode",
        "description": "Set what happens when a color is removed: fill with nearby colors, or leave blank canvas cells.",
        "input_schema": {
            "type": "object",
            "properties": {
                "mode": {"type": "string", "enum": ["fill", "blank"]},
            },
            "required": ["mode"],
        },
    },
    {
        "name": "draw_shape",
        "description": (
            "Draw a box, arc, or line directly on the stitch grid at specified cell coordinates. "
            "Coordinates are zero-based row/col indices within the design grid (see grid_rows/grid_cols in context). "
            "Use this to add frames, borders, dividers, or decorative shapes to the design."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "shape": {
                    "type": "string",
                    "enum": ["box", "arc", "line"],
                    "description": "box: rectangle, arc: ellipse/circle, line: straight line",
                },
                "r1": {"type": "integer", "description": "Start row (0-based)"},
                "c1": {"type": "integer", "description": "Start col (0-based)"},
                "r2": {"type": "integer", "description": "End row (0-based, inclusive)"},
                "c2": {"type": "integer", "description": "End col (0-based, inclusive)"},
                "fill_color": {
                    "type": "string",
                    "description": "DMC code for interior fill (omit for no fill)",
                },
                "border_color": {
                    "type": "string",
                    "description": "DMC code for border/line color (omit for no border)",
                },
                "border_size": {
                    "type": "integer",
                    "description": "Border or line thickness in cells (1–4, default 1)",
                },
                "full_circle": {
                    "type": "boolean",
                    "description": "For arc shape: draw a full ellipse/circle (default false = semicircle)",
                },
            },
            "required": ["shape", "r1", "c1", "r2", "c2"],
        },
    },
    {
        "name": "add_text",
        "description": (
            "Place text on the stitch grid using bitmap pixel fonts. "
            "The text starts at the specified row/col cell position. "
            "Use this to add labels, monograms, initials, or any lettering to the design. "
            "Check grid_rows/grid_cols in context to pick a sensible starting position."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "The text to place"},
                "row": {"type": "integer", "description": "Starting row (0-based)"},
                "col": {"type": "integer", "description": "Starting col (0-based)"},
                "color": {"type": "string", "description": "DMC code for the text color"},
                "font_size": {
                    "type": "string",
                    "enum": ["small", "medium", "large"],
                    "description": (
                        "sans/serif: small=3×5, medium=5×7, large=9×13 cells. "
                        "script: small/medium=9×12, large=18×24 cells. "
                        "Display fonts: small=16, medium=22, large=30 cells tall "
                        "(default: medium)"
                    ),
                },
                "font_family": {
                    "type": "string",
                    "enum": [
                        "sans", "serif", "script",
                        "dancing-script", "pacifico", "playfair-display",
                        "alfa-slab-one", "luckiest-guy",
                    ],
                    "description": (
                        "Stitch fonts: sans or serif (both support lowercase), or script — a "
                        "flourished monogram style, capitals only. Display fonts (rasterized "
                        "real typefaces, need 16+ rows of space): dancing-script (connected "
                        "cursive), pacifico (brush script), playfair-display (elegant serif), "
                        "alfa-slab-one (chunky slab), luckiest-guy (fun bold). Default: sans"
                    ),
                },
                "bold": {"type": "boolean"},
                "italic": {"type": "boolean"},
                "outline": {"type": "boolean", "description": "Hollow outline-only letters"},
                "orientation": {
                    "type": "string",
                    "enum": ["horizontal", "stacked", "down", "up"],
                    "description": (
                        "horizontal=normal; stacked=upright letters running top-to-bottom; "
                        "down=rotated 90° reading downward; up=rotated 90° reading upward "
                        "(default: horizontal). row/col is always the top-left of the placed block."
                    ),
                },
            },
            "required": ["text", "row", "col", "color"],
        },
    },
    {
        "name": "flood_fill",
        "description": (
            "Fill all connected cells of the same color at a given position with a new color — like a paint bucket. "
            "Replaces the color at the specified cell and all adjacent cells of the same original color. "
            "Useful for recoloring large uniform regions without touching neighboring colors."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "row": {"type": "integer", "description": "Seed row for the fill (0-based)"},
                "col": {"type": "integer", "description": "Seed col for the fill (0-based)"},
                "color": {"type": "string", "description": "DMC code of the new fill color"},
            },
            "required": ["row", "col", "color"],
        },
    },
    {
        "name": "generate_source_image",
        "description": (
            "Generate a new source image from a text description using AI image generation (DALL-E 3). "
            "The generated image will be loaded as the source image for stitching. "
            "Recommend clear, graphic, illustration styles for best needlepoint results."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "prompt": {
                    "type": "string",
                    "description": "Description of the image. Specific subjects, colors, and flat/illustrated styles work best.",
                },
            },
            "required": ["prompt"],
        },
    },
    {
        "name": "edit_source_image",
        "description": (
            "Edit or transform the current source image using AI (gpt-image-1). "
            "Use this for perspective correction, style changes, background removal, "
            "color adjustments, or any other modification to the existing source image. "
            "Only works when a source image is already loaded."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "prompt": {
                    "type": "string",
                    "description": "Description of the edit to apply, e.g. 'make the perspective more front-facing' or 'remove the background'.",
                },
            },
            "required": ["prompt"],
        },
    },
]


def _build_system_prompt(context: dict) -> str:
    palette_lines = ""
    palette = context.get("palette", [])
    if palette:
        shown = palette[:24]
        palette_lines = "\nCurrent palette:\n" + "\n".join(
            f"  DMC {p.get('dmc_code', '?')} ({p.get('name', '')}, {p.get('hex', '')})"
            for p in shown
        )
        if len(palette) > 24:
            palette_lines += f"\n  … and {len(palette) - 24} more"

    source_mode = context.get("source_mode", "photo")
    mode_hint = {
        "photo": "Regular photo or artwork",
        "stitched_photo": "Photo of existing stitched work",
        "graphic_art": "Logo, screenshot, or flat graphic",
    }.get(source_mode, source_mode)

    grid_rows = context.get("grid_rows", 0)
    grid_cols = context.get("grid_cols", 0)
    grid_info = f"\n- Grid size: {grid_rows} rows × {grid_cols} cols (cell coordinates for draw_shape/add_text/flood_fill)" if grid_rows and grid_cols else ""

    has_preview = context.get("has_preview", False)
    has_preview_image = has_preview and bool(context.get("preview_image_url"))
    has_source_image_vision = bool(context.get("source_image_url"))
    if has_preview_image and has_source_image_vision:
        vision_note = (
            "\n\nVISION: Both the original source image and the current stitch preview are attached. "
            "Use the source image to understand what the design is supposed to look like — colors, subject, features. "
            "Use the stitch preview to see how those features were rendered into DMC thread colors. "
            "Compare the two to identify where color mapping went wrong, which features are unclear, and what edits would improve fidelity. "
            "Always match visual regions to DMC codes from the palette before calling tools."
        )
    elif has_preview_image:
        vision_note = (
            "\n\nVISION: The current stitch preview is attached. "
            "Use it to visually identify which DMC colors correspond to which features — "
            "background, main subject, details, shadows, etc. "
            "Match what you see to the DMC codes in the palette above before making edits."
        )
    else:
        vision_note = ""
    editing_bias = (
        "\n\nEDITING BIAS (important): A stitch preview is already on the canvas. "
        "For any request that could be interpreted as either a canvas edit OR a regeneration, "
        "strongly prefer direct canvas edits (draw_shape, add_text, flood_fill, swap_color, remove_color, fill_selection, etc.). "
        "Only call generate_stitch_preview or edit_source_image if the user is explicitly asking to redo the conversion, "
        "change source settings (contrast, mesh, size, source mode), or start fresh. "
        "Never regenerate just to 'improve' or 'adjust' something that can be done by editing cells directly."
    ) if has_preview else ""

    return f"""You are a friendly, expert assistant for MNS Studio, a web app for creating needlepoint and cross-stitch patterns from images.

Current canvas state:
- Source mode: {source_mode} ({mode_hint})
- Design size: {context.get('width_inches', 4.0)}" × {context.get('height_inches', 4.0)}" at {context.get('mesh_count', 13)} mesh{grid_info}
- Has source image loaded: {context.get('has_source_image', False)}
- Has stitch preview: {has_preview}
- Has active selection: {context.get('has_selection', False)}{' (user has highlighted a region — use fill_selection or clear_selection to edit it)' if context.get('has_selection') else ''}
- Processing: clean_background={context.get('clean_background', False)}, simplify_colors={context.get('simplify_colors', False)}, strengthen_dark_detail={context.get('strengthen_dark_detail', False)}, preserve_accents={context.get('preserve_accents', False)}, contrast={context.get('contrast_level', 'normal')}{palette_lines}{vision_note}{editing_bias}

You help users by:
1. Editing the stitch canvas directly (draw_shape, add_text, flood_fill, swap_color, remove_color, fill_selection)
2. Adjusting canvas settings and regenerating previews when explicitly requested
3. Editing the palette (remove, restore, merge, swap colors)
4. Generating AI source images from text descriptions
5. Answering questions about needlepoint and cross-stitch design

Keep responses concise and natural. When making multiple changes, chain tool calls together and summarize what you did in one sentence. If a setting change should be followed by regenerating the preview, call generate_stitch_preview after the setting change.

Coordinate guidance: row 0, col 0 is the top-left cell of the design. Use grid_rows and grid_cols to stay within bounds. For centered text, estimate: col ≈ (grid_cols - text_length * char_advance) / 2, where char_advance is ~4 for small, ~6 for medium, ~9 for large font.

Image generation rule: before calling generate_source_image or edit_source_image, check the canvas state. If width_inches=4.0, height_inches=4.0, and mesh_count=13 (all defaults), ask the user to confirm or set their desired size and mesh count first — the image will be generated at exactly those stitch dimensions. If the user has already customized any of these values, proceed without asking.

Visual editing guidance:
- "Make the background white/blank": identify the dominant border-connected color in the image, then call clear_background with that DMC code and Blanc (B5200) or White as replacement_code
- "Feature is blobby / lacks detail / not coming through": always try color edits first before suggesting any settings change. Look at the image, identify the feature's cells, then: (1) use flood_fill to add a dark outline around the feature's border cells to define its edges — this is the most effective single fix at low stitch counts; (2) if the feature uses only one color, use flood_fill to add a second contrasting color inside it for internal definition; (3) swap any colors that are too close in value to the surrounding area for more distinct ones. Only suggest increasing mesh count or canvas size if the feature occupies so few cells (under ~4×4) that no color edit can make it recognizable.
- "Feature isn't coming through / too muddy": look at the image to identify which colors are muddying that feature, then use swap_color to replace them or call generate_stitch_preview with higher contrast
- "Change X color": look at the image to identify which DMC code corresponds to X, then call swap_color

Needlepoint design tips to share when relevant:
- 13 mesh = larger stitches, good for bold designs; 18 mesh = finer detail, more colors visible
- graphic_art mode works best for logos, text, and anything with crisp edges
- Simplify colors helps when the image has too much noise; strengthen_dark_detail preserves outlines"""



def _load_source_image_bytes(source_image_url: str) -> bytes:
    """Return PNG bytes for the source image, reading from disk or fetching by URL."""
    raw: bytes | None = None

    # Local asset path e.g. /assets/uploads/foo.png
    if source_image_url.startswith("/assets/uploads/"):
        local = UPLOADS_DIR / source_image_url[len("/assets/uploads/"):]
        if local.exists():
            raw = local.read_bytes()

    # Full HTTP(S) URL — Supabase or any external source
    if raw is None and source_image_url.startswith("http"):
        req = Request(source_image_url, headers={"User-Agent": "MNS/1.0"})
        with urlopen(req, timeout=20) as resp:
            raw = resp.read()

    if raw is None:
        raise ValueError(f"Could not load source image from: {source_image_url}")

    # Normalise to RGBA PNG so OpenAI accepts it
    img = Image.open(io.BytesIO(raw)).convert("RGBA")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _load_preview_image_b64(preview_url: str, max_size: int = 512) -> str | None:
    """Load a preview image, resize to max_size, return base64 PNG. Returns None on failure."""
    try:
        raw: bytes | None = None
        if preview_url.startswith("/assets/"):
            local = ASSETS_DIR / preview_url[len("/assets/"):]
            if local.exists():
                raw = local.read_bytes()
        if raw is None and preview_url.startswith("http"):
            req = Request(preview_url, headers={"User-Agent": "MNS/1.0"})
            with urlopen(req, timeout=20) as resp:
                raw = resp.read()
        if raw is None:
            return None
        img = Image.open(io.BytesIO(raw)).convert("RGB")
        img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode()
    except Exception:
        return None


def _process_tool_call(tool_name: str, tool_input: dict, context: dict) -> tuple[str, dict | None]:
    """Execute a single tool call. Returns (result_text, action_dict | None)."""

    if tool_name == "set_source_mode":
        mode = tool_input["mode"]
        return f"Source mode set to {mode}.", {"type": "set_source_mode", "value": mode}

    if tool_name == "set_dimensions":
        action: dict = {"type": "set_dimensions"}
        parts = []
        if "width_inches" in tool_input:
            action["width_inches"] = tool_input["width_inches"]
            parts.append(f"width → {tool_input['width_inches']}\"")
        if "height_inches" in tool_input:
            action["height_inches"] = tool_input["height_inches"]
            parts.append(f"height → {tool_input['height_inches']}\"")
        if "mesh_count" in tool_input:
            action["mesh_count"] = tool_input["mesh_count"]
            parts.append(f"mesh → {tool_input['mesh_count']}")
        return f"Updated {', '.join(parts)}.", action

    if tool_name == "set_color_count":
        count = tool_input["count"]
        return f"Color count target set to {count}.", {"type": "set_color_count", "value": count}

    if tool_name == "toggle_setting":
        setting = tool_input["setting"]
        enabled = tool_input["enabled"]
        return (
            f"{'Enabled' if enabled else 'Disabled'} {setting}.",
            {"type": "toggle_setting", "setting": setting, "value": enabled},
        )

    if tool_name == "set_contrast":
        level = tool_input["level"]
        return f"Contrast set to {level}.", {"type": "set_contrast", "value": level}

    if tool_name == "generate_stitch_preview":
        return "Stitch preview generation triggered.", {"type": "generate_preview"}

    if tool_name == "undo_last_edit":
        return "Undo applied.", {"type": "undo"}

    if tool_name == "redo_last_edit":
        return "Redo applied.", {"type": "redo"}

    if tool_name == "reset_preview_edits":
        return "Preview edits reset.", {"type": "reset_preview"}

    if tool_name == "remove_color":
        code = tool_input["dmc_code"]
        return f"Removed DMC {code}.", {"type": "remove_color", "value": code}

    if tool_name == "restore_color":
        code = tool_input["dmc_code"]
        return f"Restored DMC {code}.", {"type": "restore_color", "value": code}

    if tool_name == "merge_colors":
        from_codes = tool_input["from_codes"]
        to_code = tool_input["to_code"]
        return (
            f"Merged {', '.join(from_codes)} into {to_code}.",
            {"type": "merge_colors", "from_codes": from_codes, "to_code": to_code},
        )

    if tool_name == "swap_color":
        from_code = tool_input["from_code"]
        to_code = tool_input["to_code"]
        return (
            f"Swapped {from_code} to {to_code}.",
            {"type": "swap_color", "from_codes": [from_code], "to_code": to_code},
        )

    if tool_name == "fill_selection":
        color_code = tool_input["color_code"]
        return (
            f"Filling selection with DMC {color_code}.",
            {"type": "fill_selection", "value": color_code},
        )

    if tool_name == "clear_selection":
        return "Clearing selection.", {"type": "clear_selection"}

    if tool_name == "paint_border":
        color_code = tool_input["color_code"]
        return (
            f"Painting border with DMC {color_code}.",
            {"type": "paint_border", "value": color_code},
        )

    if tool_name == "clear_background":
        color_code = tool_input["color_code"]
        replacement_code = tool_input.get("replacement_code")
        return (
            f"Clearing background color DMC {color_code}.",
            {"type": "clear_background", "value": color_code, "to_code": replacement_code or ""},
        )

    if tool_name == "set_removal_mode":
        mode = tool_input["mode"]
        return f"Removal mode set to {mode}.", {"type": "set_removal_mode", "value": mode}

    if tool_name == "draw_shape":
        shape = tool_input["shape"]
        return (
            f"Drawing {shape} from ({tool_input['r1']},{tool_input['c1']}) to ({tool_input['r2']},{tool_input['c2']}).",
            {"type": "draw_shape", **tool_input},
        )

    if tool_name == "add_text":
        return (
            f"Adding text '{tool_input['text']}' at ({tool_input['row']},{tool_input['col']}).",
            {"type": "add_text", **tool_input},
        )

    if tool_name == "flood_fill":
        return (
            f"Flood filling at ({tool_input['row']},{tool_input['col']}) with DMC {tool_input['color']}.",
            {"type": "flood_fill", **tool_input},
        )

    if tool_name == "generate_source_image":
        prompt = tool_input["prompt"]
        client = _get_openai()
        if client is None:
            return "Image generation is not configured (OPENAI_API_KEY missing).", None
        try:
            import base64
            from uuid import uuid4
            gen_response = client.images.generate(
                model="gpt-image-1",
                prompt=(
                    f"Flat illustration style with clear, distinct colors — optimized for needlepoint conversion: {prompt}"
                ),
                size="1024x1024",
                quality="auto",
                n=1,
            )
            img_b64 = gen_response.data[0].b64_json
            raw_bytes = base64.b64decode(img_b64) if img_b64 else None
            if raw_bytes is None:
                raw_bytes = urlopen(Request(gen_response.data[0].url, headers={"User-Agent": "MNS/1.0"})).read()
            out_path = UPLOADS_DIR / f"{uuid4().hex}.png"
            out_path.write_bytes(raw_bytes)
            local_path = f"/assets/uploads/{out_path.name}"
            return (
                f"Generated image for '{prompt}'.",
                {"type": "set_source_image", "url": local_path},
            )
        except Exception as exc:
            logger.exception("Image generation failed: %s", exc)
            return f"Image generation failed: {exc}", None

    if tool_name == "edit_source_image":
        prompt = tool_input["prompt"]
        source_url = context.get("source_image_url")
        if not source_url:
            return "No source image is loaded to edit.", None
        client = _get_openai()
        if client is None:
            return "Image editing is not configured (OPENAI_API_KEY missing).", None
        try:
            png_bytes = _load_source_image_bytes(source_url)
            response = client.images.edit(
                model="gpt-image-1",
                image=("source.png", io.BytesIO(png_bytes), "image/png"),
                prompt=prompt,
                size="1024x1024",
            )
            img_b64 = response.data[0].b64_json
            raw_bytes = __import__("base64").b64decode(img_b64) if img_b64 else None
            if raw_bytes is None:
                raw_bytes = urlopen(Request(response.data[0].url, headers={"User-Agent": "MNS/1.0"})).read()
            from uuid import uuid4
            out_path = UPLOADS_DIR / f"{uuid4().hex}.png"
            out_path.write_bytes(raw_bytes)
            local_url = f"/assets/uploads/{out_path.name}"
            return (
                f"Edited image applied.",
                {"type": "set_source_image", "url": local_url},
            )
        except Exception as exc:
            logger.exception("Image edit failed: %s", exc)
            return f"Image edit failed: {exc}", None

    return f"Unknown tool: {tool_name}", None


def chat_with_claude(message: str, context: dict, history: list[dict] | None = None) -> dict:
    """Run an agentic Claude conversation with canvas tool use. Returns {reply, actions, image_url}."""
    client = _get_anthropic()
    if client is None:
        return {"reply": "AI assistant is not configured (ANTHROPIC_API_KEY missing).", "actions": [], "image_url": None}

    system = _build_system_prompt(context)

    preview_url = context.get("preview_image_url")
    source_url = context.get("source_image_url")
    preview_b64 = _load_preview_image_b64(preview_url) if preview_url else None
    source_b64 = _load_preview_image_b64(source_url) if source_url else None

    if preview_b64 or source_b64:
        user_content: list[dict] = []
        if source_b64:
            user_content += [
                {"type": "text", "text": "Source image (original):"},
                {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": source_b64}},
            ]
        if preview_b64:
            user_content += [
                {"type": "text", "text": "Current stitch preview:"},
                {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": preview_b64}},
            ]
        user_content.append({"type": "text", "text": message})
    else:
        user_content = message

    messages = [*(history or []), {"role": "user", "content": user_content}]
    actions: list[dict] = []
    image_url: str | None = None
    max_iterations = 8

    for _ in range(max_iterations):
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            system=system,
            tools=TOOLS,
            messages=messages,
        )

        if response.stop_reason == "end_turn":
            reply = ""
            for block in response.content:
                if hasattr(block, "text"):
                    reply = block.text
                    break
            return {"reply": reply, "actions": actions, "image_url": image_url}

        if response.stop_reason == "tool_use":
            tool_results = []
            for block in response.content:
                if block.type == "tool_use":
                    result_text, action = _process_tool_call(block.name, block.input, context)
                    if action:
                        if action.get("type") == "set_source_image":
                            image_url = action.get("url")
                        actions.append(action)
                    tool_results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": result_text,
                        }
                    )
            messages.append({"role": "assistant", "content": response.content})
            messages.append({"role": "user", "content": tool_results})
            continue

        break

    return {"reply": "I wasn't able to complete that request.", "actions": actions, "image_url": image_url}


def get_suggestions(context: dict) -> list[str]:
    """Generate contextual prompt suggestions using Claude Haiku."""
    has_image = context.get("has_source_image", False)
    has_preview = context.get("has_preview", False)
    palette_count = len(context.get("palette", []))

    if has_preview:
        state_desc = f"stitch preview is ready with {palette_count} colors"
    elif has_image:
        state_desc = "source image is loaded but no preview generated yet"
    else:
        state_desc = "no image loaded yet"

    system = f"""You generate exactly 4 short, actionable prompt suggestions for a needlepoint design app user.
Current state: {state_desc}. Source mode: {context.get('source_mode', 'photo')}. Size: {context.get('width_inches', 5)}" x {context.get('height_inches', 5)}" at {context.get('mesh_count', 18)} mesh.

Rules:
- Each suggestion is 4–9 words
- Make them specific and useful for the current state
- Vary them: one action, one question, one setting tip, one creative idea
- Return a JSON array of exactly 4 strings. Nothing else."""

    haiku_client = _get_anthropic()
    try:
        if haiku_client is None:
            raise ValueError("no client")
        response = haiku_client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=150,
            system=system,
            messages=[{"role": "user", "content": "Generate suggestions."}],
        )
        text = response.content[0].text.strip()
        parsed = json.loads(text)
        if isinstance(parsed, list) and parsed:
            return [str(s) for s in parsed[:4]]
    except Exception as exc:
        logger.warning("Suggestions generation failed: %s", exc)

    if has_preview:
        return [
            f"Reduce to {max(8, palette_count // 2)} colors",
            "Which colors are most prominent?",
            "Try strengthening dark detail",
            "Generate a new image from scratch",
        ]
    if has_image:
        return [
            "Generate the stitch preview",
            "What source mode should I use?",
            "Set width to 8 inches",
            "Switch to 13 mesh",
        ]
    return [
        "Generate a floral wreath design",
        "Upload my own photo",
        "What's the difference between mesh sizes?",
        "Create a monogram letter pattern",
    ]
