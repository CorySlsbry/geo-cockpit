"""connect.py — per-client OAuth connect wizard (plan + paste-token save)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import require_user, require_owner, visible_slugs
from app.services import connect_service as svc

router = APIRouter(prefix="/api/clients", tags=["connect"])


@router.get("/{slug}/connect")
def connect_status(slug: str, ident: dict = Depends(require_user)):
    return {"slug": slug, "platforms": svc.PLATFORMS, "status": svc.status(slug)}


@router.get("/{slug}/connect/{platform}")
def connect_plan(slug: str, platform: str, ident: dict = Depends(require_user)):
    try:
        return svc.plan(slug, platform)
    except ValueError as e:
        raise HTTPException(400, str(e))


class TokenReq(BaseModel):
    token: str | None = None
    account_id: str | None = None
    location_id: str | None = None
    refresh_token: str | None = None
    handle: str | None = None
    api_host: str | None = None
    expires_at: str | None = None
    email: str | None = None
    page_id: str | None = None
    scope: str | None = None


@router.post("/{slug}/connect/{platform}")
def connect_save(slug: str, platform: str, req: TokenReq, ident: dict = Depends(require_owner)):
    vis = visible_slugs(ident)
    if vis is not None and slug not in vis:
        raise HTTPException(403, "not permitted")
    try:
        return svc.save_token(slug, platform, req.model_dump())
    except ValueError as e:
        raise HTTPException(400, str(e))
