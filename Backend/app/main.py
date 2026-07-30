import json
import logging
import mimetypes
import os
import threading
from pathlib import Path
from urllib.request import Request, urlopen
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
from fastapi import Depends, FastAPI, Form, Header, HTTPException, Request, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.models import (
    ContactRequest,
    ImportUrlRequest,
    RollPrintRequest,
    ReplayCheckoutSessionRequest,
    LlmChatRequest,
    LlmChatResponse,
    SuggestionsRequest,
    SuggestionsResponse,
    VisualizeRequest,
    AppResponse,
    FinalizeRequest,
    FinalizeResponse,
    RecolorRequest,
    RecolorResponse,
    GridRenderRequest,
    GridRenderResponse,
    ImportPatternRequest,
    ImportPatternResponse,
    ImportStitchlyResponse,
    NearestDmcRequest,
    SamplePixelRequest,
    PaletteColor,
    ProjectSaveRequest,
    ProjectResponse,
    GalleryCreateRequest,
    UpdateCreatorRequest,
    GalleryItemResponse,
    PrintOwnCheckoutRequest,
    CartCheckoutRequest,
    CheckoutResponse,
)
from app.services.llm_chat import chat_with_claude, get_suggestions
from app.services.storage import save_remote_image, save_upload
from app.services.pdf_generator import generate_preview_pdf, generate_calibration_pdf, generate_blank_roll_pdf, generate_registration_test_pdf, generate_roll_print_pdf, generate_alignment_test_design, load_signature_image, crop_to_content
from app.services.storage import delete_finalized_output
from app.services.email_delivery import (
    send_contact_email,
    send_customer_order_confirmation,
    send_order_notification,
)
from app.services.stripe_service import (
    create_print_own_checkout,
    create_template_checkout,
    create_gallery_print_checkout,
    create_cart_checkout,
)
from app.services.canvas_pricing import get_canvas_for_design, is_design_printable
from app.services.auth import get_current_user_id, get_optional_user_id
from app.services.supabase_storage import download_from_supabase_storage, upload_file_to_supabase, upload_pdf_to_supabase, upload_png_to_supabase
from app.services.supabase_db import (
    list_projects,
    create_project,
    update_project,
    delete_project,
    list_gallery_items,
    create_gallery_item,
    toggle_gallery_like,
    get_public_project_by_gallery_item,
    get_gallery_item_by_project_id,
    update_gallery_item,
    delete_gallery_item,
    get_creator_earnings,
    get_creator_profile,
    get_my_creator_profile,
    update_creator_name,
    increment_gallery_share,
    log_chat,
    get_creator_signature,
    upsert_creator_signature,
    resolve_root_creator_id,
)
from app.services.stitch_visualizer import generate_stitch_preview, recolor_stitch_preview, compute_content_bounds, grid_first_render
from app.services.stitch_visualizer import nearest_dmc, hex_to_rgb, rgb_to_hex
from app.services.stitch_visualizer import import_pattern_image, PatternImportError
from app.services.stitch_visualizer import render_preview_image_from_cells
from app.services.stitchly_import import parse_stitchly, StitchlyParseError
from app.data.dmc_colors import DMC_COLORS

BASE_DIR = Path(__file__).resolve().parents[1]
ASSETS_DIR = BASE_DIR / "assets"
logger = logging.getLogger(__name__)

ADMIN_USER_ID = os.getenv("ADMIN_USER_ID", "")

# Upper bounds on the requested stitch grid. The largest legitimate design is a
# 60"×~1.3" belt at 18ct (~1080×24 cells) or a ~360×234 regular canvas, so these
# caps sit well above real use while preventing a stray/oversized request from
# allocating multi-GB intermediate arrays in the quantization pass and OOM-ing
# the (2GB, single-worker) backend. Kept in sync with the frontend's own limits.
MAX_STITCH_DIMENSION = 1200
MAX_STITCH_CELLS = 150_000

# Cap how many heavy image-processing ops (/visualize, /recolor, /grid-render)
# run at once *per worker process*. Each transiently allocates a few hundred MB,
# and because these handlers are sync `def` served on a thread pool while numpy
# releases the GIL, a burst of parallel requests otherwise runs genuinely in
# parallel and stacks that memory until the box OOMs (observed: ~6 concurrent
# /visualize ≈ 3.4GB). Bursts now queue on this gate instead of piling up in RAM.
# Total concurrency across the service is this value × WEB_CONCURRENCY workers.
_IMAGE_OP_LIMIT = max(1, int(os.getenv("IMAGE_OP_CONCURRENCY", "2")))
_image_op_gate = threading.Semaphore(_IMAGE_OP_LIMIT)


