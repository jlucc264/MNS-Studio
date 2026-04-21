import json
import logging
import os
from pathlib import Path
from urllib.parse import quote_plus
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


def search_openverse_images(query: str) -> list[dict]:
    api_url = (
        "https://api.openverse.org/v1/images/"
        f"?q={quote_plus(query)}&page_size=12&mature=false"
    )
    data = fetch_json(api_url)
    results = data.get("results", [])
    candidates = []

    for item in results:
        image_url = item.get("thumbnail") or item.get("url")
        if not image_url:
            continue

        title = item.get("title") or item.get("creator") or "Openverse image"
        candidates.append(
            {
                "id": str(item.get("id", image_url)),
                "url": image_url,
                "title": title,
            }
        )

    return candidates


def search_wikimedia_images(query: str) -> list[dict]:
    api_url = (
        "https://commons.wikimedia.org/w/api.php"
        f"?action=query&generator=search&gsrsearch={quote_plus(query)}"
        "&gsrnamespace=6&gsrlimit=12"
        "&prop=imageinfo&iiprop=url&iiurlwidth=800"
        "&format=json&formatversion=2"
    )
    data = fetch_json(api_url)
    pages = data.get("query", {}).get("pages", [])
    candidates = []

    for page in pages:
        imageinfo = (page.get("imageinfo") or [{}])[0]
        image_url = imageinfo.get("thumburl") or imageinfo.get("url")
        if not image_url:
            continue

        title = page.get("title", "").removeprefix("File:")
        candidates.append(
            {
                "id": str(page.get("pageid", title)),
                "url": image_url,
                "title": title or None,
            }
        )

    return candidates


@app.get("/search-images")
def search_images(query: str):
    if not query.strip():
        raise HTTPException(status_code=400, detail="Search query is required.")

    search_providers = [search_openverse_images, search_wikimedia_images]
    provider_errors = []

    for provider in search_providers:
        try:
            candidates = provider(query.strip())
        except Exception as exc:
            provider_errors.append(f"{provider.__name__}: {exc}")
            continue

        if candidates:
            return {"candidates": candidates}

    if provider_errors:
        logger.warning(
            "Image search failed for query %r. Provider errors: %s",
            query,
            "; ".join(provider_errors),
        )
        raise HTTPException(
            status_code=502,
            detail=(
                "Image search is unavailable right now. "
                f"Provider details: {'; '.join(provider_errors)}"
            ),
        )

    return {"candidates": []}


@app.post("/chat", response_model=AppResponse)
def chat(request: ChatRequest):
    intent = classify_intent(request.message)

    if intent == "search":
        return AppResponse(
            action="search",
            message="Search is stubbed for now. Next step is wiring a real image API.",
            candidate_images=[],
            metadata={"query": request.message},
        )

    if intent == "visualize":
        return AppResponse(
            action="visualize",
            message="Use the preview controls after selecting or uploading an image.",
        )

    return AppResponse(
        action="generate",
        message="Generation is stubbed for now. Upload an image to test the stitch preview flow.",
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
