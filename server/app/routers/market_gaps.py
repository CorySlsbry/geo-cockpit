"""market_gaps.py — founder-led, human-gated MARKET-GAP demand-test posts.

⛔ These target UNSOLD, pre-customer offers (scale-gate Phase 0). This surface DRAFTS posts and
holds them for the owner; nothing posts without an explicit owner click, and every post action
is dry-run by default. It is a SEPARATE stream from the GEO flywheel — it never writes
buyer_clusters, schedules a recheck, or records GEO cadence (posts pass --ignore-cadence).

GET  /api/market-gaps                 -> radar gaps + per-brand pending posts + channel readiness
POST /api/market-gaps/generate        -> draft a batch for {gap_id, brand_slug} (background job)
POST /api/market-gaps/{slug}/post     -> post ONE approved post (dry_run default) via the lane poster
POST /api/market-gaps/{slug}/dismiss  -> drop one post
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import require_owner
from app import engine_bridge as eng
from app.services.jobs import JOBS

router = APIRouter(prefix="/api/market-gaps", tags=["market-gaps"])

ENGINE_DIR = Path(eng.social_post.__file__).parent
LANES_PATH = ENGINE_DIR.parent / "lanes.json"
POSTABLE = set(eng.social_post.HANDLERS)


def _channel_map() -> dict:
    """brand slug -> the connected, postable networks (so the UI shows 'ready' vs 'copy-only').
    Source = lanes.json (list-of-dicts social, the same source the Social page uses); the client
    PROFILE's `social` is a different shape (a dict) and is not the posting registry."""
    out = {}
    try:
        lanes = json.loads(LANES_PATH.read_text(encoding="utf-8"))
    except Exception:
        return out
    for slug, lane in lanes.items():
        if slug.startswith("_") or not isinstance(lane, dict):
            continue
        nets = []
        for s in (lane.get("social") or []):
            net = s.get("network")
            if net in POSTABLE and s.get("status") != "disabled" \
                    and eng.social_post.token_path(slug, net).is_file():
                nets.append(net)
        out[slug] = nets
    return out


@router.get("")
def list_gaps(ident: dict = Depends(require_owner)):
    gaps = eng.market_gaps.load_gaps()
    channels = _channel_map()
    proposals = {}
    for slug in channels:
        rep = eng.market_gaps.load_report(slug)
        if rep:
            proposals[slug] = rep
    return {"gaps": gaps, "channels": channels, "proposals": proposals,
            "job_id": JOBS.running_for("_market_gaps", kinds=("market_gaps",)),
            "note": "Phase-0 demand tests — sell first. Success = spearhead interest, not GEO citations."}


class GenBody(BaseModel):
    gap_id: str
    brand_slug: str
    n: int = 5


@router.post("/generate")
def generate(body: GenBody, ident: dict = Depends(require_owner)):
    existing = JOBS.running_for("_market_gaps", kinds=("market_gaps",))
    if existing:
        return {"job_id": existing, "status": "running", "already_running": True}
    gap_id, slug, n = body.gap_id, body.brand_slug, max(1, min(body.n, 8))
    job_id = JOBS.enqueue_fn(
        "market_gaps", "_market_gaps",
        lambda progress: (progress(phase="draft", pct=15,
                                   log_line=f"drafting demand-test posts for gap #{gap_id} -> {slug}..."),
                          eng.market_gaps.run_and_store(slug, gap_id, n=n))[1])
    return {"job_id": job_id, "status": "queued"}


class PostBody(BaseModel):
    post_id: str
    dry_run: bool = True               # fail-safe: preview unless told to post
    platforms: list[str] = []          # empty = all connected on the lane


@router.post("/{slug}/post")
def post_one(slug: str, body: PostBody, ident: dict = Depends(require_owner)):
    rep = eng.market_gaps.load_report(slug)
    if not rep:
        raise HTTPException(404, "no market-gap proposal for this brand")
    hit = next((p for p in rep.get("posts", []) if p["id"] == body.post_id), None)
    if not hit:
        raise HTTPException(404, "unknown post id")
    bad = [p for p in body.platforms if p not in POSTABLE]
    if bad:
        raise HTTPException(400, f"not postable: {', '.join(bad)}")
    cmd = [sys.executable, str(ENGINE_DIR / "social_post.py"),
           "--lane", slug, "--text", hit["text"], "--ignore-cadence"]  # separate stream: no GEO cadence
    if body.platforms:
        cmd += ["--platforms", ",".join(body.platforms)]
    if body.dry_run:
        cmd += ["--dry-run"]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    try:
        raw = r.stdout
        out = json.loads(raw[raw.index("{"):raw.rindex("}") + 1])
    except Exception:
        raise HTTPException(502, f"poster returned no JSON: {(r.stderr or r.stdout)[:300]}")
    out["exit_code"] = r.returncode
    if not body.dry_run and (out.get("posted") or []):
        eng.market_gaps.set_post_status(slug, body.post_id, "posted")
        out["marked_posted"] = True
    return out


class IdBody(BaseModel):
    post_id: str


@router.post("/{slug}/dismiss")
def dismiss(slug: str, body: IdBody, ident: dict = Depends(require_owner)):
    try:
        return eng.market_gaps.set_post_status(slug, body.post_id, "dismissed")
    except ValueError as e:
        raise HTTPException(400, str(e))