def _validate_stitch_dimensions(stitch_width: int, stitch_height: int) -> None:
    if stitch_width <= 0 or stitch_height <= 0:
        raise HTTPException(status_code=400, detail="Stitch dimensions must be positive.")
    if stitch_width > MAX_STITCH_DIMENSION or stitch_height > MAX_STITCH_DIMENSION:
        raise HTTPException(
            status_code=400,
            detail=f"Stitch dimensions must be at most {MAX_STITCH_DIMENSION} each.",
        )
    if stitch_width * stitch_height > MAX_STITCH_CELLS:
        raise HTTPException(
            status_code=400,
            detail=f"Design is too large — at most {MAX_STITCH_CELLS:,} total stitches.",
        )


def _require_admin(user_id: str) -> None:
    if not ADMIN_USER_ID or user_id != ADMIN_USER_ID:
        raise HTTPException(status_code=403, detail="Admin only.")


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


@app.get("/debug/numeric")
def debug_numeric():
    """Granular numeric probes, run in the serving thread — used to pinpoint
    which operation the production environment corrupts (import-time checks
    passed while request-time output was still wrong)."""
    import threading
    import numpy as np
    from PIL import Image as PILImage
    from app.services import stitch_visualizer as sv

    import inspect

    out: dict = {
        "thread": threading.current_thread().name,
        "numpy_version": np.__version__,
        "pillow_version": __import__("PIL").__version__,
        "numpy_env_ok_flag": sv._NUMPY_ENV_OK,
        "code_marker": "25becf9-named-intermediates-v2",
        "srgb_to_linear_source": inspect.getsource(sv._srgb_to_linear_array),
        "srgb_to_linear_file": inspect.getfile(sv._srgb_to_linear_array),
        "srgb_to_linear_module_file": sv.__file__,
        "srgb_to_linear_id": id(sv._srgb_to_linear_array),
    }
    u = np.array([0.784313725, 0.117647059, 0.156862745])
    out["decode_where"] = np.where(u <= 0.04045, u / 12.92, ((u + 0.055) / 1.055) ** 2.4).round(6).tolist()
    out["power_1_over_2_4"] = (u ** (1 / 2.4)).round(6).tolist()
    out["cbrt"] = np.cbrt(u).round(6).tolist()
    out["matmul_identity"] = (np.eye(3) @ u).round(6).tolist()

    arr = np.full((200, 200), 0.5779, dtype=np.float32)
    fimg = PILImage.fromarray(arr, mode="F").resize((30, 30), PILImage.Resampling.BILINEAR)
    out["fmode_const_after_resize"] = float(np.asarray(fimg)[15, 15])

    solid = PILImage.new("RGB", (200, 200), (200, 30, 40))
    out["resize_200_to_30"] = sv.resize_linear_light(solid, (30, 30), PILImage.Resampling.BILINEAR).getpixel((15, 15))
    small = PILImage.new("RGB", (8, 8), (200, 30, 40))
    out["resize_8_to_4"] = sv.resize_linear_light(small, (4, 4), PILImage.Resampling.BILINEAR).getpixel((1, 1))

    rt = sv._oklab_to_srgb_array(sv._srgb_to_oklab_array(np.array([[200.0, 30.0, 40.0]])))
    out["oklab_roundtrip"] = rt.round(3).tolist()

    out["step_breakdown"] = sv.debug_resize_linear_light_steps(
        (200, 30, 40), (30, 30), PILImage.Resampling.BILINEAR
    )
    return out


@app.post("/contact")
def contact(req: ContactRequest):
    try:
        sent = send_contact_email(req.name, req.email, req.category, req.message)
    except Exception as exc:
        logger.exception("Failed to send contact email: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to send email. Please try again later.")
    if not sent:
        raise HTTPException(status_code=503, detail="Email delivery is not configured on this server.")
    return {"ok": True}


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


@app.post("/chat", response_model=LlmChatResponse, response_model_exclude_none=True)
def chat(request: LlmChatRequest):
    history = [{"role": m.role, "content": m.content} for m in request.history]
    result = chat_with_claude(request.message.strip(), request.context.model_dump(), history)

    # Make any generated source image URL durable (upload to Supabase)
    for action in result.get("actions", []):
        if action.get("type") == "set_source_image" and action.get("url"):
            action["url"] = durable_image_url(action["url"], prefix="source-images")

    if result.get("image_url"):
        result["image_url"] = durable_image_url(result["image_url"], prefix="source-images")

    reply = result["reply"]
    actions = result.get("actions", [])

    log_chat(
        user_message=request.message.strip(),
        assistant_reply=reply,
        actions=actions,
        context=request.context.model_dump(),
    )

    return LlmChatResponse(reply=reply, actions=actions, image_url=result.get("image_url"))


