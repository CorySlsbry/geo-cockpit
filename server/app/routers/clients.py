"""clients.py — client roster, detail, arm/disarm."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Body
from pydantic import BaseModel

from app.auth import require_user, require_owner, visible_slugs, ensure_slug_visible
from app.services import clients_service as svc

router = APIRouter(prefix="/api/clients", tags=["clients"])


@router.get("")
def list_clients(ident: dict = Depends(require_user)):
    return svc.summaries(visible_slugs(ident))


@router.get("/{slug}")
def client_detail(slug: str, ident: dict = Depends(require_user)):
    vis = visible_slugs(ident)
    if vis is not None and slug not in vis:
        raise HTTPException(403, "not permitted")
    return svc.detail(slug)


class ArmReq(BaseModel):
    confirm_slug: str


@router.post("/{slug}/arm")
def arm(slug: str, req: ArmReq, ident: dict = Depends(require_owner)):
    if req.confirm_slug != slug:
        raise HTTPException(400, "confirm_slug must equal the client slug")
    try:
        return svc.set_dry_run(slug, dry_run=False)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/{slug}/disarm")
def disarm(slug: str, ident: dict = Depends(require_owner)):
    try:
        return svc.set_dry_run(slug, dry_run=True)
    except ValueError as e:
        raise HTTPException(400, str(e))



@router.post("/{slug}/enable")
def enable(slug: str, ident: dict = Depends(require_owner)):
    """Switch the client's lane ON. Distinct from /arm: this controls whether the lane RUNS."""
    try:
        return svc.set_enabled(slug, True)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/{slug}/disable")
def disable(slug: str, ident: dict = Depends(require_owner)):
    """Switch the client's lane OFF. Nothing is deleted; config, state and history are preserved."""
    try:
        return svc.set_enabled(slug, False)
    except ValueError as e:
        raise HTTPException(400, str(e))


from app.services import actions_service as acts
from app.services.jobs import JOBS

_ACTION_KINDS = ("actions_refresh", "action_take")


@router.get("/{slug}/actions")
def get_actions(slug: str, ident: dict = Depends(require_user)):
    vis = visible_slugs(ident)
    if vis is not None and slug not in vis:
        raise HTTPException(403, "not permitted")
    doc = acts.load(slug)
    doc["job_id"] = JOBS.running_for(slug, kinds=_ACTION_KINDS)  # surface an in-flight job to the UI
    return doc


@router.get("/{slug}/actions/{action_id}/video-verify")
def verify_video(slug: str, action_id: str, ident: dict = Depends(require_user)):
    """Confirm a video_gap's published video is real + on the CORRECT channel (public oembed vs
    the lane's lanes.json channel). Answers 'was it created + posted, to the right place?'."""
    vis = visible_slugs(ident)
    if vis is not None and slug not in vis:
        raise HTTPException(403, "not permitted")
    act = next((a for a in acts.load(slug).get("actions", []) if a["id"] == action_id), None)
    if not act:
        raise HTTPException(404, "unknown action id")
    url = (act.get("video") or {}).get("url")
    if not url:
        return {"published": False, "reason": "no published video for this action yet"}
    import json as _json
    import urllib.request as _u
    from app import engine_bridge as eng
    expected = (eng.yt_channel_guard.lane_youtube(slug) or {}).get("channel_name", "")
    try:
        oe = _u.urlopen(f"https://www.youtube.com/oembed?url={_u.quote(url, safe='')}&format=json",
                        timeout=15)
        data = _json.loads(oe.read())
        actual = data.get("author_name", "")
        return {"published": True, "url": url, "title": data.get("title"),
                "actual_channel": actual, "expected_channel": expected,
                "verified": bool(expected) and actual.strip().lower() == expected.strip().lower(),
                "channel_url": data.get("author_url")}
    except Exception as e:
        return {"published": True, "url": url, "verified": None,
                "reason": f"could not confirm the channel live ({str(e)[:80]})"}


@router.get("/{slug}/brand-rules")
def brand_rules(slug: str, ident: dict = Depends(require_user)):
    """CREATIVE REFERENCE (Cory's hard rule 2026-07-19): which brand this lane's blog posts,
    long-form videos, shorts, and social posts are created UNDER — and which portfolio brand names
    must never appear. Same data the cycle prompt and brand_guard enforce, so the cockpit can never
    drift from the runbook."""
    vis = visible_slugs(ident)
    if vis is not None and slug not in vis:
        raise HTTPException(403, "not permitted")
    r = eng.brand_guard.rule(slug)
    return {"lane": slug, "declared": bool(r), "rule": r,
            "forbidden": eng.brand_guard.forbidden_names(slug) if r else [],
            "portfolio": eng.brand_guard.portfolio()}


