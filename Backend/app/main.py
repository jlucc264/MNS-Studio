import json
import logging
import mimetypes
import os
import re
from pathlib import Path
from urllib.request import Request, urlopen
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
from fastapi import Depends, FastAPI, Header, HTTPException, Request, UploadFile, File
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
    ProjectSaveRequest,
    ProjectResponse,
    GalleryCreateRequest,
    GalleryItemResponse,
    PrintOwnCheckoutRequest,
    CheckoutResponse,
)
from app.services.intent import classify_intent
from app.services.storage import save_remote_image, save_upload
from app.services.pdf_generator import generate_preview_pdf
from app.services.storage import delete_finalized_output
from app.services.email_delivery import send_finalized_report, send_order_notification
from app.services.stripe_service import (
    create_print_own_checkout,
    create_template_checkout,
    create_gallery_print_checkout,
)
from app.services.canvas_pricing import get_canvas_for_design
from app.services.auth import get_current_user_id, get_optional_user_id
from app.services.supabase_storage import upload_file_to_supabase, upload_pdf_to_supabase, upload_png_to_supabase
from app.services.supabase_db import (
    list_projects,
    create_project,
    update_project,
    delete_project,
    list_gallery_items,
    create_gallery_item,
    toggle_gallery_like,
)
from app.services.stitch_visualizer import generate_stitch_preview, recolor_stitch_preview, compute_content_bounds
from app.data.dmc_colors import DMC_COLORS

BASE_DIR = Path(__file__).resolve().parents[1]
ASSETS_DIR = BASE_DIR / "assets"
logger = logging.getLogger(__name__)


def parse_allowed_origins() -> list[str]:
    configured = os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    )
    origins = [origin.strip() for origin in configured.split(",") if origin.strip()]
    # allow common local dev hostnames so port/host changes don't break CORS
    for port in range(3000, 3010):
        for host in ("localhost", "127.0.0.1", "0.0.0.0"):
            origin = f"http://{host}:{port}"
            if origin not in origins:
                origins.append(origin)
    return origins


LOCAL_DEV_ORIGIN_REGEX = (
    r"^https?://("
    r"localhost|127\.0\.0\.1|0\.0\.0\.0|"
    r"192\.168\.\d{1,3}\.\d{1,3}|"
    r"10\.\d{1,3}\.\d{1,3}\.\d{1,3}|"
    r"172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}"
    r")(:\d+)?$"
)

app = FastAPI(title="Stitch Preview MVP")

