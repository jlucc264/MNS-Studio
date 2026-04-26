import json
import logging
import os
import re
from pathlib import Path
from urllib.request import Request, urlopen
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.models import (
    ChatRequest,
    ImportUrlRequest,
    VisualizeRequest,
    AppResponse,
    FinalizeRequest,
    FinalizeResponse,
    RecolorRequest,
    RecolorResponse,
)
from app.services.intent import classify_intent
from app.services.storage import save_remote_image, save_upload
from app.services.pdf_generator import generate_preview_pdf
from app.services.storage import delete_finalized_output
from app.services.stitch_visualizer import generate_stitch_preview, recolor_stitch_preview
from app.data.dmc_colors import DMC_COLORS

BASE_DIR = Path(__file__).resolve().parents[1]
ASSETS_DIR = BASE_DIR / "assets"
logger = logging.getLogger(__name__)


def parse_allowed_origins() -> list[str]:
    configured = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000")
    return [origin.strip() for origin in configured.split(",") if origin.strip()]

app = FastAPI(title="Stitch Preview MVP")

app.add_middleware(
    CORSMiddleware,
    allow_origins=parse_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/dmc-colors")
def dmc_colors():
    return {"colors": DMC_COLORS}


def fetch_json(url: str) -> dict:
    request = Request(url, headers={"User-Agent": "MNS/1.0"})
    with urlopen(request, timeout=15) as response:
        return json.loads(response.read().decode("utf-8"))


def normalize_text_for_match(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()

def build_chat_help_message(topic: str | None = None) -> str:
    normalized = normalize_text_for_match(topic)

    if any(word in normalized for word in ["import", "upload", "url"]):
        return "\n".join(
            [
                "You can bring images into the project with commands like:",
                '- `import https://...`',
                "- or upload an image directly in chat.",
                "- If you need source artwork, find it online first and then bring it into MNS Studio.",
            ]
        )

    if any(word in normalized for word in ["edit", "paint", "merge", "palette", "border"]):
        return "\n".join(
            [
                "You can use deterministic editing commands like:",
                '- `paint 310`',
                '- `turn off 310`',
                '- `turn on 310`',
                '- `merge 907 and 3052 into 907`',
                '- `make the outside border fully light blue`',
                '- `analyze palette`',
                '- `undo` / `redo`',
            ]
        )

    if any(word in normalized for word in ["source", "photo", "stitched", "mode"]):
        return "\n".join(
            [
                "Source mode guide:",
                "- `Photo` is better for normal photographs and product shots.",
                "- `Stitched photo` is better for photos of existing stitched work where fabric or canvas colors are interfering.",
                "- `Graphic / screenshot art` is better for screenshots, sign art, stitched reference graphics, and other crisp non-photo sources.",
                "- If text or logos are still breaking badly, try `Graphic / screenshot art` before pushing contrast higher.",
            ]
        )

    if any(word in normalized for word in ["setting", "size", "mesh", "contrast", "color"]):
        return "\n".join(
            [
                "You can update preview settings with commands like:",
                '- `set width to 7`',
                '- `set height to 5.5`',
                '- `use 18 mesh`',
                '- `set colors to 12`',
                '- `normal contrast` / `high contrast` / `super high contrast`',
                '- `use stitched photo` / `use photo` / `use graphic art`',
                '- `simplify colors on` / `off`',
                '- `strengthen dark detail on` / `off`',
                '- `preserve accents on` / `off`',
            ]
        )

    return "\n".join(
        [
            "I can help with import, settings, cleanup, and guidance.",
            "Try commands like:",
            '- upload an image',
            '- `import https://...`',
            '- `use stitched photo`',
            '- `use graphic art`',
            '- `simplify colors on`',
            '- `preserve accents on`',
            '- `set width to 7`',
            '- `generate preview`',
            '- `merge 907 and 3052 into 907`',
            '- `analyze palette`',
            '- `help source modes` or `help editing`',
        ]
    )


@app.post("/chat", response_model=AppResponse)
def chat(request: ChatRequest):
    message = request.message.strip()
    intent = classify_intent(message)

    if intent == "help":
        topic = None
        lowered = message.lower().strip()
        if lowered.startswith("help "):
            topic = message[5:].strip()
        elif lowered.startswith("guide "):
            topic = message[6:].strip()
        elif lowered.startswith("how do i use "):
            topic = message[13:].strip()

        return AppResponse(
            action="help",
            message=build_chat_help_message(topic),
            metadata={"topic": topic or "general"},
        )

    if intent == "import":
        return AppResponse(
            action="import",
            message="Upload an image in chat or paste an image URL with `import https://...`.",
        )

    if intent == "settings":
        return AppResponse(
            action="settings",
            message=build_chat_help_message("settings"),
        )

    if intent == "edit":
        return AppResponse(
            action="edit",
            message=build_chat_help_message("editing"),
        )

    if intent == "visualize":
        return AppResponse(
            action="visualize",
            message="Use `generate preview` after importing an image, or adjust width, height, mesh, colors, and source mode first.",
        )

    if intent == "finalize":
        return AppResponse(
            action="finalize",
            message="When the preview looks right, use Finalize to create the printable PDF export.",
        )

    return AppResponse(
        action="generate",
        message="Brand-new image generation is intentionally not included in the base product. I can help you import an image, adjust settings, and clean up the preview instead.",
    )


@app.post("/upload")
def upload(file: UploadFile = File(...)):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Uploaded file must be an image.")

    image_url = save_upload(file)
    return {
        "message": "Image uploaded successfully.",
        "active_image_url": image_url,
        "source": "uploaded",
    }


@app.post("/import-url")
def import_url(request: ImportUrlRequest):
    try:
        image_url = save_remote_image(request.image_url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Unable to import image from URL.") from exc

    return {
        "message": "Image imported successfully.",
        "active_image_url": image_url,
        "source": "remote_url",
    }

@app.post("/visualize")
def visualize(request: VisualizeRequest):
    if request.stitch_width <= 0 or request.stitch_height <= 0:
        raise HTTPException(status_code=400, detail="Stitch dimensions must be positive.")

    preview_url, palette, cells = generate_stitch_preview(
    image_url=request.image_url,
    stitch_width=request.stitch_width,
    stitch_height=request.stitch_height,
    color_count=request.color_count,
    show_grid=request.show_grid,
    clean_background=request.clean_background,
    simplify_colors=request.simplify_colors,
    strengthen_dark_detail=request.strengthen_dark_detail,
    preserve_accents=request.preserve_accents,
    mesh_count=request.mesh_count,
    contrast_level=request.contrast_level,
    source_type=request.source_type,
)

    return {
    "message": "Preview generated successfully.",
    "stitch_preview_url": preview_url,
    "palette": palette,
    "settings": request.model_dump(),
    "cells": cells,
}

@app.post("/finalize", response_model=FinalizeResponse)
def finalize(request: FinalizeRequest):
    delete_finalized_output(request.previous_pdf_url)
    pdf_url = generate_preview_pdf(
        preview_url=request.preview_url,
        width_inches=request.width_inches,
        height_inches=request.height_inches,
        mesh_count=request.mesh_count,
        color_count=request.color_count,
        contrast_level=request.contrast_level,
        show_grid=request.show_grid,
        palette=[color.model_dump() for color in request.palette],
        cells=request.cells,
    )

    return FinalizeResponse(
        message="Final PDF created successfully.",
        pdf_url=pdf_url,
    )

@app.post("/recolor", response_model=RecolorResponse)
def recolor(request: RecolorRequest):
    if request.stitch_width <= 0 or request.stitch_height <= 0:
        raise HTTPException(status_code=400, detail="Stitch dimensions must be positive.")

    if len(request.selected_palette) < 1:
        raise HTTPException(status_code=400, detail="At least one color must be selected.")

    preview_url, palette, cells = recolor_stitch_preview(
        image_url=request.image_url,
        stitch_width=request.stitch_width,
        stitch_height=request.stitch_height,
        mesh_count=request.mesh_count,
        show_grid=request.show_grid,
        selected_palette=[color.model_dump() for color in request.selected_palette],
    )

    return RecolorResponse(
        message="Preview recolored successfully.",
        stitch_preview_url=preview_url,
        palette=[p for p in palette],
        cells=cells,
    )