class BrandCheckReq(BaseModel):
    text: str


@router.post("/{slug}/brand-rules/check")
def brand_rules_check(slug: str, req: BrandCheckReq, ident: dict = Depends(require_user)):
    """Check a draft caption/description/post against the lane's brand-lock before it ships."""
    vis = visible_slugs(ident)
    if vis is not None and slug not in vis:
        raise HTTPException(403, "not permitted")
    return eng.brand_guard.check(slug, req.text)


@router.post("/{slug}/actions/refresh")
def refresh_actions(slug: str, ident: dict = Depends(require_owner)):
    """Queue the refresh as a background job (a live measure takes 1-4 min); the SPA follows
    /api/jobs/{id} + its SSE stream instead of holding this request open."""
    existing = JOBS.running_for(slug, kinds=_ACTION_KINDS)
    if existing:
        return {"job_id": existing, "status": "running", "already_running": True}
    job_id = JOBS.enqueue_fn("actions_refresh", slug,
                             lambda progress: acts.refresh(slug, progress=progress))
    return {"job_id": job_id, "status": "queued"}


@router.post("/{slug}/actions/{action_id}/take")
def take_action(slug: str, action_id: str, ident: dict = Depends(require_owner)):
    """Queue the take as a background job (generation + execution can run minutes)."""
    if not any(a["id"] == action_id for a in acts.load(slug).get("actions", [])):
        raise HTTPException(400, "unknown action id — refresh the list")
    existing = JOBS.running_for(slug, kinds=_ACTION_KINDS)
    if existing:
        return {"job_id": existing, "status": "running", "already_running": True}
    job_id = JOBS.enqueue_fn("action_take", slug,
                             lambda progress: acts.take(slug, action_id, progress=progress))
    return {"job_id": job_id, "status": "queued"}


class ActionStatusReq(BaseModel):
    status: str


@router.post("/{slug}/actions/{action_id}/status")
def action_status(slug: str, action_id: str, req: ActionStatusReq, ident: dict = Depends(require_owner)):
    try:
        return acts.set_status(slug, action_id, req.status)
    except ValueError as e:
        raise HTTPException(400, str(e))


class CadenceReq(BaseModel):
    # partial update: only the kinds being changed, e.g.
    # {"updates": {"blog_posts": {"count": 1, "per": "day"}}}
    updates: dict[str, dict]


@router.post("/{slug}/cadence")
def set_cadence(slug: str, req: CadenceReq, ident: dict = Depends(require_owner)):
    try:
        return svc.set_cadence(slug, req.updates)
    except ValueError as e:
        raise HTTPException(400, str(e))


class VideoFormatReq(BaseModel):
    # A preset name (vertical|wide|square|vertical_hd|wide_4k), an alias (9:16, portrait,
    # landscape, tiktok…) or an explicit WxH. Validated in the engine, which raises on a typo
    # rather than falling back to 16:9.
    format: str


@router.post("/{slug}/video-format")
def set_video_format(slug: str, req: VideoFormatReq, ident: dict = Depends(require_owner)):
    """Set the output size for this lane's renders."""
    try:
        return svc.set_video_format(slug, req.format)
    except ValueError as e:
        raise HTTPException(400, str(e))


class ShortStyleReq(BaseModel):
    # A short_style preset name (episodes | episodes_ugc | ugc_heavy | avatar_only). Validated
    # in the engine registry, which raises on unknown styles AND on lanes a style is not
    # enabled for — the ugc styles are SaaS-lane-only.
    style: str


@router.post("/{slug}/short-style")
def set_short_style(slug: str, req: ShortStyleReq, ident: dict = Depends(require_owner)):
    """Set the lane's reel style (rewrites mode_rotation in lanes.json atomically)."""
    try:
        return svc.set_short_style(slug, req.style)
    except ValueError as e:
        raise HTTPException(400, str(e))


class NarrationReq(BaseModel):
    # Per video kind: "narrated" (default) or "character" (Cory 2026-08-20 - the character-led
    # mode where the characters are the only voices). Validated in the service; unknown RAISES.
    kind: str
    mode: str


