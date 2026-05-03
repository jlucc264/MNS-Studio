import json
import logging
import os
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)

REST_TIMEOUT = 10


def _headers() -> dict[str, str]:
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


def _base_url() -> str | None:
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    return url if url else None


def _request(method: str, path: str, body: dict | None = None, params: str = "") -> list[dict] | dict | None:
    base = _base_url()
    if not base:
        logger.warning("SUPABASE_URL not configured; skipping DB call")
        return None

    api_base = base if base.endswith("/rest/v1") else f"{base}/rest/v1"
    full_url = f"{api_base}{path}"
    if params:
        full_url = f"{full_url}?{params}"

    headers = _headers()
    if method in ("POST", "PATCH"):
        headers["Prefer"] = "return=representation"

    payload = json.dumps(body).encode() if body is not None else None

    try:
        req = Request(full_url, data=payload, method=method, headers=headers)
        with urlopen(req, timeout=REST_TIMEOUT) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw.strip() else []
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        logger.warning("Supabase DB %s %s failed: %s %s", method, path, exc.code, detail)
        return None
    except (OSError, URLError) as exc:
        logger.warning("Supabase DB %s %s failed: %s", method, path, exc)
        return None


# ── public API ────────────────────────────────────────────────────────────────

def list_projects(user_id: str) -> list[dict]:
    encoded_user_id = quote(user_id, safe="")
    result = _request(
        "GET",
        "/projects",
        params=f"user_id=eq.{encoded_user_id}&order=updated_at.desc&select=*",
    )
    return result if isinstance(result, list) else []


def get_project(project_id: str, user_id: str) -> dict | None:
    encoded = quote(project_id, safe="")
    encoded_user_id = quote(user_id, safe="")
    result = _request(
        "GET",
        "/projects",
        params=f"id=eq.{encoded}&user_id=eq.{encoded_user_id}&select=*",
    )
    if isinstance(result, list) and result:
        return result[0]
    return None


def create_project(data: dict, user_id: str) -> dict | None:
    data["user_id"] = user_id
    result = _request("POST", "/projects", body=data)
    if isinstance(result, list) and result:
        return result[0]
    return None


def update_project(project_id: str, data: dict, user_id: str) -> dict | None:
    encoded = quote(project_id, safe="")
    encoded_user_id = quote(user_id, safe="")
    data.pop("user_id", None)
    result = _request("PATCH", "/projects", body=data, params=f"id=eq.{encoded}&user_id=eq.{encoded_user_id}")
    if isinstance(result, list) and result:
        return result[0]
    return None


def delete_project(project_id: str, user_id: str) -> bool:
    encoded = quote(project_id, safe="")
    encoded_user_id = quote(user_id, safe="")
    result = _request("DELETE", "/projects", params=f"id=eq.{encoded}&user_id=eq.{encoded_user_id}")
    return result is not None


# ── gallery ──────────────────────────────────────────────────────────────────

def _normalize_gallery_item(item: dict, liked_ids: set[str] | None = None) -> dict:
    liked_ids = liked_ids or set()
    item["tags"] = item.get("tags") or []
    item["like_count"] = item.get("like_count") or 0
    item["liked_by_me"] = item.get("id") in liked_ids
    return item


def _liked_gallery_ids(user_id: str | None) -> set[str]:
    if not user_id:
        return set()

    encoded_user_id = quote(user_id, safe="")
    result = _request(
        "GET",
        "/gallery_likes",
        params=f"user_id=eq.{encoded_user_id}&select=item_id",
    )
    if not isinstance(result, list):
        return set()
    return {row["item_id"] for row in result if row.get("item_id")}


def list_gallery_items(search: str | None = None, sort: str = "recent", user_id: str | None = None) -> list[dict]:
    order = "like_count.desc,created_at.desc" if sort == "popular" else "created_at.desc"
    result = _request(
        "GET",
        "/gallery_items",
        params=f"order={order}&limit=80&select=*",
    )
    items = result if isinstance(result, list) else []

    if search:
        needle = search.strip().lower()
        if needle:
            items = [
                item for item in items
                if needle in str(item.get("title", "")).lower()
                or any(needle in str(tag).lower() for tag in (item.get("tags") or []))
            ]

    liked_ids = _liked_gallery_ids(user_id)
    return [_normalize_gallery_item(item, liked_ids) for item in items]


def get_gallery_item(item_id: str, user_id: str | None = None) -> dict | None:
    encoded = quote(item_id, safe="")
    result = _request("GET", "/gallery_items", params=f"id=eq.{encoded}&select=*")
    if not isinstance(result, list) or not result:
        return None
    liked_ids = _liked_gallery_ids(user_id)
    return _normalize_gallery_item(result[0], liked_ids)


def create_gallery_item(data: dict, user_id: str) -> dict | None:
    data["user_id"] = user_id
    data["like_count"] = 0
    result = _request("POST", "/gallery_items", body=data)
    if isinstance(result, list) and result:
        return _normalize_gallery_item(result[0], set())
    return None


def _find_gallery_like(item_id: str, user_id: str) -> dict | None:
    encoded_item_id = quote(item_id, safe="")
    encoded_user_id = quote(user_id, safe="")
    result = _request(
        "GET",
        "/gallery_likes",
        params=f"item_id=eq.{encoded_item_id}&user_id=eq.{encoded_user_id}&select=*",
    )
    if isinstance(result, list) and result:
        return result[0]
    return None


def toggle_gallery_like(item_id: str, user_id: str) -> dict | None:
    item = get_gallery_item(item_id, user_id=None)
    if not item:
        return None

    encoded_item_id = quote(item_id, safe="")
    encoded_user_id = quote(user_id, safe="")
    existing = _find_gallery_like(item_id, user_id)
    current_count = int(item.get("like_count") or 0)

    if existing:
        deleted = _request(
            "DELETE",
            "/gallery_likes",
            params=f"item_id=eq.{encoded_item_id}&user_id=eq.{encoded_user_id}",
        )
        if deleted is None:
            return None
        next_count = max(0, current_count - 1)
        liked = False
    else:
        created = _request("POST", "/gallery_likes", body={"item_id": item_id, "user_id": user_id})
        if created is None:
            return None
        next_count = current_count + 1
        liked = True

    updated = _request(
        "PATCH",
        "/gallery_items",
        body={"like_count": next_count},
        params=f"id=eq.{encoded_item_id}",
    )
    if isinstance(updated, list) and updated:
        updated[0]["liked_by_me"] = liked
        return _normalize_gallery_item(updated[0], {item_id} if liked else set())
    return None
