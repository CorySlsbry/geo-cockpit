"""ads.py — Meta ads tracking + management surface.

GET  /api/ads         -> Bridge tracking + LIVE Marketing API campaigns + guardrail proposals
POST /api/ads/apply   -> apply ONE approved proposal (the human-approval action; approve-gated writer)
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import require_user, require_owner, visible_slugs
from app.services import metrics_service as svc
from app import engine_bridge as eng  # noqa: F401 — ensures the engine dir is on sys.path

try:
    import meta_ads  # engine module (on sys.path via engine_bridge)
except Exception:  # pragma: no cover
    meta_ads = None

router = APIRouter(prefix="/api/ads", tags=["ads"])


# status()+campaigns() hit the Marketing API — cache them briefly so page opens don't burn
# API calls; every mutation (apply/analyze/perform/config) invalidates so the UI reflects it.
_SNAP_TTL = 60.0
_snap: dict = {"at": 0.0, "status": None, "campaigns": None}


def _marketing_snapshot(force: bool = False) -> tuple[dict, list]:
    now = _time.time()
    if not force and _snap["status"] is not None and now - _snap["at"] < _SNAP_TTL:
        return _snap["status"], _snap["campaigns"]
    st, camps = meta_ads.status(), meta_ads.campaigns()
    _snap.update(at=now, status=st, campaigns=camps)
    return st, camps


def _invalidate_snapshot() -> None:
    _snap["at"] = 0.0


@router.get("")
def ads(ident: dict = Depends(require_user)):
    base = svc.ads(visible_slugs(ident))
    if visible_slugs(ident) is not None:
        # scoped client role: Bridge tracking for their brand only — the live Marketing API
        # view (all ad accounts' KPIs + proposals) is the owner's own cross-account data
        return base
    if meta_ads is None:
        base["marketing_api"] = {"error": "meta_ads engine module unavailable"}
        return base
    try:
        stored = _load_analysis() or {}
        st, camps = _marketing_snapshot()
        base["marketing_api"] = {
            "status": st,
            "campaigns": camps,
            # proposals come from the STORED analysis (one source of truth; page loads stay
            # fast and don't burn Marketing API calls) — run Analyze to refresh them
            "proposals": stored.get("proposals", []) if stored.get("status") == "pending" else [],
        }
    except Exception as e:
        base["marketing_api"] = {"error": str(e)[:250], "status": meta_ads.status()}
    return base


class ApplyBody(BaseModel):
    campaign_id: str
    action: str            # 'pause' | 'resume' | 'scale_budget'
    value: float | None = None


@router.post("/apply")
def apply(body: ApplyBody, ident: dict = Depends(require_owner)):
    """Apply one approved proposal. This CALL is the human approval (mode=propose); it flips the
    approve gate. Owner-only mutation (CSRF + Host/Origin enforced by GuardMiddleware)."""
    if meta_ads is None:
        raise HTTPException(503, "meta_ads engine module unavailable")
    if body.action not in ("pause", "resume", "scale_budget"):
        raise HTTPException(400, f"unsupported action '{body.action}'")
    res = meta_ads.apply_change(body.campaign_id, body.action, body.value, approve=True)
    if not res.get("ok"):
        raise HTTPException(400, res.get("error") or "apply failed")
    _invalidate_snapshot()   # a budget/status just changed — don't serve the stale snapshot
    return res


import json as _json
import time as _time
from pathlib import Path as _Path

_ANALYSIS_PATH = _Path.home() / ".geo-flywheel" / "state" / "ads-analysis.json"
_APPLYABLE = {"pause", "resume", "scale_budget"}   # API-writable; creative actions route to the content pipeline


def _load_analysis() -> dict | None:
    try:
        return _json.loads(_ANALYSIS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return None


def _save_analysis(d: dict | None) -> None:
    _ANALYSIS_PATH.parent.mkdir(parents=True, exist_ok=True)
    if d is None:
        _ANALYSIS_PATH.unlink(missing_ok=True)
    else:
        tmp = _ANALYSIS_PATH.with_suffix(".json.tmp")
        tmp.write_text(_json.dumps(d, indent=1), encoding="utf-8")
        tmp.replace(_ANALYSIS_PATH)


@router.get("/analysis")
def get_analysis(ident: dict = Depends(require_user)):
    if visible_slugs(ident) is not None:   # cross-account owner data, not per-client
        return {"analysis": None}
    return {"analysis": _load_analysis()}


@router.post("/analyze")
def analyze(ident: dict = Depends(require_owner)):
    """Analyze live KPIs -> guardrail proposals + a plain-English summary. Stores the pending
    analysis so 'Perform improvements' / 'Decline' act on exactly what was shown."""
    if meta_ads is None:
        raise HTTPException(503, "meta_ads engine module unavailable")
    _st, camps = _marketing_snapshot(force=True)   # Analyze IS the explicit refresh point
    props = meta_ads.propose()
    summary = None
    try:
        kpi_lines = "\n".join(
            f"- {c['name']} [{c.get('account_name','')}] {c['status']}: spend ${c['spend']:.0f}, "
            f"{c['impressions']} impr, CTR {c.get('ctr')}%, CPC ${c.get('cpc')}, CPM ${c.get('cpm')}, "
            f"freq {c.get('frequency')}, purchases {c['purchases']}, leads {c['leads']}, "
            f"cost/result {c.get('cost_per_result')}, ROAS {c.get('roas')}"
            for c in camps[:12])
        prop_lines = "\n".join(f"- {p['campaign_name']}: {p['action']} ({p['reason'][:120]})" for p in props) or "- none"
        summary = eng.claude_local.run(
            "You are a Meta ads analyst who complements Andromeda (creative-first; small, rate-limited "
            "budget moves; never pause on thin data). Given these last-30d campaign KPIs and the "
            "guardrail engine's proposals, write a tight plain-English performance read for the owner: "
            "3-6 sentences, what's working, what's leaking money, and what the proposals will do. "
            "No preamble, no markdown headers.\n\nKPIs:\n" + kpi_lines +
            "\n\nProposals:\n" + prop_lines,
            max_tokens=700)
    except Exception:
        summary = None
    analysis = {"at": _time.strftime("%Y-%m-%dT%H:%M:%S"), "summary": summary,
                "proposals": props, "status": "pending"}
    _save_analysis(analysis)
    return {"analysis": analysis}


@router.post("/perform")
def perform(ident: dict = Depends(require_owner)):
    """Apply every API-writable proposal from the stored analysis (the button IS the human
    approval). Creative proposals can't be API-applied — they return as content-pipeline work."""
    if meta_ads is None:
        raise HTTPException(503, "meta_ads engine module unavailable")
    analysis = _load_analysis()
    if not analysis or analysis.get("status") != "pending":
        raise HTTPException(400, "no pending analysis — run Analyze first")
    applied, failed, manual = [], [], []
    for p in analysis.get("proposals", []):
        if p["action"] not in _APPLYABLE:
            manual.append({**p, "note": "creative work — routed to the content pipeline, not an API write"})
            continue
        try:
            res = meta_ads.apply_change(p["campaign_id"], p["action"], p.get("value"), approve=True)
            (applied if res.get("ok") else failed).append({**p, "result": res})
        except Exception as e:
            failed.append({**p, "result": {"ok": False, "error": str(e)[:200]}})
    analysis["status"] = "performed"
    analysis["performed_at"] = _time.strftime("%Y-%m-%dT%H:%M:%S")
    analysis["outcome"] = {"applied": len(applied), "failed": len(failed), "manual": len(manual)}
    _save_analysis(analysis)
    _invalidate_snapshot()   # budgets/statuses changed
    return {"applied": applied, "failed": failed, "manual": manual, "analysis": analysis}


