"""actions_service.py — per-client Recommended Actions: derive, prepare, track.

The GEO measure already tells us WHO the AIs cite instead (competitor_urls, typed
directory/review_site/reddit/quora/listicle/article/youtube). This service turns that
into a worked to-do list: "Take the action" generates everything automatable (via the
Claude subscription) — paste-ready listing copy, pitch emails, forum answers — plus
step-by-step instructions for the human-only clicks. Community platforms stay
human-posted (the permanent guardrail); we hand Cory the exact text to paste.

State: ~/.geo-flywheel/state/<slug>-actions.json
"""
from __future__ import annotations

import hashlib
import json
import re
import time
from pathlib import Path

from app import engine_bridge as eng

STATE_DIR = Path.home() / ".geo-flywheel" / "state"
_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")

# competitor host type -> action recipe
TYPE_MAP = {
    "directory": ("directory_claim", "Get listed on"),
    "review_site": ("directory_claim", "Claim + gather reviews on"),
    "reddit": ("forum_answer", "Answer the question on"),
    "quora": ("forum_answer", "Answer the question on"),
    "competitor_article": ("listicle_pitch", "Pitch inclusion to"),
    "youtube": ("video_gap", "Out-rank the cited video on"),
    "authority": ("listicle_pitch", "Pitch a citation to"),
}


def _path(slug: str) -> Path:
    # path-jail: a slug is only ever a simple token (defense in depth vs traversal chars)
    if not _SLUG_RE.match(slug or ""):
        raise ValueError(f"invalid slug '{slug}'")
    return STATE_DIR / f"{slug}-actions.json"


_YT_URL = re.compile(r"https?://(?:www\.)?(?:youtu\.be/|youtube\.com/watch\?v=)[\w-]+")


_BLOG_URL = re.compile(r"blog:(https?://\S+)")
_SHORTS_N = re.compile(r"shorts:(\d+)")


def _video_status(a: dict, lock_fresh: bool) -> dict:
    """Close the loop for a video_gap (now a full content BURST) so the UI can say plainly:
    made+posted (blog + video + shorts links), producing now, or NOT produced and why.
    Read-only (no network)."""
    note = a.get("execution_note") or ""
    st = a.get("status")
    m = _YT_URL.search(note)
    blog = _BLOG_URL.search(note)
    if m or (blog and blog.group(1) not in ("-", "->")):
        out = {"state": "published"}
        if m:
            out["url"] = m.group(0)
        if blog and blog.group(1) not in ("-", "->"):
            out["blog_url"] = blog.group(1).rstrip(".,")
        sh = _SHORTS_N.search(note)
        if sh and int(sh.group(1)) > 0:
            out["shorts"] = int(sh.group(1))
        return out
    if st == "working" and lock_fresh:
        return {"state": "producing", "reason": "producing the full set (blog + video + shorts) + posting to socials (~30-45 min)"}
    low = note.lower()
    if "nothing to produce" in low:   # the burst preflight: mixed per-kind reasons — show them verbatim
        return {"state": "blocked", "reason": note[:200]}
    if "channel-lock" in low:
        return {"state": "blocked", "reason": "channel-lock refused (the YouTube token does not "
                                              "resolve to this brand's channel) — reconnect it"}
    if "cadence at cap" in low:
        return {"state": "blocked", "reason": "weekly cap reached — raise the dial on this client "
                                              "or wait for the window to roll over"}
    if "recency gap" in low or "re-check" in low or a.get("status") == "hold":
        return {"state": "blocked", "reason": note[:160] or "already answered recently"}
    return {"state": "none"}


def load(slug: str) -> dict:
    try:
        doc = json.loads(_path(slug).read_text(encoding="utf-8"))
    except Exception:
        return {"generated_at": None, "actions": []}
    # watchdog (in-memory, write-free): a 'working' video action whose producer is no longer
    # running means the detached job died — show it honestly as re-takeable. Liveness is by PID
    # (recorded in the lock), not a 3-hour timer, so a dead job stops claiming "producing..."
    # within one refresh instead of hours later.
    lock = STATE_DIR / "action-jobs" / f"{slug}-video.lock"
    lock_fresh = eng.action_state.job_alive(lock)
    for a in doc.get("actions", []):
        if a.get("status") == "working" and not lock_fresh:
            a["status"] = "todo"
            a["execution_note"] = ("producer job ended without reporting back (died, was interrupted, "
                                   "or stopped early to 'wait' for a background render) — take it again")
        if a.get("kind") == "video_gap":
            a["video"] = _video_status(a, lock_fresh)
    return doc


