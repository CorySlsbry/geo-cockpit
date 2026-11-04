"""review.py — the review + approve/edit cockpit (community copy-only, owned approve-to-post)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import require_user, require_owner, ensure_slug_visible
from app.services import review_service as svc
from app.services.jobs import JOBS

router = APIRouter(prefix="/api/audits", tags=["review"])


def _scope(ident: dict, job_id: str) -> None:
    """Object-level authz: a scoped client role can't touch another client's audit."""
    j = JOBS.get(job_id)
    if not j:
        raise HTTPException(404, "job not found")
    ensure_slug_visible(ident, j.get("slug") or "")


@router.get("/{job_id}/review")
def get_review(job_id: str, ident: dict = Depends(require_user)):
    _scope(ident, job_id)
    try:
        return svc.review(job_id)
    except ValueError as e:
        raise HTTPException(404, str(e))


class EditReq(BaseModel):
    fields: list[dict]


@router.patch("/{job_id}/targets/{rank}")
def edit_target(job_id: str, rank: int, req: EditReq, ident: dict = Depends(require_owner)):
    _scope(ident, job_id)
    try:
        return svc.edit_target(job_id, rank, req.fields)
    except ValueError as e:
        raise HTTPException(404, str(e))


@router.post("/{job_id}/targets/{rank}/post")
def post_target(job_id: str, rank: int, ident: dict = Depends(require_owner)):
    _scope(ident, job_id)
    try:
        return svc.post_target(job_id, rank, actor=ident.get("email", "owner"))
    except ValueError as e:
        raise HTTPException(404, str(e))
    except PermissionError as e:
        raise HTTPException(409, str(e))

@router.get("/topics/{slug}")
def list_topics(slug: str, status: str = "queued", ident: dict = Depends(require_user)):
    """The citation-gap topic queue for one lane — what the next flywheel cycle will build."""
    ensure_slug_visible(ident, slug)
    try:
        return {"slug": slug, "status": status, "topics": svc.list_topics(slug, status)}
    except ValueError as e:
        raise HTTPException(404, str(e))
