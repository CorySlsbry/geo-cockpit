"""jobs.py — generic background-job status + SSE (any kind: audits, actions refresh/take, ...).

The audit endpoints under /api/audits stay for compatibility; this router is the kind-agnostic
surface the SPA uses for the non-audit jobs (recommended-actions refresh + take).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.auth import require_user, ensure_slug_visible
from app.services.jobs import JOBS, sse_stream

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


def _job_or_404(ident: dict, job_id: str) -> dict:
    """Fetch a job + object-level authz (a scoped client role can't read another's job)."""
    j = JOBS.get(job_id)
    if not j:
        raise HTTPException(404, "job not found")
    ensure_slug_visible(ident, j.get("slug") or "")
    return j


@router.get("/{job_id}")
def get_job(job_id: str, ident: dict = Depends(require_user)):
    return _job_or_404(ident, job_id)


@router.get("/{job_id}/result")
def job_result(job_id: str, ident: dict = Depends(require_user)):
    _job_or_404(ident, job_id)
    r = JOBS.result(job_id)
    if r is None:
        raise HTTPException(404, "no result yet")
    return r


@router.get("/{job_id}/events")
async def job_events(job_id: str, ident: dict = Depends(require_user)):
    _job_or_404(ident, job_id)  # authz before opening the stream
    return StreamingResponse(sse_stream(job_id), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no",
                                      "Connection": "keep-alive"})