@router.post("/decline")
def decline(ident: dict = Depends(require_owner)):
    analysis = _load_analysis()
    if analysis:
        analysis["status"] = "declined"
        _save_analysis(analysis)
    return {"analysis": analysis}


class ConfigBody(BaseModel):
    auto_apply: bool | None = None
    auto_apply_actions: list[str] | None = None   # subset of ['pause','scale_budget']


@router.post("/config")
def set_config(body: ConfigBody, ident: dict = Depends(require_owner)):
    """Toggle auto-apply + which action types the scheduled optimizer may apply without a click.
    Owner-only. Budget increases are gated: only 'pause' (spend-down) may be auto-applied unless the
    owner explicitly widens auto_apply_actions."""
    if meta_ads is None:
        raise HTTPException(503, "meta_ads engine module unavailable")
    cfg = meta_ads.load_config()
    approval = cfg.get("approval") or {}
    if body.auto_apply is not None:
        approval["auto_apply"] = bool(body.auto_apply)
    if body.auto_apply_actions is not None:
        allowed = [a for a in body.auto_apply_actions if a in ("pause", "scale_budget")]
        approval["auto_apply_actions"] = allowed
    approval.setdefault("auto_apply_actions", ["pause"])   # safe default: auto-pause losers only
    cfg["approval"] = approval
    meta_ads.save_config(cfg)
    _invalidate_snapshot()   # status() carries auto_apply — reflect the toggle immediately
    return {"ok": True, "approval": approval}
