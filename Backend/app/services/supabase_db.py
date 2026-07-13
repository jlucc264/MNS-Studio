import json
import logging
import os
import re
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

def log_chat(user_message: str, assistant_reply: str, actions: list, context: dict) -> None:
    try:
        _request("POST", "/chat_logs", body={
            "user_message": user_message,
            "assistant_reply": assistant_reply,
            "actions": actions,
            "context": context,
        })
    except Exception as exc:
        logger.warning("Chat log write failed: %s", exc)

def get_logo_cells(mesh_count: int) -> list[list[str]] | None:
    name = quote(f"Logo - {mesh_count} Mesh", safe="")
    result = _request("GET", "/projects", params=f"name=eq.{name}&select=cells&limit=1")
    rows = result if isinstance(result, list) else []
    if rows and rows[0].get("cells"):
        return rows[0]["cells"]
    return None


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
    item["share_count"] = item.get("share_count") or 0
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
                or needle in str(item.get("submitter_name", "")).lower()
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


def get_gallery_item_by_project_id(project_id: str) -> dict | None:
    encoded = quote(project_id, safe="")
    result = _request("GET", "/gallery_items", params=f"project_id=eq.{encoded}&select=*&limit=1")
    if isinstance(result, list) and result:
        return _normalize_gallery_item(result[0])
    return None


def update_gallery_item(item_id: str, data: dict) -> dict | None:
    encoded = quote(item_id, safe="")
    result = _request("PATCH", "/gallery_items", body=data, params=f"id=eq.{encoded}")
    if isinstance(result, list) and result:
        return _normalize_gallery_item(result[0])
    return None


def delete_gallery_item(item_id: str, user_id: str) -> bool:
    encoded = quote(item_id, safe="")
    encoded_user_id = quote(user_id, safe="")
    result = _request("DELETE", "/gallery_items", params=f"id=eq.{encoded}&user_id=eq.{encoded_user_id}")
    return result is not None


def get_public_project_by_gallery_item(item_id: str) -> dict | None:
    encoded = quote(item_id, safe="")
    item_result = _request("GET", "/gallery_items", params=f"id=eq.{encoded}&select=project_id")
    if not isinstance(item_result, list) or not item_result:
        return None
    project_id = item_result[0].get("project_id")
    if not project_id:
        return None
    encoded_project = quote(project_id, safe="")
    result = _request("GET", "/projects", params=f"id=eq.{encoded_project}&select=*")
    if isinstance(result, list) and result:
        return result[0]
    return None


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


def increment_gallery_share(item_id: str) -> dict | None:
    item = get_gallery_item(item_id)
    if not item:
        return None
    encoded = quote(item_id, safe="")
    next_count = int(item.get("share_count") or 0) + 1
    updated = _request(
        "PATCH",
        "/gallery_items",
        body={"share_count": next_count},
        params=f"id=eq.{encoded}",
    )
    if isinstance(updated, list) and updated:
        return _normalize_gallery_item(updated[0])
    return None


def slugify(name: str) -> str:
    name = name.lower().strip()
    name = re.sub(r'[^a-z0-9\s-]', '', name)
    name = re.sub(r'\s+', '-', name)
    name = re.sub(r'-+', '-', name)
    return name.strip('-') or 'creator'


def _build_creator_slug_map(items: list[dict]) -> dict[str, str]:
    user_first_seen: dict[str, str] = {}
    user_names: dict[str, str] = {}
    for item in items:
        uid = item.get('user_id') or ''
        if not uid:
            continue
        created = item.get('created_at') or ''
        name = item.get('submitter_name') or 'creator'
        if uid not in user_first_seen or created < user_first_seen[uid]:
            user_first_seen[uid] = created
            user_names[uid] = name
    sorted_users = sorted(user_first_seen, key=lambda u: user_first_seen[u])
    slug_groups: dict[str, list[str]] = {}
    for uid in sorted_users:
        base = slugify(user_names[uid])
        slug_groups.setdefault(base, []).append(uid)
    slug_to_uid: dict[str, str] = {}
    for base, uids in slug_groups.items():
        for i, uid in enumerate(uids):
            slug_to_uid[base if i == 0 else f'{base}-{i + 1}'] = uid
    return slug_to_uid


def mark_creator_earnings_paid(user_id: str) -> None:
    encoded = quote(user_id, safe="")
    _request(
        "PATCH",
        "/creator_earnings",
        params=f"creator_user_id=eq.{encoded}&paid_out=eq.false",
        body={"paid_out": True},
    )


def get_creator_earnings(user_id: str) -> dict:
    encoded_user_id = quote(user_id, safe="")
    result = _request(
        "GET",
        "/creator_earnings",
        params=f"creator_user_id=eq.{encoded_user_id}&select=order_type,amount_cents,paid_out",
    )
    rows = result if isinstance(result, list) else []
    template_sales = sum(1 for r in rows if r.get("order_type") == "template")
    print_sales = sum(1 for r in rows if r.get("order_type") == "print_gallery")
    total_cents = sum(int(r.get("amount_cents") or 0) for r in rows)
    paid_cents = sum(int(r.get("amount_cents") or 0) for r in rows if r.get("paid_out"))
    pending_cents = total_cents - paid_cents
    return {
        "template_sales": template_sales,
        "print_sales": print_sales,
        "total_cents": total_cents,
        "paid_cents": paid_cents,
        "pending_cents": pending_cents,
    }


def update_creator_name(user_id: str, submitter_name: str) -> bool:
    encoded = quote(user_id, safe="")
    result = _request(
        "PATCH",
        "/gallery_items",
        params=f"user_id=eq.{encoded}",
        body={"submitter_name": submitter_name},
    )
    return result is not None


def get_my_creator_profile(user_id: str) -> dict | None:
    all_items = list_gallery_items()
    slug_map = _build_creator_slug_map(all_items)
    my_slug = next((slug for slug, uid in slug_map.items() if uid == user_id), None)
    if my_slug is None:
        return None
    creator_items = [i for i in all_items if i.get('user_id') == user_id]
    liked_ids = _liked_gallery_ids(user_id)
    normalized = [_normalize_gallery_item(i, liked_ids) for i in creator_items]
    submitter_name = next(
        (i['submitter_name'] for i in creator_items if i.get('submitter_name')),
        'creator',
    )
    return {
        'user_id': user_id,
        'submitter_name': submitter_name,
        'slug': my_slug,
        'items': normalized,
    }


def get_creator_profile(slug: str, user_id: str | None = None) -> dict | None:
    all_items = list_gallery_items(user_id=user_id)
    slug_map = _build_creator_slug_map(all_items)
    creator_uid = slug_map.get(slug)
    if not creator_uid:
        return None
    creator_items = [i for i in all_items if i.get('user_id') == creator_uid]
    submitter_name = next(
        (i['submitter_name'] for i in creator_items if i.get('submitter_name')),
        slug,
    )
    return {
        'user_id': creator_uid,
        'submitter_name': submitter_name,
        'slug': slug,
        'items': creator_items,
    }


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
