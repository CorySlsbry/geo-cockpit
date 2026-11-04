"""action_center.py — the Dashboard's cross-client roll-up: pending recommended actions,
working/queued jobs, and a pending ads analysis, so the day starts on one screen."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.auth import require_user, visible_slugs
from app import engine_bridge as eng
from app.services import actions_service as acts
from app.services.jobs import JOBS
from app.routers.ads import _load_analysis

router = APIRouter(prefix="/api/action-center", tags=["action-center"])

_OPEN = ("todo", "prepared", "working", "sent", "hold")


@router.get("")
def action_center(ident: dict = Depends(require_user)):
    vis = visible_slugs(ident)
    good, _bad = eng.client_profile.load_all()

    clients = []
    for slug in sorted(good):
        if vis is not None and slug not in vis:
            continue
        doc = acts.load(slug)
        open_actions = [a for a in doc.get("actions", []) if a.get("status") in _OPEN]
        if not open_actions:
            continue
        counts: dict[str, int] = {}
        for a in open_actions:
            counts[a["status"]] = counts.get(a["status"], 0) + 1
        clients.append({
            "slug": slug,
            "name": (good[slug].get("brand") or {}).get("name") or slug,
            "open": len(open_actions),
            "counts": counts,
            "top": [{"id": a["id"], "kind": a["kind"], "title": a["title"], "status": a["status"]}
                    for a in open_actions[:3]],
            "generated_at": doc.get("generated_at"),
        })

    jobs = [j for j in JOBS.list_jobs(limit=25)
            if j.get("status") in ("queued", "running") and (vis is None or j.get("slug") in vis)]

    out = {"clients": clients, "jobs": jobs}
    if vis is None:  # the ads surface is the owner's own accounts, not per-client data
        analysis = _load_analysis() or {}
        if analysis.get("status") == "pending":
            out["ads_pending"] = {"at": analysis.get("at"),
                                  "proposals": len(analysis.get("proposals") or [])}
        # a broken email that actually shipped must not need a page-visit to discover
        try:
            from app.services import mail_audit_service
            rep = mail_audit_service.last_report() or {}
            if rep.get("critical"):
                out["mail_defects"] = {"at": rep.get("at"), "critical": rep["critical"],
                                       "new": rep.get("new_defects", 0)}
        except Exception:
            pass
    return out