def _save(slug: str, doc: dict) -> None:
    """Atomic per-PID-tmp write via the engine's shared helper. Call under eng.action_state.locked."""
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    _path(slug)  # slug validation (path-jail)
    eng.action_state.save_doc(slug, doc)


def refresh(slug: str, max_measure: int | None = None, progress=None) -> dict:
    """Fresh measure (no LLM drafting) -> derive the action list. Preserves the status +
    materials of actions that survive the re-derive (matched by id). ``progress`` is the
    optional jobs-runner callback (phase=, pct=, log_line=)."""
    tick = progress or (lambda **kw: None)
    good, _bad = eng.client_profile.load_all()
    profile = good.get(slug)
    if profile is None:
        raise ValueError(f"no valid profile for '{slug}'")
    tick(phase="measure", pct=10,
         log_line=f"measuring {len(profile.get('buyer_clusters') or [])} buyer questions live...")
    audit = eng.geo_audit.run_audit(profile, good, out_dir=STATE_DIR / "actions-audits" / slug,
                                    max_measure=max_measure, max_draft=0,
                                    draft_model=getattr(eng.geo_audit, "DRAFT_MODEL", "claude-sonnet-5"),
                                    no_llm=True)
    scorecard = (audit.get("audit") or audit).get("scorecard") or audit.get("scorecard") or []
    tick(phase="derive", pct=85, log_line="deriving actions from the competitor citations...")

    # derive + merge + save under the state lock: the detached producer may report back at any
    # moment, so prev must be read in the same critical section that writes the merged doc
    with eng.action_state.locked(slug):
        return _derive_and_save(slug, scorecard)


_YT_ID = re.compile(r"(?:youtu\.be/|[?&]v=|/shorts/|/embed/|/live/)([A-Za-z0-9_-]{6,20})")


def _own_youtube(slug: str, url: str) -> bool:
    """Is this cited YouTube URL one of OUR OWN published videos? (Winning the citation must
    not spawn a video_gap against ourselves.) Matched by video id against the asset catalog."""
    m = _YT_ID.search(url or "")
    if not m:
        return False
    vid = m.group(1)
    try:
        for r in eng.asset_library.find(brand=slug):
            if vid in (r.get("url") or ""):
                return True
    except Exception:
        pass
    return False


