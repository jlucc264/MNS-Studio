import logging
import os
import time
from urllib.request import urlopen
import json

import jwt
from fastapi import Header, HTTPException
from jwt import InvalidTokenError
from jwt.algorithms import ECAlgorithm

logger = logging.getLogger(__name__)

_JWKS_TTL = 86400  # 24 hours

_jwks_cache: dict | None = None
_jwks_fetched_at: float = 0.0


def _get_public_key():
    global _jwks_cache, _jwks_fetched_at
    if _jwks_cache and (time.monotonic() - _jwks_fetched_at) < _JWKS_TTL:
        return _jwks_cache

    supabase_url = os.getenv("SUPABASE_URL", "").rstrip("/")
    base = supabase_url.replace("/rest/v1", "")
    jwks_url = f"{base}/auth/v1/.well-known/jwks.json"

    try:
        with urlopen(jwks_url, timeout=10) as resp:
            jwks = json.loads(resp.read().decode())
        key_data = jwks["keys"][0]
        public_key = ECAlgorithm.from_jwk(json.dumps(key_data))
        _jwks_cache = public_key
        _jwks_fetched_at = time.monotonic()
        return public_key
    except Exception as exc:
        logger.error("Failed to fetch JWKS: %s", exc)
        return _jwks_cache  # return stale key rather than breaking auth


def _decode_user_id(token: str) -> str:
    public_key = _get_public_key()
    if public_key is None:
        raise HTTPException(status_code=500, detail="Could not load auth public key.")

    try:
        payload = jwt.decode(
            token,
            public_key,
            algorithms=["ES256"],
            audience="authenticated",
        )
    except InvalidTokenError as exc:
        logger.warning("JWT verification failed: %s", exc)
        raise HTTPException(status_code=401, detail="Invalid or expired session.")

    user_id = payload.get("sub")
    if not isinstance(user_id, str) or not user_id:
        raise HTTPException(status_code=401, detail="Invalid session.")

    return user_id


def get_current_user_id(authorization: str | None = Header(default=None)) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Log in to access drafts.")

    token = authorization.split(" ", 1)[1].strip()
    return _decode_user_id(token)


def get_optional_user_id(authorization: str | None = Header(default=None)) -> str | None:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None

    token = authorization.split(" ", 1)[1].strip()
    return _decode_user_id(token)
