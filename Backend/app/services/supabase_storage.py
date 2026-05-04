import logging
import os
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)


def _clean_supabase_url(value: str | None) -> str | None:
    if not value:
        return None
    return value.rstrip("/")


def _storage_object_path(prefix: str, local_path: Path) -> str:
    cleaned_prefix = prefix.strip("/")
    filename = local_path.name
    if not cleaned_prefix:
        return filename
    return f"{cleaned_prefix}/{filename}"


def upload_file_to_supabase(
    local_path: Path,
    *,
    prefix: str = "finalized",
    bucket_env: str = "SUPABASE_STORAGE_BUCKET",
    return_public_url: bool = True,
    content_type: str = "application/octet-stream",
) -> str | None:
    supabase_url = _clean_supabase_url(os.getenv("SUPABASE_URL"))
    service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    bucket = os.getenv(bucket_env) or os.getenv("SUPABASE_STORAGE_BUCKET")

    if not supabase_url or not service_role_key or not bucket:
        logger.warning(
            "Supabase storage is not configured; keeping file on local filesystem. "
            "SUPABASE_URL=%s SUPABASE_SERVICE_ROLE_KEY=%s %s=%s",
            "set" if supabase_url else "missing",
            "set" if service_role_key else "missing",
            bucket_env,
            "set" if bucket else "missing",
        )
        return None

    object_path = _storage_object_path(prefix, local_path)
    encoded_bucket = quote(bucket, safe="")
    encoded_object_path = quote(object_path, safe="/")
    upload_url = f"{supabase_url}/storage/v1/object/{encoded_bucket}/{encoded_object_path}"

    try:
        payload = local_path.read_bytes()
        request = Request(
            upload_url,
            data=payload,
            method="POST",
            headers={
                "apikey": service_role_key,
                "Authorization": f"Bearer {service_role_key}",
                "Content-Type": content_type,
                "x-upsert": "true",
            },
        )
        with urlopen(request, timeout=30):
            pass
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        logger.warning("Supabase file upload failed: %s %s", exc.code, detail)
        return None
    except (OSError, URLError) as exc:
        logger.warning("Supabase file upload failed: %s", exc)
        return None

    logger.warning(
        "Supabase file upload succeeded: bucket=%s object=%s",
        bucket,
        object_path,
    )

    if not return_public_url:
        return object_path

    return f"{supabase_url}/storage/v1/object/public/{encoded_bucket}/{encoded_object_path}"


def upload_pdf_to_supabase(
    local_path: Path,
    *,
    prefix: str = "finalized",
    bucket_env: str = "SUPABASE_STORAGE_BUCKET",
    return_public_url: bool = True,
) -> str | None:
    return upload_file_to_supabase(
        local_path,
        prefix=prefix,
        bucket_env=bucket_env,
        return_public_url=return_public_url,
        content_type="application/pdf",
    )


def upload_png_to_supabase(
    local_path: Path,
    *,
    prefix: str = "previews",
    bucket_env: str = "SUPABASE_STORAGE_BUCKET",
    return_public_url: bool = True,
) -> str | None:
    return upload_file_to_supabase(
        local_path,
        prefix=prefix,
        bucket_env=bucket_env,
        return_public_url=return_public_url,
        content_type="image/png",
    )