@app.post("/chat/suggestions", response_model=SuggestionsResponse)
def chat_suggestions(request: SuggestionsRequest):
    suggestions = get_suggestions(request.context.model_dump())
    return SuggestionsResponse(suggestions=suggestions)


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
    _validate_stitch_dimensions(request.stitch_width, request.stitch_height)

    with _image_op_gate:
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
def finalize(request: FinalizeRequest, user_id: str | None = Depends(get_optional_user_id)):
    delete_finalized_output(request.previous_pdf_url)
    signature = load_signature_image(get_creator_signature(user_id)) if user_id else None
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
        signature=signature,
    )
    supabase_pdf_url = upload_pdf_to_supabase(public_pdf_path, prefix="public-finalized")
    if supabase_pdf_url:
        pdf_url = supabase_pdf_url

    supabase_preview_url = upload_png_to_supabase(preview_image_path, prefix="public-previews")
    if supabase_preview_url:
        preview_image_url = supabase_preview_url

    internal_supabase_path = upload_pdf_to_supabase(
        internal_pdf_path,
        prefix="internal-finalized",
        bucket_env="SUPABASE_INTERNAL_STORAGE_BUCKET",
        return_public_url=False,
    )

    return FinalizeResponse(
        message="Final PDF report created successfully.",
        pdf_url=pdf_url,
        preview_image_url=preview_image_url,
        internal_pdf_supabase_path=internal_supabase_path,
    )

@app.post("/recolor", response_model=RecolorResponse)
def recolor(request: RecolorRequest):
    _validate_stitch_dimensions(request.stitch_width, request.stitch_height)

    if len(request.selected_palette) < 1:
        raise HTTPException(status_code=400, detail="At least one color must be selected.")

    with _image_op_gate:
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


@app.post("/import-stitchly", response_model=ImportStitchlyResponse)
def import_stitchly(file: UploadFile = File(...)):
    if not (file.filename or "").lower().endswith(".stitchly"):
        raise HTTPException(status_code=400, detail="Expected a .stitchly file.")

    try:
        parsed = parse_stitchly(file.file.read())
    except StitchlyParseError as exc:
        raise HTTPException(status_code=422, detail={"code": "unreadable", "message": str(exc)})

    source_image_url = None
    if parsed["source_image_bytes"]:
        from uuid import uuid4
        from app.services.storage import UPLOADS_DIR
        filename = f"{uuid4().hex}.png"
        (UPLOADS_DIR / filename).write_bytes(parsed["source_image_bytes"])
        source_image_url = durable_image_url(f"/assets/uploads/{filename}", prefix="source-images")

    mesh_count = parsed["mesh_count"] if parsed["mesh_count"] in (13, 18) else 13
    preview_url = render_preview_image_from_cells(
        cells=parsed["cells"], mesh_count=mesh_count, show_grid=False
    )
    preview_url = durable_preview_url(preview_url, prefix="draft-previews")

    return ImportStitchlyResponse(
        message="Stitchly pattern imported.",
        cells=parsed["cells"],
        palette=[PaletteColor(**c) for c in parsed["palette"]],
        stitch_width=parsed["stitch_width"],
        stitch_height=parsed["stitch_height"],
        mesh_count=parsed["mesh_count"],
        pattern_name=parsed["pattern_name"],
        source_image_url=source_image_url,
        preview_image_url=preview_url,
        unknown_codes=parsed["unknown_codes"],
        backstitch_count=parsed["backstitch_count"],
        point_stitch_count=parsed["point_stitch_count"],
    )


@app.post("/import-pattern-image", response_model=ImportPatternResponse)
def import_pattern(request: ImportPatternRequest):
    try:
        cells, palette, stitch_width, stitch_height, snapped_color_count = import_pattern_image(
            image_url=request.image_url,
            stitch_width=request.stitch_width,
            stitch_height=request.stitch_height,
            snap_to_dmc=request.snap_to_dmc,
        )
    except PatternImportError as exc:
        raise HTTPException(status_code=422, detail={"code": exc.code, "message": str(exc)})
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Image not found.")

    return ImportPatternResponse(
        message="Pattern imported.",
        cells=cells,
        palette=[PaletteColor(**c) for c in palette],
        stitch_width=stitch_width,
        stitch_height=stitch_height,
        snapped_color_count=snapped_color_count,
    )


