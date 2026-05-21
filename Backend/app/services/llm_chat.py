import io
import json
import logging
import os
from pathlib import Path
from urllib.request import Request, urlopen

from app.services.storage import save_remote_image, UPLOADS_DIR

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

    return f"""You are a friendly, expert assistant for MNS Studio, a web app for creating needlepoint and cross-stitch patterns from images.

Current canvas state:
- Source mode: {source_mode} ({mode_hint})
- Design size: {context.get('width_inches', 5.0)}" × {context.get('height_inches', 5.0)}" at {context.get('mesh_count', 18)} mesh
- Has source image loaded: {context.get('has_source_image', False)}
- Has stitch preview: {context.get('has_preview', False)}
- Processing: clean_background={context.get('clean_background', False)}, simplify_colors={context.get('simplify_colors', False)}, strengthen_dark_detail={context.get('strengthen_dark_detail', False)}, preserve_accents={context.get('preserve_accents', False)}, contrast={context.get('contrast_level', 'normal')}{palette_lines}

You help users by:
1. Adjusting canvas settings and generating stitch previews
2. Editing the palette (remove, restore, merge colors)
3. Generating AI source images from text descriptions
4. Answering questions about needlepoint and cross-stitch design

Keep responses concise and natural. When making multiple changes, chain tool calls together and summarize what you did in one sentence. If a setting change should be followed by regenerating the preview, call generate_stitch_preview after the setting change.

Image generation rule: before calling generate_source_image or edit_source_image, check the canvas state. If width_inches=5.0, height_inches=5.0, and mesh_count=18 (all defaults), ask the user to confirm or set their desired size and mesh count first — the image will be generated at exactly those stitch dimensions. If the user has already customized any of these values, proceed without asking.

Needlepoint design tips to share when relevant:
- 13 mesh = larger stitches, good for bold designs; 18 mesh = finer detail, more colors visible
- graphic_art mode works best for logos, text, and anything with crisp edges
- Simplify colors helps when the image has too much noise; strengthen_dark_detail preserves outlines"""



def _load_source_image_bytes(source_image_url: str) -> bytes:
    """Return PNG bytes for the source image, reading from disk or fetching by URL."""
    # Local asset paths like /assets/uploads/foo.png
    for prefix, base_dir in [("/assets/uploads/", UPLOADS_DIR), ("/assets/previews/", PREVIEWS_DIR)]:
        if source_image_url.startswith(prefix):
            local = base_dir / source_image_url[len(prefix):]
            if local.exists():
                img = Image.open(local).convert("RGBA")
                buf = io.BytesIO()
                img.save(buf, format="PNG")
                return buf.getvalue()

    # Full URL — fetch it
    req = Request(source_image_url, headers={"User-Agent": "MNS/1.0"})
    with urlopen(req, timeout=15) as resp:
        raw = resp.read()
    img = Image.open(io.BytesIO(raw)).convert("RGBA")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


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

    if tool_name == "set_removal_mode":
        mode = tool_input["mode"]
        return f"Removal mode set to {mode}.", {"type": "set_removal_mode", "value": mode}

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


def chat_with_claude(message: str, context: dict) -> dict:
    """Run an agentic Claude conversation with canvas tool use. Returns {reply, actions, image_url}."""
    client = _get_anthropic()
    if client is None:
        return {"reply": "AI assistant is not configured (ANTHROPIC_API_KEY missing).", "actions": [], "image_url": None}

    system = _build_system_prompt(context)
    messages = [{"role": "user", "content": message}]
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
