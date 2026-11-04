"""
review_service.py — the human-in-the-loop cockpit logic (the north-star surface).

The engine already split the two lanes on the audit: draft-channel targets become copy-only Slack
kits (slack_kit.build_kits), owned/auto targets carry the real draft. This service:
  * serves those two lanes for one audit job,
  * lets an owner EDIT a target's fields, then RE-RUNS the deterministic brand-safety gate on the
    edited text (a foreign domain or an em-dash flips the gate red and the UI disables Approve),
  * POSTS an owned/auto target through social_post — always with dry_run=is_dry_run(profile), so an
    unarmed client only ever gets a plan back. Community targets are copy-only and have NO post path.
"""
from __future__ import annotations

import datetime
import json

from app.config import DATA_DIR
from app import engine_bridge as eng
from app.services.jobs import JOBS

cp = eng.client_profile
COMMUNITY = eng.client_profile.COMMUNITY_TYPES
_ACTION_LOG = DATA_DIR / "cockpit-actions.jsonl"


def _forbidden(slug: str) -> list[str]:
    good, _ = cp.load_all()
    p = good.get(slug)
    return cp.other_domains(p, good) if p else []


def _body_of(target: dict) -> str:
    """The main prose field of a target = the longest field value (the draft body)."""
    vals = [(f.get("label", ""), str(f.get("value") or "")) for f in target.get("fields") or []]
    if not vals:
        return ""
    return max(vals, key=lambda lv: len(lv[1]))[1]


def _regate(text: str, slug: str) -> tuple[bool, str]:
    ok, reason = eng.verify_core.deterministic_gate(text, [], _forbidden(slug),
                                                    max_chars=100000, forbid_emdash=True)
    return ok, ("ok" if ok else reason)


def review(job_id: str) -> dict:
    result = JOBS.result(job_id)
    if not result:
        raise ValueError("audit not found or not finished")
    audit = result["audit"]
    targets = audit.get("targets") or []
    owned = [t for t in targets if t.get("channel") == "auto"]
    kits = result.get("slack_kits") or eng.slack_kit.build_kits(audit)
    return {
        "job_id": job_id, "slug": audit["slug"],
        "brand": audit.get("brand", {}),
        "dry_run": audit.get("dry_run", True),
        "summary": audit.get("summary", {}),
        "owned": owned,          # approve-to-post lane
        "kits": kits,            # community copy-only lane
    }


def edit_target(job_id: str, rank: int, fields: list[dict]) -> dict:
    result = JOBS.result(job_id)
    if not result:
        raise ValueError("audit not found")
    audit = result["audit"]
    slug = audit["slug"]
    target = next((t for t in audit.get("targets") or [] if t.get("rank") == rank), None)
    if not target:
        raise ValueError(f"no target #{rank}")
    # merge edited field values by label
    by_label = {f.get("label"): f.get("value") for f in fields}
    for f in target.get("fields") or []:
        if f.get("label") in by_label:
            f["value"] = by_label[f["label"]]
    # Gate EVERY field value, not just the body — a foreign domain or em-dash anywhere fails.
    joined = "\n".join(str(f.get("value") or "") for f in target.get("fields") or [])
    ok, reason = _regate(joined, slug)
    target["gate"] = reason
    # keep kits in sync if this was a draft target
    result["slack_kits"] = eng.slack_kit.build_kits(audit)
    JOBS.save_result(job_id, result)
    return {"rank": rank, "gate": reason, "gate_ok": ok, "fields": target.get("fields")}


def _log_action(record: dict) -> None:
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        record = {"ts": datetime.datetime.now().isoformat(timespec="seconds"), **record}
        with _ACTION_LOG.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")
    except Exception:
        pass


def _find_auto_channel(profile: dict, ptype: str, post_url: str) -> dict:
    for ch in cp.auto_channels(profile):
        if ch.get("type") == ptype and (not post_url or ch.get("post_url") == post_url):
            return ch
    for ch in cp.auto_channels(profile):
        if ch.get("type") == ptype:
            return ch
    return {"type": ptype, "post_url": post_url}


def _enqueue_gap_topic(slug: str, target: dict, actor: str) -> dict:
    """Turn a posted citation gap into a QUEUED FLYWHEEL TOPIC (Cory 2026-08-12).

    The audit already knows the buyer question the brand is absent for — it is sitting in the
    target's `why` ("Brand is absent for '<question>'"). Posting an answer rents a spot on
    someone else's domain; the durable fix is the OWNED asset. This drops that exact question
    into the topic queue so the next cycle builds the blog + long-form video + social package
    that earns the citation permanently.

    ⛔ NEVER let a queue problem fail a real post. This runs after the post has already been
    attempted and swallows everything — the social result is the user's actual outcome."""
    try:
        why = target.get("why") or target.get("rationale") or ""
        q = eng.topic_queue.normalize_question(why) or (target.get("question") or "").strip()
        if len(q) < 8:
            return {"queued": False, "reason": "no question on target"}
        return eng.topic_queue.enqueue(
            slug, q,
            source="cockpit-post",
            platform=str(target.get("type") or ""),
            rank=target.get("rank"),
            evidence=str(why)[:400],
        )
    except Exception as e:  # noqa: BLE001 - deliberately total
        return {"queued": False, "reason": f"topic-queue error: {e}"}