def _derive_and_save(slug: str, scorecard: list[dict]) -> dict:
    prev = {a["id"]: a for a in load(slug).get("actions", [])}
    actions, seen = [], set()
    # site health first: a crawler block makes every other action pointless until fixed
    for row in scorecard:
        sc = row.get("site_check")
        if sc and not sc.get("ok"):
            aid = hashlib.sha1(f"{slug}:site_fix".encode()).hexdigest()[:12]
            old = prev.get(aid, {})
            actions.append({
                "id": aid, "kind": "site_fix", "host": sc.get("domain", ""),
                "url": f"https://{sc.get('domain', '')}/robots.txt",
                "title": f"Fix site GEO health on {sc.get('domain', '')}",
                "cluster": "site health",
                "why": "Blocking issue before anything else can be cited: " + " · ".join(sc.get("issues", [])),
                "status": old.get("status", "todo"),
                "materials": old.get("materials"),
            })
            break
    for row in scorecard:
        if row.get("site_check") or row.get("cited") is True:
            continue
        cluster = row.get("cluster", "")
        for cu in (row.get("competitor_urls") or []):
            host, typ = cu.get("host", ""), cu.get("type", "competitor_article")
            kind, verb = TYPE_MAP.get(typ, ("listicle_pitch", "Pitch inclusion to"))
            # our own cited video is a WIN, not a competitor — never out-rank ourselves
            if kind == "video_gap" and _own_youtube(slug, cu.get("url", "")):
                continue
            # identity: claims/pitches are once-per-site, but video/forum answers are
            # per-question — one action per (kind, host) would collapse every cluster's
            # video gap into a single youtube.com action
            key = (f"{kind}:{host}:{cluster.lower()}" if kind in ("video_gap", "forum_answer")
                   else f"{kind}:{host}")
            if not host or key in seen:
                continue
            seen.add(key)
            aid = hashlib.sha1(f"{slug}:{key}".encode()).hexdigest()[:12]
            old = prev.get(aid, {})
            act = {
                "id": aid, "kind": kind, "host": host, "url": cu.get("url", ""),
                "title": f"{verb} {host}",
                "cluster": cluster,
                "why": f'The AIs cite {host} when buyers ask "{cluster}" '
                       f'({cu.get("engines", 1)} engine(s)). Get on it and you are in the answer.',
                "status": old.get("status", "todo"),
                "materials": old.get("materials"),
            }
            if old.get("execution_note"):
                act["execution_note"] = old["execution_note"]
            # recency-gap suppression: a fresh same-cluster published asset means the AIs just
            # haven't re-crawled yet — HOLD instead of recommending a duplicate production run
            if kind == "video_gap" and act["status"] in ("todo", "hold"):
                existing = eng.action_exec.existing_published_asset(slug, cluster)
                if existing:
                    act["status"] = "hold"
                    act["execution_note"] = (
                        f"already answered by {existing.get('url')} "
                        f"({str(existing.get('ts', ''))[:10]}) — waiting for the AI engines to "
                        f"re-crawl (recency gap). Re-measure after ~{eng.action_exec.RECRAWL_DAYS} days.")
                elif act["status"] == "hold":
                    act["status"] = "todo"   # the hold aged out — actionable again
                    act.pop("execution_note", None)
            actions.append(act)
    actions = actions[:15]
    # carry forward in-flight work the re-derive didn't reproduce: a 'working' video job
    # must keep its id (the producer reports back by id + releases the lane lock via it),
    # and prepared/sent materials must not be silently thrown away
    new_ids = {a["id"] for a in actions}
    carried = [a for a in prev.values()
               if a["id"] not in new_ids
               and (a.get("status") == "working"
                    or (a.get("materials") and a.get("status") in ("prepared", "sent")))]
    actions = carried + actions
    doc = {"generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
           "measured": len(scorecard), "actions": actions}
    _save(slug, doc)
    return doc


_PROMPTS = {
    "directory_claim": (
        "Create a paste-ready {host} listing for this business. Sections: Business name; One-line "
        "tagline (<=90 chars); Description (120-180 words, plain-spoken, no hype, ends with who it's "
        "for); 5 category/tag suggestions; the website URL to use. Then a numbered step-by-step for "
        "claiming/creating the listing on {host} (find the submit/claim page, what to fill where, "
        "typical review times, and note that if there's a standard listing fee we pay it — up to $100)."),
    "forum_answer": (
        "Draft a genuinely helpful answer for a {host} thread about \"{cluster}\". Rules: answer the "
        "question fully FIRST with specific, practical advice (numbers, steps, tradeoffs); one soft "
        "mention of {brand} near the end as 'what we do' with the domain, no salesy language; match "
        "{host} tone; 150-300 words. Then 3 numbered steps: find the best recent thread (search terms "
        "to use), what to check before posting (subreddit rules / account age), and posting etiquette. "
        "IMPORTANT: this must be posted BY A HUMAN — never automated."),
    "listicle_pitch": (
        "Write a ready-to-send inclusion pitch email to the editor of {host} asking to add {brand} to "
        "their article/list that the AIs cite for \"{cluster}\". Format EXACTLY: a first line "
        "'Subject: <subject>', a blank line, then the body. The body MUST begin with exactly "
        "\"Hi there,\" — the editor's name is unknown; NEVER write a placeholder like [Name] or "
        "[Editor's Name] and never invent a name. No [bracket placeholders] anywhere; every word "
        "must be ready to send verbatim. 120-180 word body: lead with what their readers gain "
        "(a concrete differentiator or stat), one-line description of {brand} ({domain}), offer to "
        "provide anything they need, zero flattery-fluff. Then numbered steps: find the contact "
        "(byline, about page, LinkedIn), send from support@{domain}, and follow up once after 5-7 days."),
    "site_fix": (
        "The site {host} has GEO health issues blocking AI citation. Produce: (1) a paste-ready "
        "/llms.txt for {brand} ({domain}) — one-paragraph site summary, key pages with one-line "
        "descriptions, contact; (2) the exact robots.txt lines to ALLOW GPTBot, PerplexityBot, "
        "ClaudeBot, Google-Extended and Bingbot (and what to remove if they are disallowed today); "
        "(3) numbered steps to deploy both files and re-test (fetch robots.txt + llms.txt, then "
        "re-run the audit). Keep it exact and copy-pasteable."),
    "video_gap": (
        "The AIs cite a YouTube video for \"{cluster}\" instead of {brand}. Write: a video brief to "
        "out-answer it — title (<=70 chars, question-first), 8-12 beat outline with the direct answer "
        "in the first 30 seconds, and a 2-3 sentence description with {domain} link placement. Then "
        "numbered steps: check the flywheel will pick it up (it produces weekly video) or produce it "
        "now, and where to put the video link on the site."),
}