@app.post("/grid-render", response_model=GridRenderResponse)
def grid_render(request: GridRenderRequest):
    _validate_stitch_dimensions(request.stitch_width, request.stitch_height)
    if len(request.palette) < 1:
        raise HTTPException(status_code=400, detail="At least one palette color required.")

    with _image_op_gate:
        preview_url, cells, used_palette = grid_first_render(
            image_url=request.image_url,
            stitch_width=request.stitch_width,
            stitch_height=request.stitch_height,
            mesh_count=request.mesh_count,
            show_grid=request.show_grid,
            palette=[c.model_dump() for c in request.palette],
        )
    preview_url = durable_preview_url(preview_url, prefix="draft-previews")

    return GridRenderResponse(
        message="Grid render complete.",
        stitch_preview_url=preview_url,
        palette=[PaletteColor(**c) for c in used_palette],
        cells=cells,
    )


@app.post("/nearest-dmc", response_model=PaletteColor)
def get_nearest_dmc(request: NearestDmcRequest):
    rgb = hex_to_rgb(request.hex)
    dmc = nearest_dmc(rgb)
    return PaletteColor(
        hex=rgb_to_hex(dmc["rgb"]),
        dmc_code=dmc["code"],
        dmc_name=dmc["name"],
    )


@app.post("/sample-pixel", response_model=PaletteColor)
def sample_pixel(request: SamplePixelRequest):
    from app.services.stitch_visualizer import open_source_image, _resolve_asset_path
    src_path = _resolve_asset_path(request.image_url)
    img = open_source_image(src_path)
    img_x = min(round(request.col / max(request.stitch_width, 1) * img.width), img.width - 1)
    img_y = min(round(request.row / max(request.stitch_height, 1) * img.height), img.height - 1)
    rgb = img.getpixel((img_x, img_y))
    dmc = nearest_dmc(rgb)
    return PaletteColor(
        hex=rgb_to_hex(dmc["rgb"]),
        dmc_code=dmc["code"],
        dmc_name=dmc["name"],
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
    gallery_item = get_gallery_item_by_project_id(project_id)
    if gallery_item:
        delete_gallery_item(gallery_item["id"], user_id)
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


@app.post("/gallery/{item_id}/share", response_model=GalleryItemResponse)
def share_gallery_item(item_id: str):
    result = increment_gallery_share(item_id)
    if result is None:
        raise HTTPException(status_code=502, detail="Could not record share.")
    return result


@app.get("/gallery/creator/me")
def get_my_gallery_creator(user_id: str = Depends(get_current_user_id)):
    result = get_my_creator_profile(user_id)
    if result is None:
        return {"user_id": user_id, "submitter_name": "", "slug": None, "items": []}
    return result


@app.patch("/gallery/creator/me")
def update_my_gallery_creator(request: UpdateCreatorRequest, user_id: str = Depends(get_current_user_id)):
    name = request.submitter_name.strip()[:80]
    if not name:
        raise HTTPException(status_code=422, detail="Creator name is required.")
    if not update_creator_name(user_id, name):
        raise HTTPException(status_code=502, detail="Could not update creator name.")
    result = get_my_creator_profile(user_id)
    if result is None:
        return {"user_id": user_id, "submitter_name": name, "slug": None, "items": []}
    return result


@app.get("/gallery/creator/me/earnings")
def get_my_earnings(user_id: str = Depends(get_current_user_id)):
    return get_creator_earnings(user_id)


# Mirrors Frontend/components/SignatureGridEditor.tsx's GRID_COLS/GRID_ROWS —
# the frontend never sends a larger grid, this just guards the public endpoint.
SIGNATURE_GRID_MAX_COLS = 27
SIGNATURE_GRID_MAX_ROWS = 18


@app.get("/profile/signature")
def get_my_signature(user_id: str = Depends(get_current_user_id)):
    signature = get_creator_signature(user_id)
    return {"image_url": signature["image_url"] if signature else None}


@app.post("/profile/signature")
def save_my_signature(
    file: UploadFile = File(...),
    grid: str | None = Form(None),
    user_id: str = Depends(get_current_user_id),
):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Signature must be an image.")

    grid_json = None
    if grid:
        try:
            grid_json = json.loads(grid)
        except json.JSONDecodeError:
            raise HTTPException(status_code=422, detail="Signature grid was not valid JSON.")
        if not isinstance(grid_json, list) or len(grid_json) > SIGNATURE_GRID_MAX_ROWS or any(
            not isinstance(row, list) or len(row) > SIGNATURE_GRID_MAX_COLS for row in grid_json
        ):
            raise HTTPException(status_code=422, detail="Signature grid exceeds the maximum pixel signature size.")

    image_url = durable_preview_url(save_upload(file), prefix="signatures")
    if not upsert_creator_signature(user_id, image_url, grid_json):
        raise HTTPException(status_code=502, detail="Could not save signature.")
    return {"image_url": image_url}


@app.get("/gallery/creator/{slug}")
def get_gallery_creator(slug: str, user_id: str | None = Depends(get_optional_user_id)):
    result = get_creator_profile(slug, user_id=user_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Creator not found.")
    return result


@app.get("/gallery/by-project/{project_id}")
def get_gallery_by_project(project_id: str):
    result = get_gallery_item_by_project_id(project_id)
    if result is None:
        raise HTTPException(status_code=404, detail="No gallery item found for this project.")
    return result


@app.patch("/gallery/{item_id}", response_model=GalleryItemResponse)
def patch_gallery_item(item_id: str, request: GalleryCreateRequest, user_id: str = Depends(get_current_user_id)):
    data = {k: v for k, v in request.model_dump(exclude_none=True).items()
            if k in {"preview_image_url", "pdf_url", "width_inches", "height_inches",
                     "color_count", "palette", "has_outline"}}
    result = update_gallery_item(item_id, data)
    if result is None:
        raise HTTPException(status_code=502, detail="Could not update gallery item.")
    return result


@app.get("/gallery/{item_id}/project")
def get_gallery_item_project(item_id: str):
    result = get_public_project_by_gallery_item(item_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Project not found for this gallery item.")
    return result


# ── Checkout ──────────────────────────────────────────────────────────────────

@app.post("/checkout/print-own", response_model=CheckoutResponse)
def checkout_print_own(request: PrintOwnCheckoutRequest, user_id: str = Depends(get_current_user_id)):
    if not is_design_printable(request.width_inches, request.height_inches):
        raise HTTPException(status_code=422, detail="Design exceeds maximum printable size (6\" × 10\").")

    creator_user_id = None
    if request.parent_gallery_item_id:
        from app.services.supabase_db import resolve_root_creator_id
        creator_user_id = resolve_root_creator_id(request.parent_gallery_item_id)

    try:
        url = create_print_own_checkout(
            pdf_url=request.pdf_url,
            width_inches=request.width_inches,
            height_inches=request.height_inches,
            user_id=user_id,
            gallery_item_id=request.parent_gallery_item_id,
            creator_user_id=creator_user_id,
            internal_pdf_supabase_path=request.internal_pdf_supabase_path,
            project_id=request.project_id,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return CheckoutResponse(client_secret=url)


@app.post("/checkout/template/{item_id}", response_model=CheckoutResponse)
def checkout_template(item_id: str, user_id: str | None = Depends(get_optional_user_id)):
    from app.services.supabase_db import get_gallery_item, resolve_root_creator_id
    item = get_gallery_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Gallery item not found.")
    try:
        url = create_template_checkout(
            gallery_item_id=item_id,
            gallery_item_title=item.get("title", "Untitled"),
            creator_user_id=resolve_root_creator_id(item_id) or "",
            pdf_url=item.get("pdf_url", ""),
            buyer_user_id=user_id,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return CheckoutResponse(client_secret=url)


@app.post("/checkout/print-gallery/{item_id}", response_model=CheckoutResponse)
def checkout_print_gallery(item_id: str, user_id: str | None = Depends(get_optional_user_id)):
    from app.services.supabase_db import get_gallery_item, resolve_root_creator_id
    item = get_gallery_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Gallery item not found.")
    width = item.get("width_inches")
    height = item.get("height_inches")
    if not width or not height:
        raise HTTPException(status_code=422, detail="This design does not have dimension data for printing.")
    if not is_design_printable(width, height):
        raise HTTPException(status_code=422, detail="Design exceeds maximum printable size (6\" × 10\").")
    canvas = get_canvas_for_design(width, height)
    try:
        url = create_gallery_print_checkout(
            gallery_item_id=item_id,
            gallery_item_title=item.get("title", "Untitled"),
            creator_user_id=resolve_root_creator_id(item_id) or "",
            pdf_url=item.get("pdf_url", ""),
            width_inches=width,
            height_inches=height,
            buyer_user_id=user_id,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return CheckoutResponse(client_secret=url)


@app.post("/checkout/cart", response_model=CheckoutResponse)
def checkout_cart(request: CartCheckoutRequest, user_id: str = Depends(get_current_user_id)):
    from app.services.supabase_db import resolve_root_creator_id
    if not request.items:
        raise HTTPException(status_code=422, detail="Cart is empty.")

    items_data = []
    for item in request.items:
        if not is_design_printable(item.width_inches, item.height_inches):
            raise HTTPException(status_code=422, detail=f"A design ({item.width_inches}\" × {item.height_inches}\") exceeds maximum printable size.")
        creator_user_id = None
        creator_gallery_item_id = item.gallery_item_id or item.parent_gallery_item_id
        if creator_gallery_item_id:
            creator_user_id = resolve_root_creator_id(creator_gallery_item_id)
        items_data.append({
            "pdf_url": item.pdf_url,
            "internal_pdf_supabase_path": item.internal_pdf_supabase_path,
            "width_inches": item.width_inches,
            "height_inches": item.height_inches,
            "quantity": item.quantity,
            "project_id": item.project_id,
            "creator_gallery_item_id": creator_gallery_item_id,
            "creator_user_id": creator_user_id,
        })

    try:
        client_secret = create_cart_checkout(items_data, user_id, use_credit=request.use_credit)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return CheckoutResponse(client_secret=client_secret)


# ── Stripe webhook ────────────────────────────────────────────────────────────

def _record_creator_earnings(session_id: str, creator_user_id: str, gallery_item_id: str, order_type: str, sale_amount_cents: int) -> None:
    from app.services.supabase_db import _request
    _request("POST", "/creator_earnings", body={
        "stripe_session_id": session_id,
        "creator_user_id": creator_user_id,
        "gallery_item_id": gallery_item_id,
        "order_type": order_type,
        "amount_cents": round(sale_amount_cents * 0.20),
        "paid_out": False,
    })


def _handle_completed_session(session) -> None:
    # Stripe SDK objects (from Webhook.construct_event or Session.retrieve)
    # support subscript access but not dict-style .get() in stripe==15.x —
    # normalize to a plain dict so the rest of this function can use .get()
    # freely, regardless of which caller passed which representation.
    if hasattr(session, "to_dict"):
        session = session.to_dict()
    metadata = session.get("metadata") or {}
    order_type = metadata.get("type", "")
    customer_details = session.get("customer_details") or {}
    customer_email = customer_details.get("email")
    shipping = session.get("shipping_details")

    import urllib.request as _ur

    pdf_bytes: bytes | None = None
    pdf_name = "production_report.pdf"
    if order_type in {"print_own", "print_gallery"}:
        internal_path = metadata.get("internal_pdf_supabase_path")
        if internal_path:
            pdf_bytes = download_from_supabase_storage(internal_path, bucket_env="SUPABASE_INTERNAL_STORAGE_BUCKET")
            pdf_name = "internal_production_report.pdf"
        if not pdf_bytes and metadata.get("pdf_url"):
            try:
                with _ur.urlopen(metadata["pdf_url"], timeout=20) as r:
                    pdf_bytes = r.read()
            except Exception:
                pass

        try:
            from app.services.supabase_db import create_print_order
            create_print_order(
                stripe_session_id=session["id"],
                order_type=order_type,
                project_id=metadata.get("project_id"),
                gallery_item_id=metadata.get("gallery_item_id"),
                buyer_user_id=metadata.get("user_id"),
                title=metadata.get("title"),
                width_inches=float(metadata["width_inches"]) if metadata.get("width_inches") else None,
                height_inches=float(metadata["height_inches"]) if metadata.get("height_inches") else None,
            )
        except Exception:
            logger.exception("Failed to record print order for session %s", session.get("id"))

    cart_attachments: list[tuple[bytes, str]] = []
    customer_cart_attachments: list[tuple[bytes, str]] = []
    if order_type == "cart":
        item_count = int(metadata.get("item_count", 0))
        for i in range(item_count):
            raw = metadata.get(f"item_{i}", "{}")
            try:
                item_meta = json.loads(raw)
            except Exception:
                continue
            ip = item_meta.get("ip")
            if ip:
                item_pdf = download_from_supabase_storage(ip, bucket_env="SUPABASE_INTERNAL_STORAGE_BUCKET")
                if item_pdf:
                    cart_attachments.append((item_pdf, f"production_report_{i + 1}.pdf"))
            pdf_url = item_meta.get("pdf")
            if pdf_url:
                try:
                    with _ur.urlopen(pdf_url, timeout=20) as r:
                        customer_cart_attachments.append((r.read(), f"production_report_{i + 1}.pdf"))
                except Exception:
                    logger.exception("Could not fetch cart item PDF for session %s item %d", session.get("id"), i)
            gi = item_meta.get("gi")
            cu = item_meta.get("cu")
            if gi and cu:
                item_total = (item_meta.get("b", 0) + item_meta.get("cv", 0)) * item_meta.get("qty", 1)
                try:
                    _record_creator_earnings(f"{session['id']}_{i}", cu, gi, "cart", item_total)
                except Exception:
                    logger.exception("Failed to record cart creator earnings for session %s item %d", session.get("id"), i)
            try:
                from app.services.supabase_db import create_print_order
                create_print_order(
                    stripe_session_id=f"{session['id']}_{i}",
                    order_type="cart",
                    project_id=item_meta.get("pid"),
                    gallery_item_id=gi,
                    buyer_user_id=metadata.get("user_id"),
                    title=None,
                    width_inches=item_meta.get("w"),
                    height_inches=item_meta.get("h"),
                )
            except Exception:
                logger.exception("Failed to record cart print order for session %s item %d", session.get("id"), i)

    try:
        send_order_notification(order_type, metadata, customer_email, shipping,
                                pdf_attachment_bytes=pdf_bytes, pdf_attachment_name=pdf_name,
                                extra_attachments=cart_attachments if cart_attachments else None)
    except Exception:
        logger.exception("Order notification email failed for session %s", session.get("id"))

    if customer_email:
        customer_pdf_attachments: list[tuple[bytes, str]] = []
        if order_type == "cart":
            customer_pdf_attachments = customer_cart_attachments
        elif metadata.get("pdf_url"):
            safe_title = "".join(
                ch for ch in metadata.get("title", "pattern") if ch.isalnum() or ch in " -_"
            ).strip() or "pattern"
            try:
                with _ur.urlopen(metadata["pdf_url"], timeout=20) as r:
                    customer_pdf_attachments = [(r.read(), f"{safe_title}.pdf")]
            except Exception:
                logger.exception("Could not fetch order PDF for session %s", session.get("id"))
        try:
            send_customer_order_confirmation(
                order_type, metadata, customer_email, shipping,
                amount_total_cents=session.get("amount_total"),
                pdf_attachments=customer_pdf_attachments,
            )
        except Exception:
            logger.exception("Customer confirmation email failed for session %s", session.get("id"))

    if order_type in {"template", "print_gallery"}:
        creator_user_id = metadata.get("creator_user_id", "")
        gallery_item_id = metadata.get("gallery_item_id", "")
        if creator_user_id and gallery_item_id:
            try:
                _record_creator_earnings(session["id"], creator_user_id, gallery_item_id, order_type, session.get("amount_total", 0))
            except Exception:
                logger.exception("Failed to record creator earnings for session %s", session.get("id"))

    applied_credit_user_id = metadata.get("applied_credit_user_id")
    if applied_credit_user_id:
        try:
            from app.services.supabase_db import mark_creator_earnings_paid
            mark_creator_earnings_paid(applied_credit_user_id)
        except Exception:
            logger.exception("Failed to mark creator earnings paid for user %s", applied_credit_user_id)


@app.get("/admin/blank-roll-pdf")
def admin_blank_roll_pdf(height: float = 4.0, user_id: str = Depends(get_current_user_id)):
    _require_admin(user_id)
    path = generate_blank_roll_pdf(height_inches=height)
    return FileResponse(str(path), media_type="application/pdf", filename="mns_blank_roll.pdf")


@app.get("/admin/registration-test-pdf")
def admin_registration_test_pdf(user_id: str = Depends(get_current_user_id)):
    _require_admin(user_id)
    path = generate_registration_test_pdf()
    return FileResponse(str(path), media_type="application/pdf", filename="mns_registration_test.pdf")


@app.get("/admin/calibration-pdf")
def admin_calibration_pdf(nozzle: bool = True, header: bool = True, instructions: bool = True, cell_size: float = 1.0, rows: int | None = None, user_id: str = Depends(get_current_user_id)):
    _require_admin(user_id)
    path = generate_calibration_pdf(include_nozzle_check=nozzle, include_header=header, include_instructions=instructions, cell_inches=cell_size, grid_rows_override=rows)
    return FileResponse(
        str(path),
        media_type="application/pdf",
        filename="mns_calibration.pdf",
    )


def _build_roll_print_design(project: dict, project_id: str | None, signature_cache: dict, label_override: str | None = None, known_gallery_item_id: str | None = None) -> dict:
    # A from-scratch canvas is a blank workspace sized to whatever the user
    # set (e.g. 10x6) — the actual design only occupies whatever was
    # stitched into it. Roll print (unlike the customer finalize preview,
    # which already crops via crop_to_content) previously used the raw
    # padded grid, so a small design on a big blank canvas printed at the
    # full canvas size instead of its own content size. Cropping here makes
    # roll print derive physical size from the stitched content itself —
    # same as an import, where the grid already *is* the content.
    cells = crop_to_content(project.get("cells") or [])
    mesh_count = project.get("mesh_count") or 18
    label = label_override or project.get("title") or project.get("name") or ""

    # Attribute the signature to the design's original creator, same
    # resolution used for royalty payouts, not just whoever owns the
    # copy sitting in the print queue.
    gallery_item_id = known_gallery_item_id
    if not gallery_item_id and project_id:
        gallery_item = get_gallery_item_by_project_id(project_id)
        gallery_item_id = gallery_item["id"] if gallery_item else None
    creator_id = (
        resolve_root_creator_id(gallery_item_id)
        if gallery_item_id
        else project.get("user_id")
    )
    if creator_id not in signature_cache:
        signature_cache[creator_id] = load_signature_image(get_creator_signature(creator_id)) if creator_id else None

    return {
        "cells": cells,
        "mesh_count": mesh_count,
        "label": label,
        "signature": signature_cache[creator_id],
    }


@app.post("/admin/roll-print")
def admin_roll_print(request: RollPrintRequest, user_id: str = Depends(get_current_user_id)):
    _require_admin(user_id)
    from app.services.supabase_db import (
        get_project as db_get_project,
        get_project_by_id,
        get_print_order,
        mark_print_orders_printed,
    )

    designs = []
    signature_cache: dict[str, object] = {}

    for pid in request.project_ids * request.copies:
        project = db_get_project(pid, user_id)
        if not project:
            raise HTTPException(status_code=404, detail=f"Project {pid} not found.")
        designs.append(_build_roll_print_design(project, pid, signature_cache))

    for order_id in request.print_order_ids * request.copies:
        order = get_print_order(order_id)
        if not order:
            raise HTTPException(status_code=404, detail=f"Print order {order_id} not found.")

        project = None
        project_id = order.get("project_id")
        if project_id:
            project = get_project_by_id(project_id)
        if not project and order.get("gallery_item_id"):
            project = get_public_project_by_gallery_item(order["gallery_item_id"])
        if not project:
            raise HTTPException(status_code=404, detail=f"Could not resolve design for print order {order_id}.")

        designs.append(_build_roll_print_design(
            project, project_id, signature_cache,
            label_override=order.get("title"),
            known_gallery_item_id=order.get("gallery_item_id"),
        ))

    if request.include_alignment_test:
        designs.append(generate_alignment_test_design())

    x_offset_pts = request.x_offset_inches * 72
    skew_correction_pts = request.skew_correction_inches * 72
    path = generate_roll_print_pdf(designs, x_offset_pts=x_offset_pts, skew_correction_pts=skew_correction_pts, y_scale=request.y_scale)

    if request.print_order_ids:
        mark_print_orders_printed(request.print_order_ids)

    return FileResponse(
        str(path),
        media_type="application/pdf",
        filename="mns_roll_print.pdf",
    )


@app.get("/admin/print-orders")
def admin_list_print_orders(user_id: str = Depends(get_current_user_id)):
    _require_admin(user_id)
    from app.services.supabase_db import list_pending_print_orders
    return list_pending_print_orders()


@app.post("/admin/replay-checkout-session")
def admin_replay_checkout_session(request: ReplayCheckoutSessionRequest, user_id: str = Depends(get_current_user_id)):
    _require_admin(user_id)
    import stripe as stripe_lib

    try:
        session = stripe_lib.checkout.Session.retrieve(request.session_id)
    except stripe_lib.error.InvalidRequestError as exc:
        raise HTTPException(status_code=404, detail=f"Stripe session not found: {exc}")

    _handle_completed_session(session)
    return {"message": "Replayed checkout session.", "session_id": request.session_id}


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
        try:
            _handle_completed_session(event["data"]["object"])
        except Exception:
            # Always ack the event — a bug here shouldn't make Stripe retry
            # indefinitely or flag the endpoint unhealthy. Errors still need
            # eyes, they just belong in logs, not in Stripe's retry queue.
            logger.exception("Failed to process checkout.session.completed for event %s", event.get("id"))
    return {"received": True}
