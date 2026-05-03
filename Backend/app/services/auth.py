import os

import jwt
from fastapi import Header, HTTPException
from jwt import InvalidTokenError


def _decode_user_id(token: str) -> str:
    jwt_secret = os.getenv("SUPABASE_JWT_SECRET", "")
    if not jwt_secret:
        raise HTTPException(status_code=500, detail="SUPABASE_JWT_SECRET is not configured.")

    try:
        payload = jwt.decode(token, jwt_secret, algorithms=["HS256"], audience="authenticated")
    except InvalidTokenError:
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
