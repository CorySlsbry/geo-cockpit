"""metrics.py — dashboard graphs from the Bridge metrics.db + generic series."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.auth import require_user, visible_slugs, ensure_slug_visible
from app.services import metrics_service as svc

router = APIRouter(prefix="/api/metrics", tags=["metrics"])


@router.get("/dashboard")
def dashboard(ident: dict = Depends(require_user)):
    return svc.dashboard(visible_slugs(ident))


@router.get("/series")
def series(source: str, metric: str, brand: str, days: int = 180,
           ident: dict = Depends(require_user)):
    ensure_slug_visible(ident, brand)  # a scoped client can't pull an arbitrary brand's series
    return {"source": source, "metric": metric, "brand": brand,
            "series": svc.series(source, metric, brand, days)}
