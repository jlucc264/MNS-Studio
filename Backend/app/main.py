import json
import logging
import os
import re
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
SEARCH_RESULT_LIMIT = 12
GOOGLE_CUSTOM_SEARCH_API_KEY = os.getenv("GOOGLE_CUSTOM_SEARCH_API_KEY", "").strip()
GOOGLE_CUSTOM_SEARCH_ENGINE_ID = os.getenv("GOOGLE_CUSTOM_SEARCH_ENGINE_ID", "").strip()


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


def normalize_search_query(query: str) -> str:
    cleaned = query.strip()
    cleaned = re.sub(
        r"\b(photo|image|picture|pic|needlepoint-worthy|needlepoint worthy|web)\b",
        " ",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned or query.strip()


def normalize_text_for_match(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def score_candidate(query: str, candidate: dict, provider_index: int) -> tuple[float, str]:
    normalized_query = normalize_text_for_match(query)
    query_tokens = [token for token in normalized_query.split() if token]
    title = normalize_text_for_match(candidate.get("title"))

    title_tokens = set(title.split()) if title else set()
    overlap = sum(1 for token in query_tokens if token in title_tokens)
    exact_bonus = 3 if title and normalized_query and normalized_query in title else 0
    startswith_bonus = 1.5 if title and normalized_query and title.startswith(normalized_query) else 0
    thumbnail_bonus = 0.25 if "thumb" in (candidate.get("url") or "").lower() else 0
    provider_bonus = max(0.0, 0.5 - (provider_index * 0.1))
    title_penalty = 0.0 if title else -0.75

    score = overlap + exact_bonus + startswith_bonus + thumbnail_bonus + provider_bonus + title_penalty
    return score, candidate.get("id") or candidate.get("url") or ""


def merge_search_candidates(query: str, provider_results: list[list[dict]]) -> list[dict]:
    merged: list[tuple[float, str, dict]] = []
    seen_urls: set[str] = set()

    for provider_index, candidates in enumerate(provider_results):
        for candidate in candidates:
            image_url = candidate.get("url")
            if not image_url or image_url in seen_urls:
                continue

            seen_urls.add(image_url)
            score, stable_key = score_candidate(query, candidate, provider_index)
            merged.append((score, stable_key, candidate))

    merged.sort(key=lambda item: (-item[0], item[1]))
    return [candidate for _, _, candidate in merged[:SEARCH_RESULT_LIMIT]]


def build_chat_help_message(topic: str | None = None) -> str:
    normalized = normalize_text_for_match(topic)

    if any(word in normalized for word in ["search", "find", "import", "upload", "url"]):
        return "\n".join(
            [
                "You can search or import images with commands like:",
                '- `find a photo of a cardinal`',
                '- `search the web for a christmas needlepoint sign`',
                '- `import https://...`',
                "- or upload an image directly in chat.",
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
                "- If text or logos are still breaking badly, the image may want more graphic/text-art handling instead of more contrast.",
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
                '- `use stitched photo` / `use photo`',
            ]
        )

    return "\n".join(
        [
            "I can help with search, import, settings, cleanup, and guidance.",
            "Try commands like:",
            '- `find a photo of a cardinal`',
            '- `use stitched photo`',
            '- `set width to 7`',
            '- `generate preview`',
            '- `merge 907 and 3052 into 907`',
            '- `analyze palette`',
            '- `help source modes` or `help editing`',
        ]
    )


def search_openverse_images(query: str) -> list[dict]:
    api_url = (
        "https://api.openverse.org/v1/images/"
        f"?q={quote_plus(query)}&page_size={SEARCH_RESULT_LIMIT}&mature=false"
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
                "provider": "Openverse",
            }
        )

    return candidates


def search_google_custom_images(query: str) -> list[dict]:
    if not GOOGLE_CUSTOM_SEARCH_API_KEY or not GOOGLE_CUSTOM_SEARCH_ENGINE_ID:
        return []

    api_url = (
        "https://customsearch.googleapis.com/customsearch/v1"
        f"?key={quote_plus(GOOGLE_CUSTOM_SEARCH_API_KEY)}"
        f"&cx={quote_plus(GOOGLE_CUSTOM_SEARCH_ENGINE_ID)}"
        f"&q={quote_plus(query)}"
        "&searchType=image"
        f"&num={SEARCH_RESULT_LIMIT}"
        "&safe=active"
    )
    data = fetch_json(api_url)
    items = data.get("items", [])
    candidates = []

    for item in items:
        image_url = item.get("image", {}).get("thumbnailLink") or item.get("link")
        if not image_url:
            continue

        candidates.append(
            {
                "id": item.get("cacheId") or item.get("link") or image_url,
                "url": image_url,
                "title": item.get("title") or item.get("displayLink") or "Google image result",
                "provider": "Google",
            }
        )

    return candidates


def search_wikimedia_images(query: str) -> list[dict]:
    api_url = (
        "https://commons.wikimedia.org/w/api.php"
        f"?action=query&generator=search&gsrsearch={quote_plus(query)}"
        f"&gsrnamespace=6&gsrlimit={SEARCH_RESULT_LIMIT}"
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
                "provider": "Wikimedia Commons",
            }
        )

    return candidates


@app.get("/search-images")
def search_images(query: str):
    if not query.strip():
        raise HTTPException(status_code=400, detail="Search query is required.")

    normalized_query = normalize_search_query(query)
    search_providers = [
        search_google_custom_images,
        search_openverse_images,
        search_wikimedia_images,
    ]
    provider_errors = []
    provider_results: list[list[dict]] = []

    for provider in search_providers:
        try:
            candidates = provider(normalized_query)
        except Exception as exc:
            provider_errors.append(f"{provider.__name__}: {exc}")
            continue

        provider_results.append(candidates)

    merged_candidates = merge_search_candidates(normalized_query, provider_results)
    if merged_candidates:
        return {"candidates": merged_candidates}

    if provider_errors:
        logger.warning(
            "Image search failed for query %r. Provider errors: %s",
            normalized_query,
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

    if intent == "search":
        normalized_query = normalize_search_query(message)
        provider_errors = []
        provider_results: list[list[dict]] = []

        for provider in (search_openverse_images, search_wikimedia_images):
            try:
                provider_results.append(provider(normalized_query))
            except Exception as exc:
                provider_errors.append(f"{provider.__name__}: {exc}")

        candidates = merge_search_candidates(normalized_query, provider_results)
        if candidates:
            return AppResponse(
                action="search",
                message=f'I found {len(candidates)} image options for "{normalized_query}". Pick one to import it.',
                candidate_images=candidates,
                metadata={"query": normalized_query},
            )

        if provider_errors:
            logger.warning(
                "Chat search failed for query %r. Provider errors: %s",
                normalized_query,
                "; ".join(provider_errors),
            )
            return AppResponse(
                action="search",
                message=(
                    "Image search is unavailable right now. "
                    f"Provider details: {'; '.join(provider_errors)}"
                ),
                candidate_images=[],
                metadata={"query": normalized_query},
            )

        return AppResponse(
            action="search",
            message=f'I could not find any image results for "{normalized_query}". Try a simpler subject or import a URL directly.',
            candidate_images=[],
            metadata={"query": normalized_query},
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
        message="Brand-new image generation is intentionally not included in the base product. I can help you search, import, and clean up an image instead.",
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