def post_target(job_id: str, rank: int, actor: str) -> dict:
    result = JOBS.result(job_id)
    if not result:
        raise ValueError("audit not found")
    audit = result["audit"]
    slug = audit["slug"]
    target = next((t for t in audit.get("targets") or [] if t.get("rank") == rank), None)
    if not target:
        raise ValueError(f"no target #{rank}")
    if target.get("channel") != "auto":
        raise PermissionError("community targets are copy-only and cannot be auto-posted")
    ptype = target.get("type")
    if ptype in COMMUNITY:
        raise PermissionError(f"'{ptype}' is a community platform (copy-only)")

    good, _ = cp.load_all()
    profile = good.get(slug) or cp.load(slug)
    dry = cp.is_dry_run(profile)

    # Brand-safety gate MUST hold at the post boundary — never trust the client's gate state.
    # Re-run the deterministic gate over EVERY field; refuse to post if a foreign domain or em-dash
    # slipped in (a direct API call or a UI race could otherwise post it to a live channel when armed).
    joined = "\n".join(str(f.get("value") or "") for f in target.get("fields") or [])
    gate_ok, gate_reason = _regate(joined, slug)
    if not gate_ok:
        raise PermissionError(f"brand-safety gate failed ({gate_reason}); edit the draft before posting")

    body = _body_of(target)
    b = cp.brand(profile)
    services = b.get("services_link") or (f"https://{b.get('domain')}" if b.get("domain") else "")
    sp = eng.social_post

    # ⛔ PER-KIND SWITCH. This path publishes for real — post_owned_blog git-deploys to the brand's
    # own site, and the linkedin branch calls the handler directly rather than going through
    # social_post.main(). Neither ever consulted cadence, so a kind switched off in the cockpit was
    # still publishable from the Review screen. dry_run stays allowed so a preview still renders.
    _KIND_OF = {"owned_blog": "blog_post", "owned_site": "blog_post", "newsroom": "blog_post",
                "gbp": "social_post", "google_business": "social_post", "google-business": "social_post",
                "linkedin": "social_post", "linkedin_company": "social_post"}
    _kind = _KIND_OF.get(ptype)
    if _kind and not dry and not eng.cadence.is_kind_enabled(slug, _kind, profile=profile):
        raise PermissionError(
            f"{_kind} is switched OFF for {slug} in its publishing cadence. "
            f"Switch it on in the cockpit before posting this.")

    if ptype in ("owned_blog", "owned_site", "newsroom"):
        ch = _find_auto_channel(profile, ptype, target.get("post_url"))
        # Pass the slug so the publisher resolves THIS lane's blog config (single publish path).
        res = sp.post_owned_blog(ch, body, dry_run=dry, slug=slug)
    elif ptype in ("gbp", "google_business", "google-business"):
        res = sp.post_gbp(slug, None, body, services, dry_run=dry)
    elif ptype in ("linkedin", "linkedin_company"):
        tok = sp.load_token(slug, "linkedin")
        caption = (body + (("\n\n" + services) if services else "")).strip()
        if dry:
            res = {"ok": True, "dry_run": True, "network": "linkedin",
                   "plan": {"chars": len(caption), "link": services}}
        elif not tok:
            res = {"ok": False, "reason": f"no linkedin token — connect it first "
                   f"(~/.social-tokens/{slug}/linkedin.json)"}
        else:
            res = sp.HANDLERS["linkedin"](slug, tok, caption, services)
    elif ptype in ("instagram", "tiktok", "youtube"):
        res = {"ok": False, "needs_media": True,
               "reason": f"{ptype} needs a rendered public video — post it via the video pipeline, not the cockpit"}
    else:
        res = {"ok": False, "reason": f"no cockpit poster for '{ptype}'"}

    # Feed the flywheel: the gap we just answered becomes an owned-asset topic.
    # Enqueue on a genuine post OR a dry-run simulation (the gap is real either way); skip only
    # when the post itself failed, so a broken channel does not silently fill the backlog.
    topic = {"queued": False, "reason": "post failed"}
    if res.get("ok"):
        topic = _enqueue_gap_topic(slug, target, actor)

    _log_action({"kind": "post", "slug": slug, "platform": ptype, "rank": rank,
                 "dry_run": dry, "ok": bool(res.get("ok")), "actor": actor,
                 "reason": res.get("reason"), "topic_queued": topic.get("status")})
    return {"result": res, "dry_run": dry, "platform": ptype, "topic": topic}

def list_topics(slug: str, status: str = "queued") -> list[dict]:
    """Read the lane's citation-gap queue. Never raises — an unreadable queue shows as empty
    rather than breaking the Review screen."""
    try:
        return eng.topic_queue.list_topics(slug, status)
    except Exception:  # noqa: BLE001
        return []