app.add_middleware(
    CORSMiddleware,
    allow_origins=parse_allowed_origins(),
    allow_origin_regex=LOCAL_DEV_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")


@app.get("/health")
def health():
    return {"status": "ok"}


def local_asset_path(asset_url: str | None) -> Path | None:
    if not asset_url or not asset_url.startswith("/assets/"):
        return None

    candidate = (BASE_DIR / asset_url.lstrip("/")).resolve()
    try:
        candidate.relative_to(ASSETS_DIR.resolve())
    except ValueError:
        return None

    return candidate if candidate.exists() else None


def durable_preview_url(preview_url: str, prefix: str = "previews") -> str:
    preview_path = local_asset_path(preview_url)
    if preview_path is None:
        return preview_url

    supabase_preview_url = upload_png_to_supabase(preview_path, prefix=prefix)
    return supabase_preview_url or preview_url


def durable_image_url(image_url: str, prefix: str = "source-images") -> str:
    image_path = local_asset_path(image_url)
    if image_path is None:
        return image_url

    content_type = mimetypes.guess_type(image_path.name)[0] or "application/octet-stream"
    supabase_image_url = upload_file_to_supabase(
        image_path,
        prefix=prefix,
        content_type=content_type,
    )
    return supabase_image_url or image_url


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

    image_url = durable_image_url(save_upload(file), prefix="source-images")
    return {
        "message": "Image uploaded successfully.",
        "active_image_url": image_url,
        "source": "uploaded",
    }


@app.post("/import-url")
def import_url(request: ImportUrlRequest):
    try:
        image_url = durable_image_url(save_remote_image(request.image_url), prefix="source-images")
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
    preview_url = durable_preview_url(preview_url, prefix="draft-previews")

    width_inches = request.stitch_width / request.mesh_count
    height_inches = request.stitch_height / request.mesh_count
    content_bounds = compute_content_bounds(cells, width_inches, height_inches)

    return {
        "message": "Preview generated successfully.",
        "stitch_preview_url": preview_url,
        "palette": palette,
        "settings": request.model_dump(),
        "cells": cells,
        "content_bounds": content_bounds,
    }

@app.post("/finalize", response_model=FinalizeResponse)
def finalize(request: FinalizeRequest):
    delete_finalized_output(request.previous_pdf_url)
    pdf_url, public_pdf_path, internal_pdf_path, preview_image_url, preview_image_path = generate_preview_pdf(
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
    supabase_pdf_url = upload_pdf_to_supabase(public_pdf_path, prefix="public-finalized")
    if supabase_pdf_url:
        pdf_url = supabase_pdf_url

    supabase_preview_url = upload_png_to_supabase(preview_image_path, prefix="public-previews")
    if supabase_preview_url:
        preview_image_url = supabase_preview_url

    upload_pdf_to_supabase(
        internal_pdf_path,
        prefix="internal-finalized",
        bucket_env="SUPABASE_INTERNAL_STORAGE_BUCKET",
        return_public_url=False,
    )
    send_finalized_report(internal_pdf_path)

    return FinalizeResponse(
        message="Final PDF report created successfully.",
        pdf_url=pdf_url,
        preview_image_url=preview_image_url,
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
    preview_url = durable_preview_url(preview_url, prefix="draft-previews")

    return RecolorResponse(
        message="Preview recolored successfully.",
        stitch_preview_url=preview_url,
        palette=[p for p in palette],
        cells=cells,
    )


# ── Projects ──────────────────────────────────────────────────────────────────

@app.get("/projects", response_model=list[ProjectResponse])
def get_projects(user_id: str = Depends(get_current_user_id)):
    return list_projects(user_id)


@app.get("/projects/{project_id}", response_model=ProjectResponse)
def get_project(project_id: str, user_id: str = Depends(get_current_user_id)):
    from app.services.supabase_db import get_project as db_get_project
    result = db_get_project(project_id, user_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    return result


MAX_DRAFTS = 3

def is_active_draft(project: dict) -> bool:
    return not bool(project.get("finalized") or project.get("pdf_url"))

@app.post("/projects", response_model=ProjectResponse, status_code=201)
def save_project(request: ProjectSaveRequest, user_id: str = Depends(get_current_user_id)):
    active_drafts = [project for project in list_projects(user_id) if is_active_draft(project)]
    if len(active_drafts) >= MAX_DRAFTS:
        raise HTTPException(
            status_code=422,
            detail=f"Draft limit reached ({MAX_DRAFTS}). Delete a saved design before saving a new one."
        )
    data = request.model_dump(exclude_none=True)
    if "palette" in data and data["palette"] is not None:
        data["palette"] = [c if isinstance(c, dict) else c.model_dump() for c in (request.palette or [])]
    result = create_project(data, user_id)
    if result is None:
        raise HTTPException(status_code=502, detail="Could not save project to database.")
    return result


@app.patch("/projects/{project_id}", response_model=ProjectResponse)
def patch_project(project_id: str, request: ProjectSaveRequest, user_id: str = Depends(get_current_user_id)):
    data = request.model_dump(exclude_none=True)
    if "palette" in data and data["palette"] is not None:
        data["palette"] = [c if isinstance(c, dict) else c.model_dump() for c in (request.palette or [])]
    result = update_project(project_id, data, user_id)
    if result is None:
        raise HTTPException(status_code=502, detail="Could not update project.")
    return result


@app.delete("/projects/{project_id}", status_code=204)
def remove_project(project_id: str, user_id: str = Depends(get_current_user_id)):
    ok = delete_project(project_id, user_id)
    if not ok:
        raise HTTPException(status_code=502, detail="Could not delete project.")


# ── Gallery ───────────────────────────────────────────────────────────────────

@app.get("/gallery", response_model=list[GalleryItemResponse])
def get_gallery(search: str = "", sort: str = "recent", user_id: str | None = Depends(get_optional_user_id)):
    if sort not in {"recent", "popular"}:
        raise HTTPException(status_code=400, detail="Sort must be recent or popular.")
    return list_gallery_items(search=search, sort=sort, user_id=user_id)


@app.post("/gallery", response_model=GalleryItemResponse, status_code=201)
def publish_gallery_item(request: GalleryCreateRequest, user_id: str = Depends(get_current_user_id)):
    title = request.title.strip()
    if not title:
        raise HTTPException(status_code=422, detail="Gallery title is required.")

    tags = []
    seen_tags = set()
    for tag in request.tags:
        normalized = tag.strip().lower().replace("#", "")
        if not normalized or normalized in seen_tags:
            continue
        seen_tags.add(normalized)
        tags.append(normalized[:32])

    data = request.model_dump(exclude_none=True)
    data["title"] = title
    data["tags"] = tags[:8]
    if "submitter_name" in data:
        data["submitter_name"] = data["submitter_name"].strip()[:80] or None
    result = create_gallery_item(data, user_id)
    if result is None:
        raise HTTPException(status_code=502, detail="Could not publish to gallery.")
    return result


@app.post("/gallery/{item_id}/like", response_model=GalleryItemResponse)
def like_gallery_item(item_id: str, user_id: str = Depends(get_current_user_id)):
    result = toggle_gallery_like(item_id, user_id)
    if result is None:
        raise HTTPException(status_code=502, detail="Could not update gallery like.")
    return result


# ── Checkout ──────────────────────────────────────────────────────────────────

@app.post("/checkout/print-own", response_model=CheckoutResponse)
def checkout_print_own(request: PrintOwnCheckoutRequest, user_id: str = Depends(get_current_user_id)):
    canvas = get_canvas_for_design(request.width_inches, request.height_inches)
    if not canvas:
        raise HTTPException(status_code=422, detail="Design exceeds the largest available canvas (8×12).")
    try:
        url = create_print_own_checkout(
            pdf_url=request.pdf_url,
            width_inches=request.width_inches,
            height_inches=request.height_inches,
            user_id=user_id,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return CheckoutResponse(checkout_url=url)


@app.post("/checkout/template/{item_id}", response_model=CheckoutResponse)
def checkout_template(item_id: str):
    from app.services.supabase_db import get_gallery_item
    item = get_gallery_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Gallery item not found.")
    try:
        url = create_template_checkout(
            gallery_item_id=item_id,
            gallery_item_title=item.get("title", "Untitled"),
            creator_user_id=item.get("user_id", ""),
            pdf_url=item.get("pdf_url", ""),
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return CheckoutResponse(checkout_url=url)


@app.post("/checkout/print-gallery/{item_id}", response_model=CheckoutResponse)
def checkout_print_gallery(item_id: str):
    from app.services.supabase_db import get_gallery_item
    item = get_gallery_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Gallery item not found.")
    width = item.get("width_inches")
    height = item.get("height_inches")
    if not width or not height:
        raise HTTPException(status_code=422, detail="This design does not have dimension data for printing.")
    canvas = get_canvas_for_design(width, height)
    if not canvas:
        raise HTTPException(status_code=422, detail="Design exceeds the largest available canvas (8×12).")
    try:
        url = create_gallery_print_checkout(
            gallery_item_id=item_id,
            gallery_item_title=item.get("title", "Untitled"),
            creator_user_id=item.get("user_id", ""),
            pdf_url=item.get("pdf_url", ""),
            width_inches=width,
            height_inches=height,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return CheckoutResponse(checkout_url=url)


# ── Stripe webhook ────────────────────────────────────────────────────────────

def _record_creator_earnings(session_id: str, creator_user_id: str, gallery_item_id: str, order_type: str) -> None:
    from app.services.supabase_db import _request
    _request("POST", "/creator_earnings", body={
        "stripe_session_id": session_id,
        "creator_user_id": creator_user_id,
        "gallery_item_id": gallery_item_id,
        "order_type": order_type,
        "amount_cents": 450,
        "paid_out": False,
    })


def _handle_completed_session(session: dict) -> None:
    metadata = session.get("metadata") or {}
    order_type = metadata.get("type", "")
    customer_details = session.get("customer_details") or {}
    customer_email = customer_details.get("email")
    shipping = session.get("shipping_details")

    try:
        send_order_notification(order_type, metadata, customer_email, shipping)
    except Exception:
        logger.exception("Order notification email failed for session %s", session.get("id"))

    if order_type in {"template", "print_gallery"}:
        creator_user_id = metadata.get("creator_user_id", "")
        gallery_item_id = metadata.get("gallery_item_id", "")
        if creator_user_id and gallery_item_id:
            try:
                _record_creator_earnings(session["id"], creator_user_id, gallery_item_id, order_type)
            except Exception:
                logger.exception("Failed to record creator earnings for session %s", session.get("id"))


@app.post("/stripe/webhook")
async def stripe_webhook(
    request: Request,
    stripe_signature: str = Header(None, alias="stripe-signature"),
):
    import stripe as stripe_lib
    payload = await request.body()
    webhook_secret = os.getenv("STRIPE_WEBHOOK_SECRET", "")
    try:
        event = stripe_lib.Webhook.construct_event(payload, stripe_signature, webhook_secret)
    except (ValueError, stripe_lib.error.SignatureVerificationError):
        raise HTTPException(status_code=400, detail="Invalid webhook signature.")
    if event["type"] == "checkout.session.completed":
        _handle_completed_session(event["data"]["object"])
    return {"received": True}