@router.post("/{slug}/narration")
def set_narration(slug: str, req: NarrationReq, ident: dict = Depends(require_owner)):
    """Narrated vs character-led, per video kind. The engine reads this from the profile
    (episode_engine._video_prefs), so it is enforced at render time, not at prompt time."""
    try:
        return svc.set_narration(slug, req.kind, req.mode)
    except ValueError as e:
        raise HTTPException(400, str(e))


class CharacterVoicesReq(BaseModel):
    # The FIXED ElevenLabs voice id per character role. Empty string clears a role.
    female: str = ""
    male: str = ""
    bot: str = ""


@router.post("/{slug}/character-voices")
def set_character_voices(slug: str, req: CharacterVoicesReq, ident: dict = Depends(require_owner)):
    """Pin each character role to one voice, so characters keep their voice across videos."""
    try:
        return svc.set_character_voices(slug, {"female": req.female, "male": req.male, "bot": req.bot})
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/voices/eleven")
def list_voices(ident: dict = Depends(require_user)):
    """The account's real ElevenLabs voices for the dropdowns. [] when unreachable - the UI
    falls back to a paste-an-id input rather than lying with a stale list."""
    return {"voices": svc.list_eleven_voices()}


# ---- search-demand research: run as a job -> stored proposal -> owner applies ----
from app import engine_bridge as eng  # noqa: E402


@router.get("/{slug}/research")
def get_research(slug: str, ident: dict = Depends(require_user)):
    vis = visible_slugs(ident)
    if vis is not None and slug not in vis:
        raise HTTPException(403, "not permitted")
    return {"report": eng.cluster_research.load_report(slug),
            "job_id": JOBS.running_for(slug, kinds=("cluster_research",))}


@router.post("/{slug}/research")
def run_research(slug: str, ident: dict = Depends(require_owner)):
    """Queue demand research (Google autocomplete + AI-engine common questions) as a job.
    Stores a pending proposal; nothing changes the profile until Apply."""
    existing = JOBS.running_for(slug, kinds=("cluster_research",))
    if existing:
        return {"job_id": existing, "status": "running", "already_running": True}
    job_id = JOBS.enqueue_fn(
        "cluster_research", slug,
        lambda progress: (progress(phase="research", pct=15,
                                   log_line="researching real search demand (autocomplete + AI engines)..."),
                          eng.cluster_research.run_and_store(slug))[1])
    return {"job_id": job_id, "status": "queued"}


@router.post("/{slug}/research/apply")
def apply_research(slug: str, ident: dict = Depends(require_owner)):
    """Apply the stored pending research to buyer_clusters (validated atomic write)."""
    try:
        rep = eng.cluster_research.apply_stored(slug)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True, "report": rep}


# ── Buyer-question hygiene ────────────────────────────────────────────────────────────────
# Onboarding seeds buyer_clusters with an inference from the homepage — a guess, and sometimes a
# bad one. Those guesses drive every measure, topic pick and post, and there was no way to retire
# them short of hand-editing JSON. Available for EVERY client, not just the one being viewed.

@router.get("/{slug}/clusters/status")
def clusters_status(slug: str, ident: dict = Depends(require_owner)):
    """Per-term provenance: where each buyer question came from and how old it is."""
    return eng.cluster_hygiene.status(slug)


@router.post("/{slug}/clusters/clear")
def clusters_clear(slug: str, ident: dict = Depends(require_owner)):
    """Remove every buyer question for this client."""
    return eng.cluster_hygiene.clear_all(slug)


@router.post("/{slug}/clusters/clear-inferred")
def clusters_clear_inferred(slug: str, ident: dict = Depends(require_owner)):
    """Remove only the guesses; researched and hand-entered questions survive."""
    return eng.cluster_hygiene.clear_inferred(slug)


# A hand-entered longtail target. The meta schema has carried "manual" provenance since
# cluster_hygiene was written and clear_inferred already promises hand-entered terms survive, but
# nothing could CREATE one: the operator's only route in was editing the client JSON by hand, which
# is the exact thing that module exists to prevent. (Cory 2026-08-20)

@router.post("/{slug}/clusters/add")
def clusters_add(slug: str, body: dict = Body(...), ident: dict = Depends(require_owner)):
    """Add one hand-entered buyer question, stamped `manual`. Idempotent: a term that already
    exists (case-insensitively) is reported back rather than duplicated, because two spellings of
    one question split the measurement and make the trend look like it moved when it did not."""
    term = str((body or {}).get("term") or "")
    try:
        return eng.cluster_hygiene.add_manual(slug, term)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/{slug}/clusters/remove")
