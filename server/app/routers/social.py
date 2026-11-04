"""social.py — ad-hoc social posting, decoupled from the GEO flywheel.

Post to any brand's connected accounts on the fly (announcements, promos, anything
that isn't flywheel content). It drives the SAME lane-locked engine poster
(social_post.py), so every guardrail holds: per-brand tokens only, community
platforms untouchable, and the client's social_post cadence enforced unless the
owner explicitly overrides for a post.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app import engine_bridge as eng
from app.auth import require_user, require_owner, visible_slugs

router = APIRouter(prefix="/api/social", tags=["social"])

ENGINE_DIR = Path(eng.social_post.__file__).parent
LANES_PATH = ENGINE_DIR.parent / "lanes.json"
NEEDS_MEDIA = sorted(eng.social_post.NEEDS_MEDIA)
POSTABLE = set(eng.social_post.HANDLERS)


def _lanes() -> dict:
    return json.loads(LANES_PATH.read_text(encoding="utf-8"))


def _lock_verdict(slug: str, network: str) -> dict | None:
    """Deterministic account-lock status for the UI: is the on-disk token FOR the account
    lanes.json expects? None when no token is connected yet (nothing to verify)."""
    if not eng.social_post.token_path(slug, network).is_file():
        return None
    g = eng.social_guard.assert_account(slug, network)
    return {"ok": g["ok"], "matched_on": g.get("matched_on"),
            "reason": None if g["ok"] else g["reason"]}


@router.get("/accounts")
def accounts(ident: dict = Depends(require_user)):
    """Each visible lane's postable networks + whether a token is on disk (a scoped
    client role sees only its own lane; owner/team see all)."""
    vis = visible_slugs(ident)
    out = []
    for slug, lane in _lanes().items():
        if slug.startswith("_") or not isinstance(lane, dict):
            continue
        if vis is not None and slug not in vis:
            continue
        socials = [s for s in lane.get("social", []) if s.get("network") in POSTABLE]
        if not socials:
            continue
        cad = eng.cadence.allowance(slug, "social_post")
        out.append({
            "lane": slug,
            "name": lane.get("brand", {}).get("name", slug) if isinstance(lane.get("brand"), dict) else slug,
            "cadence": {"governed": cad["governed"], "used": cad["used"],
                        "limit": cad["limit"], "per": cad["per"], "remaining": cad["remaining"]},
            "networks": [{
                "network": s["network"],
                "handle": s.get("handle", ""),
                "status": s.get("status", ""),
                "has_token": eng.social_post.token_path(slug, s["network"]).is_file(),
                "needs_media": s["network"] in NEEDS_MEDIA,
                "lock": _lock_verdict(slug, s["network"]),
            } for s in socials],
        })
    return {"lanes": out, "needs_media": NEEDS_MEDIA}


class PostReq(BaseModel):
    lane: str
    text: str = Field(min_length=1, max_length=5000)
    link: str = ""
    media_url: str = ""
    platforms: list[str] = []          # empty = all connected
    dry_run: bool = True               # fail-safe default: preview unless told to post
    ignore_cadence: bool = False       # owner's explicit per-post override


@router.post("/post")
def post(req: PostReq, ident: dict = Depends(require_owner)):
    if req.lane not in _lanes():
        raise HTTPException(400, f"unknown lane '{req.lane}'")
    bad = [p for p in req.platforms if p not in POSTABLE]
    if bad:
        raise HTTPException(400, f"not postable: {', '.join(bad)}")
    cmd = [sys.executable, str(ENGINE_DIR / "social_post.py"),
           "--lane", req.lane, "--text", req.text]
    if req.link:
        cmd += ["--link", req.link]
    if req.media_url:
        cmd += ["--media-url", req.media_url]
    if req.platforms:
        cmd += ["--platforms", ",".join(req.platforms)]
    if req.dry_run:
        cmd += ["--dry-run"]
    if req.ignore_cadence:
        cmd += ["--ignore-cadence"]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    try:
        # social_post prints one JSON object (indented) — parse the full brace span
        raw = r.stdout
        body = json.loads(raw[raw.index("{"):raw.rindex("}") + 1])
    except Exception:
        raise HTTPException(502, f"poster returned no JSON: {(r.stderr or r.stdout)[:300]}")
    body["exit_code"] = r.returncode          # 3 = cadence cap reached
    return body


@router.get("/recent")
def recent(limit: int = 20, ident: dict = Depends(require_user)):
    """Tail of the engine's social-log, scoped to the caller's visible lanes."""
    vis = visible_slugs(ident)
    path = Path(eng.social_post.LOG_PATH)
    if not path.is_file():
        return {"posts": []}
    lines = path.read_text(encoding="utf-8").splitlines()
    posts = []
    for line in reversed(lines[-max(1, min(limit, 100)) * 4:]):
        try:
            p = json.loads(line)
        except Exception:
            continue
        if vis is not None and p.get("lane") not in vis:
            continue
        posts.append(p)
        if len(posts) >= limit:
            break
    return {"posts": posts}
