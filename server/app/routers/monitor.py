"""monitor.py — deliveries, scheduled-task health, Claude LLM path.

Owner-only: these logs are cross-brand (every lane's DM/email/social deliveries + infra
health) — a scoped client role must never read another brand's operational data.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.auth import require_owner
from app.services import monitor_service as svc

router = APIRouter(prefix="/api/monitor", tags=["monitor"])


@router.get("")
def overview(limit: int = 40, ident: dict = Depends(require_owner)):
    return svc.overview(limit)


@router.get("/deliveries")
def deliveries(source: str = "dm", limit: int = 100, ident: dict = Depends(require_owner)):
    return svc.deliveries(source, limit)


@router.get("/tasks")
def tasks(ident: dict = Depends(require_owner)):
    return {"tasks": svc.tasks()}