def _update_action(slug: str, action_id: str, mutate) -> dict:
    """Re-load fresh state under the lock and mutate ONLY this action — never write back a doc
    read before a slow call (the detached producer writes the same file)."""
    with eng.action_state.locked(slug):
        doc = load(slug)
        act = next((a for a in doc.get("actions", []) if a["id"] == action_id), None)
        if act is None:
            raise ValueError("unknown action id — refresh the list")
        mutate(act)
        _save(slug, doc)
        return act


def take(slug: str, action_id: str, progress=None) -> dict:
    """Do everything automatable for one action: generate the deliverable + instructions."""
    tick = progress or (lambda **kw: None)
    act = next((a for a in load(slug).get("actions", []) if a["id"] == action_id), None)
    if act is None:
        raise ValueError("unknown action id — refresh the list")
    if act.get("status") in ("working", "done"):
        raise ValueError(f"action is already {act['status']}")
    if act.get("status") == "hold":
        raise ValueError("action is on hold (recency gap) — " + (act.get("execution_note") or ""))
    good, _bad = eng.client_profile.load_all()
    profile = good.get(slug) or {}
    brand = profile.get("brand", {})
    prompt = _PROMPTS[act["kind"]].format(
        host=act["host"], cluster=act.get("cluster", ""), brand=brand.get("name", slug),
        domain=brand.get("domain", ""))
    voice = brand.get("voice", "")
    tick(phase="generate", pct=15,
         log_line=f"generating the {act['kind']} deliverable (Claude subscription)...")
    text = eng.claude_local.run(       # slow (30-90s) — runs OUTSIDE the state lock
        prompt + (f"\n\nBrand voice to write in: {voice}" if voice else ""),
        system="You produce paste-ready marketing deliverables. Output the deliverable directly - "
               "no preamble, no 'here is', no markdown code fences. Use clear section labels and "
               "numbered steps exactly as asked.",
        max_tokens=1600)
    if not text:
        raise RuntimeError("generation failed (subscription CLI and API both unavailable)")

    def _prepared(a):
        a["materials"] = {"text": text, "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                          "target_url": a.get("url", "")}
        a["status"] = "prepared"
    act = _update_action(slug, action_id, _prepared)  # materials persist BEFORE executing

    # then take the action to its full automatable extent (produce+post video, send pitch, ...)
    tick(phase="execute", pct=70, log_line="executing the automatable part (post/send/produce)...")
    outcome: dict = {}
    try:
        result = eng.action_exec.execute(slug, act, text)
        outcome = {"status": result.get("status"), "note": result.get("note", "")}
    except Exception as e:
        outcome = {"status": None,
                   "note": f"execution failed: {str(e)[:200]} — materials above are still usable"}

    def _executed(a):
        if outcome.get("status"):
            a["status"] = outcome["status"]
        a["execution_note"] = outcome.get("note", "")
    return _update_action(slug, action_id, _executed)


def set_status(slug: str, action_id: str, status: str) -> dict:
    if status not in ("todo", "prepared", "done", "dismissed", "hold"):
        raise ValueError("bad status")

    def _set(a):
        a["status"] = status
    return _update_action(slug, action_id, _set)