def clusters_remove(slug: str, body: dict = Body(...), ident: dict = Depends(require_owner)):
    """Remove one term. Lets an operator undo a typo without reaching for clear-all, which would
    take the researched set with it."""
    term = str((body or {}).get("term") or "")
    try:
        return eng.cluster_hygiene.remove_term(slug, term)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/{slug}/clusters/prune")
def clusters_prune(slug: str, days: int = 30, ident: dict = Depends(require_owner)):
    """Cycle out questions older than `days` (default 30). A term whose date cannot be parsed is
    KEPT — this is a freshness tool, and deleting something because its date was malformed would
    be the worst available outcome."""
    if days < 1:
        raise HTTPException(400, "days must be >= 1")
    return eng.cluster_hygiene.prune_older_than(slug, days)

# --- Run-one: fire a single asset on demand (Cory 2026-08-12) ----------------------------
# The cadence dials say WHEN; this says "do one NOW". Each row maps to its own Windows task
# (lanes.json task_name / longform_task_name / shorts_task_name) and NOT every lane has all
# three — an unmapped row must report that honestly instead of pretending it fired.

_RUN_TARGETS = {
    "blog_posts": "cycle",        # the full cycle; it leads with the blog post
    "longform_videos": "longform",
    "shorts": "shorts",
}


class ChainReq(BaseModel):
    phrase: str
    # Run a SUBSET of the pipeline (the per-step buttons). Empty/absent = the full chain, so
    # every existing caller keeps its behaviour byte for byte.
    only: list[str] | None = None
    # The already-published post the non-blog steps aim at. Required for those steps.
    post_slug: str | None = None


@router.get("/{slug}/chain")
def chain_status(slug: str, ident: dict = Depends(require_user)):
    return svc.chain_status(slug)


@router.get("/{slug}/posts")
def recent_posts(slug: str, limit: int = 5, ident: dict = Depends(require_user)):
    """The lane's most recent posts — what a single step can be pointed at."""
    return svc.recent_posts(slug, limit)


@router.post("/{slug}/chain")
def run_chain(slug: str, req: ChainReq, ident: dict = Depends(require_owner)):
    """One longtail phrase -> the whole workflow (blog -> longform | short | still), detached,
    or just the steps named in `only`. Owner-only: this spends real money and publishes to every
    connected surface."""
    try:
        return svc.run_chain(slug, req.phrase, actor=ident.get("sub", "owner"),
                             only=req.only, post_slug=req.post_slug or "")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


class RunOneReq(BaseModel):
    kind: str
    source: str = "topic"          # "topic" = pick by coverage | "blog" = build from a published post
    source_ref: str | None = None  # a post slug/url when source == "blog"


@router.get("/{slug}/run-one")
def run_one_status(slug: str, ident: dict = Depends(require_user)):
    """Which rows can actually be run for this lane, so the UI can disable the rest."""
    ensure_slug_visible(ident, slug)
    from app import engine_bridge as eng
    task_for = getattr(getattr(eng, "cadence_dispatch", None), "task_for", None)
    out = {}
    for kind, target in _RUN_TARGETS.items():
        task = None
        try:
            task = task_for(slug, target) if task_for else None
        except Exception:
            task = None
        out[kind] = {"runnable": bool(task), "task": task,
                     "reason": None if task else f"no {target} task mapped for this lane"}
    out["social_posts"] = {"runnable": False, "task": None,
                           "reason": "social posts publish from the Social page (needs text/media)"}
    return {"slug": slug, "targets": out}


@router.post("/{slug}/run-one")
def run_one(slug: str, req: RunOneReq, ident: dict = Depends(require_owner)):
    ensure_slug_visible(ident, slug)
    target = _RUN_TARGETS.get(req.kind)
    if not target:
        raise HTTPException(400, f"'{req.kind}' cannot be run on demand from here")
    if req.source not in ("topic", "blog"):
        raise HTTPException(400, "source must be 'topic' or 'blog'")
    if req.source == "blog" and not (req.source_ref or "").strip():
        raise HTTPException(400, "source_ref (a published post) is required when source='blog'")
    try:
        return svc.run_one(slug, req.kind, target, req.source, req.source_ref,
                           actor=ident.get("email", "owner"))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except PermissionError as e:
        raise HTTPException(409, str(e))
