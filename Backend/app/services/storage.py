from pathlib import Path
from uuid import uuid4
from fastapi import UploadFile
import shutil
from urllib.parse import urlparse
from urllib.request import Request, urlopen


BASE_DIR = Path(__file__).resolve().parents[2]
ASSETS_DIR = BASE_DIR / "assets"
UPLOADS_DIR = ASSETS_DIR / "uploads"
PREVIEWS_DIR = ASSETS_DIR / "previews"
FINALIZED_DIR = ASSETS_DIR / "finalized"

UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
PREVIEWS_DIR.mkdir(parents=True, exist_ok=True)
FINALIZED_DIR.mkdir(parents=True, exist_ok=True)


def save_upload(file: UploadFile) -> str:
    suffix = Path(file.filename).suffix or ".png"
    filename = f"{uuid4().hex}{suffix}"
    filepath = UPLOADS_DIR / filename

    with filepath.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    return f"/assets/uploads/{filename}"


def save_remote_image(image_url: str) -> str:
    parsed = urlparse(image_url)
    suffix = Path(parsed.path).suffix.lower()
    if suffix not in {".png", ".jpg", ".jpeg", ".webp", ".gif"}:
      suffix = ".png"

    filename = f"{uuid4().hex}{suffix}"
    filepath = UPLOADS_DIR / filename

    request = Request(image_url, headers={"User-Agent": "MNS/1.0"})
    with urlopen(request, timeout=15) as response, filepath.open("wb") as buffer:
        content_type = response.headers.get("Content-Type", "")
        if not content_type.startswith("image/"):
            raise ValueError("Remote URL did not return an image.")

        shutil.copyfileobj(response, buffer)

    return f"/assets/uploads/{filename}"


def preview_output_path() -> tuple[Path, str]:
    filename = f"preview_{uuid4().hex}.png"
    filepath = PREVIEWS_DIR / filename
    url = f"/assets/previews/{filename}"
    return filepath, url


def finalized_output_path() -> tuple[Path, str]:
    filename = f"finalized_{uuid4().hex}.pdf"
    filepath = FINALIZED_DIR / filename
    url = f"/assets/finalized/{filename}"
    return filepath, url


def delete_finalized_output(asset_url: str | None) -> None:
    if not asset_url:
        return

    cleaned = asset_url.lstrip("/")
    filepath = ASSETS_DIR.parent / cleaned

    try:
        filepath.relative_to(FINALIZED_DIR)
    except ValueError:
        return

    if filepath.exists():
        filepath.unlink()
