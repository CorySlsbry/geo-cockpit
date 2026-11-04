"""audits.py — run audits (background jobs), stream progress (SSE), serve results + the report."""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from app.auth import require_user, require_owner, ensure_slug_visible, visible_slugs
from app.config import REPORTS_DIR
from app.services.jobs import JOBS, sse_stream

router = APIRouter(prefix="/api/audits", tags=["audits"])


def _job_or_404(ident: dict, job_id: str) -> dict:
    """Fetch a job + enforce object-level authz (a scoped client role can't read another's job)."""
    j = JOBS.get(job_id)
    if not j:
        raise HTTPException(404, "job not found")
    ensure_slug_visible(ident, j.get("slug") or "")
    return j


class AuditReq(BaseModel):
    slug: str
    max_measure: int | None = None
    max_draft: int | None = 3
    draft_model: str | None = None
    no_llm: bool = False


@router.post("")
def start_audit(req: AuditReq, ident: dict = Depends(require_owner)):
    ensure_slug_visible(ident, req.slug)
    existing = JOBS.running_for(req.slug, kinds=("audit",))
    if existing:
        return {"job_id": existing, "status": "running", "already_running": True}
    params = {"max_measure": req.max_measure, "max_draft": req.max_draft or 3,
              "draft_model": req.draft_model, "no_llm": req.no_llm}
    return {"job_id": JOBS.enqueue_audit(req.slug, params), "status": "queued"}


@router.get("")
def list_audits(slug: str | None = None, ident: dict = Depends(require_user)):
    vis = visible_slugs(ident)
    if slug:
        ensure_slug_visible(ident, slug)
    jobs = [j for j in JOBS.list_jobs(slug) if j.get("kind", "audit") == "audit"]  # not actions jobs
    if vis is not None:  # a scoped client role only ever sees its own jobs
        jobs = [j for j in jobs if j.get("slug") in vis]
    return {"jobs": jobs}


@router.get("/{job_id}")
def get_audit(job_id: str, ident: dict = Depends(require_user)):
    return _job_or_404(ident, job_id)


@router.get("/{job_id}/audit.json")
def audit_json(job_id: str, ident: dict = Depends(require_user)):
    _job_or_404(ident, job_id)
    r = JOBS.result(job_id)
    if not r:
        raise HTTPException(404, "no result yet")
    return r["audit"]


@router.get("/{job_id}/kits")
def kits(job_id: str, ident: dict = Depends(require_user)):
    _job_or_404(ident, job_id)
    r = JOBS.result(job_id)
    if not r:
        raise HTTPException(404, "no result yet")
    return {"kits": r.get("slack_kits", [])}


@router.get("/{job_id}/report")
def report(job_id: str, ident: dict = Depends(require_user)):
    _job_or_404(ident, job_id)
    p = JOBS.report_path(job_id)
    if not p:
        raise HTTPException(404, "no report")
    rp = Path(p).resolve()
    if not rp.is_relative_to(REPORTS_DIR.resolve()) or not rp.is_file():
        raise HTTPException(404, "report not found")
    return FileResponse(str(rp), media_type="text/html")


@router.get("/{job_id}/events")
async def events(job_id: str, ident: dict = Depends(require_user)):
    _job_or_404(ident, job_id)  # authz before opening the stream
    return StreamingResponse(sse_stream(job_id), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no",
                                      "Connection": "keep-alive"})
