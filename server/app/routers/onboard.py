"""onboard.py — onboard a brand (preview-before-save)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import require_owner
from app.services import onboard_service as svc
from app.services.jobs import JOBS

router = APIRouter(prefix="/api/onboard", tags=["onboard"])


class OnboardReq(BaseModel):
    domain: str
    name: str = ""
    slug: str = ""
    use_llm: bool = True
    overwrite: bool = False


@router.post("/preview")
def preview(req: OnboardReq, ident: dict = Depends(require_owner)):
    if not req.domain.strip():
        raise HTTPException(400, "domain is required")
    return svc.preview(req.domain.strip(), name=req.name, slug=req.slug, use_llm=req.use_llm)


@router.post("/save")
def save(req: OnboardReq, ident: dict = Depends(require_owner)):
    if not req.domain.strip():
        raise HTTPException(400, "domain is required")
    res = svc.save(req.domain.strip(), name=req.name, slug=req.slug,
                   use_llm=req.use_llm, overwrite=req.overwrite)
    if not res.get("ok"):
        raise HTTPException(400, res.get("error", "onboarding failed"))
    # ground the new client in REAL search demand immediately: queue the research job so the
    # researched buyer-question proposal is waiting when Cory reviews the client (Apply = 1 click;
    # the Haiku inference never silently becomes the permanent measure set)
    slug = res.get("slug") or (res.get("profile") or {}).get("slug")
    if slug and not JOBS.running_for(slug, kinds=("cluster_research",)):
        from app import engine_bridge as eng
        res["research_job_id"] = JOBS.enqueue_fn(
            "cluster_research", slug,
            lambda progress: (progress(phase="research", pct=15,
                                       log_line="researching real search demand for the new client..."),
                              eng.cluster_research.run_and_store(slug))[1])
    return res
