"""
clients_service.py — client roster, detail, and the ARM/disarm writer.

Reads go through client_profile (the single source of truth). Arming is the ONE place the cockpit
mutates a profile: it flips dry_run and writes it back atomically, but ONLY after re-validating —
we never write a profile the engine's fail-closed validator would reject.
"""
from __future__ import annotations

import json
import os
import re

from app import engine_bridge as eng
from app.services import connections

cp = eng.client_profile


def _cadence_view(slug: str, p: dict) -> dict:
    """Normalized per-kind cadence + live usage in the current trailing window."""
    cad = eng.cadence
    out = {}
    for kind in cad.KINDS:
        a = cad.allowance(slug, kind, profile=p)
        out[cad.PROFILE_KEYS[kind]] = {
            "count": a["limit"], "per": a["per"],
            "used": a["used"], "remaining": a["remaining"],
            "paused": bool(a.get("paused")),
            # Distinct from `paused`: paused is true when the dial is 0 OR the switch is off,
            # enabled is only the switch. The UI needs them apart so a kind switched off still
            # shows the dial it will return to.
            "enabled": bool(a.get("enabled", True)),
        }
    return out


def _client_dict(slug: str, p: dict) -> dict:
    b = cp.brand(p)
    return {
        "slug": slug,
        "name": b.get("name", slug),
        "domain": b.get("domain", ""),
        "logo_url": b.get("logo_url", ""),
        "voice": b.get("voice", ""),
        "services_link": b.get("services_link", ""),
        "dry_run": cp.is_dry_run(p),
        "armed": not cp.is_dry_run(p),
        # ⛔ `enabled` is NOT `armed`. enabled=False means the lane never runs at all (the
        # dispatcher skips it, cost = one file read). armed=False means it runs the FULL cycle
        # and only withholds publishing, which still costs renders and paid API calls.
        "enabled": bool(p.get("enabled", True)),
        "recurring": bool(p.get("recurring")),
        "cadence": _cadence_view(slug, p),
        "video_format": _format_view(slug, p),
        "short_style": _style_view(slug),
        "video_narration": _narration_view(p),
        "character_voices": dict((p.get("video") or {}).get("character_voices") or {}),
        "clusters": list(p.get("buyer_clusters") or []),
        "cluster_research": p.get("cluster_research") or {},
        "auto": [c.get("type") for c in cp.auto_channels(p)],
        "draft": [c.get("type") for c in cp.draft_channels(p)],
        "magnets": [{"keyword": m.get("keyword"), "name": m.get("name"),
                     "enabled": bool(m.get("enabled")), "link": m.get("link", "")}
                    for m in cp.magnets(p, enabled_only=False)],
        "responder": p.get("responder") or {},
        "connect": connections.full_status(slug, p),
    }


def summaries(visible: list[str] | None = None) -> dict:
    good, bad = cp.load_all()
    clients = [_client_dict(s, p) for s, p in good.items()
               if visible is None or s in visible]
    bad_list = [{"slug": s, "error": e} for s, e in bad.items()
                if visible is None or s in visible]
    return {"clients": clients, "bad": bad_list}


def detail(slug: str) -> dict:
    good, bad = cp.load_all()
    if slug in bad:
        return {"slug": slug, "error": bad[slug]}
    p = good.get(slug) or cp.load(slug)
    return {"slug": slug, "profile": p, "summary": _client_dict(slug, p)}


def _arm_warnings(slug: str, profile: dict) -> list[str]:
    """When arming, warn about owned channels that can't actually post yet (missing tokens)."""
    warns: list[str] = []
    status = eng.connect.status(slug)
    for ch in cp.auto_channels(profile):
        t = ch.get("type")
        plat = {"linkedin_company": "linkedin", "google_business": "gbp",
                "google-business": "gbp"}.get(t, t)
        st = status.get(plat)
        if st is not None:
            if not st.get("connected"):
                warns.append(f"{t}: not connected (won't post until you connect it)")
            elif st.get("missing_to_post"):
                warns.append(f"{t}: connected but missing {', '.join(st['missing_to_post'])}")
    return warns



def set_enabled(slug: str, enabled: bool) -> dict:
    """THE on/off switch for a client lane, from the Clients page.

    Flips `enabled` in the profile AND syncs the lane's Windows scheduled task, because the paused
    lanes had their tasks left Disabled — flipping only the profile would leave a "turned on" client
    that silently fails at schtasks /run. Validates before writing and backs up, same as set_dry_run:
    a malformed profile takes the lane down in a way that looks like an unrelated bug.
    """
    path = cp.CLIENTS_DIR / f"{slug}.json"
    if not path.is_file():
        raise ValueError(f"no profile for '{slug}'")
    raw = path.read_text(encoding="utf-8")
    profile = json.loads(raw)
    profile["enabled"] = bool(enabled)
    ok, errs = cp.validate(profile)
    if not ok:
        raise ValueError("refusing to write an invalid profile: " + "; ".join(errs))
    try:
        path.with_suffix(".json.bak").write_text(raw, encoding="utf-8")
    except Exception:
        pass
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(profile, indent=1), encoding="utf-8")
    tmp.replace(path)

    out = {"slug": slug, "enabled": bool(enabled)}
    # Best-effort task sync. The profile is the source of truth and is already written, so a
    # failed sync degrades to "dispatcher honours the switch, task state is stale" — reported,
    # never silent.
    try:
        import subprocess
        task = {"neuron-hq": "Neuron-GEO-Flywheel", "top-builder-ai": "TopBuilderAI-GEO-Flywheel",
                "auto-advisor": "AutoAdvisor-GEO-Flywheel",
                "top-practice-cfo": "TopPracticeCFO-GEO-Flywheel"}.get(slug)
        if task:
            r = subprocess.run(["schtasks", "/change", "/tn", task,
                                "/enable" if enabled else "/disable"],
                               capture_output=True, text=True)
            out["task_synced"] = r.returncode == 0
            if r.returncode != 0:
                out["task_error"] = (r.stderr or r.stdout).strip()[:200]
    except Exception as e:
        out["task_synced"] = False
        out["task_error"] = str(e)[:200]
    return out

def set_research_cadence(slug: str, every_weeks: int) -> dict:
    """ADDITIVE research-cadence dial (mirrors set_cadence's read/validate/backup/replace).

    Stored as profile["research_cadence"] = {"every_weeks": int, "last_auto": iso?} - a NEW key,
    so the existing publishing-cadence schema is untouched. 0 = off. last_auto is stamped by the
    hourly runner (neuron-research engine/client_cadence.py), never here.
    """
    if not isinstance(every_weeks, int) or every_weeks < 0 or every_weeks > 52:
        raise ValueError("every_weeks must be an integer 0..52 (0 = off)")
    path = cp.CLIENTS_DIR / f"{slug}.json"
    if not path.is_file():
        raise ValueError(f"no profile for '{slug}'")
    raw = path.read_text(encoding="utf-8")
    profile = json.loads(raw)
    rc = dict(profile.get("research_cadence") or {})
    rc["every_weeks"] = every_weeks
    profile["research_cadence"] = rc
    ok, verrs = cp.validate(profile)
    if not ok:
        raise ValueError("refusing to write an invalid profile: " + "; ".join(verrs))
    try:
        path.with_suffix(".json.bak").write_text(raw, encoding="utf-8")
    except Exception:
        pass
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(profile, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, path)
    return {"slug": slug, "research_cadence": rc}


def get_research_cadence(slug: str) -> dict:
    """Read the additive research_cadence block ({} when unset)."""
    path = cp.CLIENTS_DIR / f"{slug}.json"
    if not path.is_file():
        raise ValueError(f"no profile for '{slug}'")
    profile = json.loads(path.read_text(encoding="utf-8"))
    return dict(profile.get("research_cadence") or {})


def set_dry_run(slug: str, dry_run: bool) -> dict:
    """Atomically flip dry_run in ~/.geo-flywheel/clients/<slug>.json after re-validating (fail-closed)."""
    path = cp.CLIENTS_DIR / f"{slug}.json"
    if not path.is_file():
        raise ValueError(f"no profile for '{slug}'")
    raw = path.read_text(encoding="utf-8")
    profile = json.loads(raw)
    profile["dry_run"] = bool(dry_run)
    ok, errs = cp.validate(profile)
    if not ok:
        raise ValueError("refusing to write an invalid profile: " + "; ".join(errs))
    # backup, then atomic replace on the same volume
    try:
        path.with_suffix(".json.bak").write_text(raw, encoding="utf-8")
    except Exception:
        pass
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(profile, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, path)
    return {"slug": slug, "dry_run": profile["dry_run"], "armed": not profile["dry_run"],
            "warnings": _arm_warnings(slug, profile) if not profile["dry_run"] else []}


def set_cadence(slug: str, updates: dict) -> dict:
    """Update the profile's cadence block (partial: only the kinds sent) — atomic, fail-closed.

    `updates` is {profile_key: {"count": int>=0, "per": "day"|"week"|"month"}}, e.g.
    {"blog_posts": {"count": 1, "per": "day"}, "social_posts": {"count": 3, "per": "day"}}.
    """
    cad = eng.cadence
    path = cp.CLIENTS_DIR / f"{slug}.json"
    if not path.is_file():
        raise ValueError(f"no profile for '{slug}'")
    raw = path.read_text(encoding="utf-8")
    profile = json.loads(raw)

    # start from the normalized current block so a legacy string upgrades cleanly
    current = cad.normalize(profile.get("cadence"))
    block = {cad.PROFILE_KEYS[k]: dict(v) for k, v in current.items()}
    for key, val in (updates or {}).items():
        try:
            kind = cad.canon(key)
        except ValueError:
            raise ValueError(f"unknown cadence kind '{key}'")
        if not isinstance(val, dict):
            raise ValueError(f"cadence.{key} must be an object {{count, per}}")
        # ⛔ MERGE, never replace. This line used to be a wholesale
        #     block[...] = {"count": ..., "per": ...}
        # which silently deleted any other key on the kind being edited. With a per-kind `enabled`
        # that is a publish-when-off bug with no error anywhere: nudging a count would wipe the
        # switch, the request would still return 200, the UI would still print "saved", and the
        # lane would quietly start publishing a kind Cory had turned off. Untouched kinds were
        # never affected, so it would have surfaced only on the exact kind you had switched off.
        entry = dict(block.get(cad.PROFILE_KEYS[kind]) or {})
        entry.update({"count": val.get("count"), "per": val.get("per")})
        if "enabled" in val:
            # ⛔ RAW, not bool(). bool("false") is True, so coercing here would silently turn a
            # request meaning "switch this OFF" into ON, return 200, and keep publishing — the
            # exact failure cadence.validate_block (two lines down) exists to catch. Coercion
            # defeated that guard: the validator never saw the string. The React UI sends a real
            # boolean, but any direct POST (script, agent, WebMCP tool, curl) hit it.
            entry["enabled"] = val["enabled"]
        block[cad.PROFILE_KEYS[kind]] = entry
    errs = cad.validate_block(block)
    if errs:
        raise ValueError("; ".join(errs))
    profile["cadence"] = block

    ok, verrs = cp.validate(profile)
    if not ok:
        raise ValueError("refusing to write an invalid profile: " + "; ".join(verrs))
    try:
        path.with_suffix(".json.bak").write_text(raw, encoding="utf-8")
    except Exception:
        pass
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(profile, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, path)
    return {"slug": slug, "cadence": _cadence_view(slug, profile)}


# ---- output size (video.format) ----------------------------------------------------------
# ⛔ WHY `explicit` IS REPORTED (Cory 2026-08-13): video_format.DEFAULT is "vertical", and
# render_longform resolves `video_format.resolve(--size, --lane)`. A lane with NO video.format
# key therefore resolves to VERTICAL, not to the 1920x1080 every long-form has actually been
# rendering. Absence is not "unchanged" here, it is a silent flip. The UI shows `explicit: false`
# so a lane that never opted in is visibly on a default rather than looking deliberately set.

def _format_view(slug: str, p: dict) -> dict:
    """The size this lane renders at, plus the menu. Resolved exactly the way render_longform
    resolves it, so the cockpit cannot disagree with the renderer."""
    vf = eng.video_format
    raw = str(((p.get("video") or {}).get("format") or "")).strip()
    presets = [{"name": k, "w": v["w"], "h": v["h"], "aspect": v["aspect"], "use": v["use"],
                "default": k == vf.DEFAULT} for k, v in vf.PRESETS.items()]
    try:
        f = vf.resolve(raw or None, None)
    except vf.UnknownFormat as e:
        # A hand-edited typo must not take the whole client page down with a 500.
        return {"current": raw, "explicit": True, "error": str(e), "presets": presets}
    return {"current": f["name"], "w": f["w"], "h": f["h"], "aspect": f["aspect"],
            "explicit": bool(raw), "presets": presets}


NARRATION_KINDS = ("longform_videos", "shorts")
NARRATION_MODES = ("narrated", "character")
VOICE_ROLES = ("female", "male", "bot")


def _narration_view(p: dict) -> dict:
    """Per video kind: narrated (default) or character. Absent means narrated - every profile
    written before the selector existed keeps its current behavior."""
    nar = (p.get("video") or {}).get("narration") or {}
    return {k: (nar.get(k) if nar.get(k) in NARRATION_MODES else "narrated") for k in NARRATION_KINDS}


def _write_profile_video(slug: str, mutate) -> dict:
    """Read-validate-backup-atomic-replace, identical to set_video_format. `mutate(video_dict)`
    edits the video section in place. Never writes a profile the validator rejects."""
    path = cp.CLIENTS_DIR / f"{slug}.json"
    if not path.is_file():
        raise ValueError(f"no profile for '{slug}'")
    raw = path.read_text(encoding="utf-8")
    profile = json.loads(raw)
    video = dict(profile.get("video") or {})
    mutate(video)
    profile["video"] = video
    ok, verrs = cp.validate(profile)
    if not ok:
        raise ValueError("refusing to write an invalid profile: " + "; ".join(verrs))
    try:
        path.with_suffix(".json.bak").write_text(raw, encoding="utf-8")
    except Exception:
        pass
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(profile, indent=2, ensure_ascii=False) + chr(10), encoding="utf-8")
    os.replace(tmp, path)
    return profile


def set_narration(slug: str, kind: str, mode: str) -> dict:
    """Narrated vs character-led, per video kind (Cory 2026-08-20). Unknown values RAISE.

    The engine reads this from the profile itself (episode_engine._video_prefs), so the setting
    is enforced wherever the video is built, not wherever a prompt remembered to mention it."""
    if kind not in NARRATION_KINDS:
        raise ValueError(f"unknown video kind '{kind}'")
    if mode not in NARRATION_MODES:
        raise ValueError(f"unknown narration mode '{mode}'")

    def mut(video):
        nar = dict(video.get("narration") or {})
        nar[kind] = mode
        video["narration"] = nar
    profile = _write_profile_video(slug, mut)
    return {"slug": slug, "video_narration": _narration_view(profile)}


def set_character_voices(slug: str, voices: dict) -> dict:
    """The FIXED voice per character role. Three roles: female, male, bot. Set once, then they
    stay the same on every video - a character whose voice changes between videos is a different
    character. An empty string clears a role (that role falls back to the narrator blend)."""
    clean = {}
    for role in VOICE_ROLES:
        v = str(voices.get(role) or "").strip()
        if v and not v.replace("_", "").replace("-", "").isalnum():
            raise ValueError(f"'{role}' does not look like a voice id")
        clean[role] = v

    def mut(video):
        keep = {r: v for r, v in clean.items() if v}
        if keep:
            video["character_voices"] = keep
        else:
            video.pop("character_voices", None)
    profile = _write_profile_video(slug, mut)
    return {"slug": slug, "character_voices": dict((profile.get("video") or {}).get("character_voices") or {})}


def list_eleven_voices() -> list:
    """The account's real ElevenLabs voices, for the cockpit dropdowns. Uses the same key
    voice_synth uses. Failure returns [] - the UI then takes a pasted id instead of a list."""
    import urllib.request
    try:
        import importlib.util as ilu
        spec = ilu.spec_from_file_location(
            "voice_synth", r"C:/Users/you/.claude/skills/cory-voice/references/voice_synth.py")
        mod = ilu.module_from_spec(spec)
        spec.loader.exec_module(mod)
        key = getattr(mod, "EL_KEY", "")
        if not key:
            return []
        req = urllib.request.Request("https://api.elevenlabs.io/v1/voices",
                                     headers={"xi-api-key": key})
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read().decode("utf-8"))
        out = []
        for v in data.get("voices", []):
            out.append({"id": str(v.get("voice_id") or ""), "name": str(v.get("name") or ""),
                        "labels": v.get("labels") or {}})
        return [v for v in out if v["id"]]
    except Exception:
        return []


def set_video_format(slug: str, name: str) -> dict:
    """Write video.format for one lane. Unknown names RAISE — never a silent fallback to 16:9."""
    vf = eng.video_format
    path = cp.CLIENTS_DIR / f"{slug}.json"
    if not path.is_file():
        raise ValueError(f"no profile for '{slug}'")
    try:
        f = vf.resolve(name, None)
    except vf.UnknownFormat as e:
        raise ValueError(str(e))
    raw = path.read_text(encoding="utf-8")
    profile = json.loads(raw)
    video = dict(profile.get("video") or {})
    video["format"] = f["name"]
    profile["video"] = video

    ok, verrs = cp.validate(profile)
    if not ok:
        raise ValueError("refusing to write an invalid profile: " + "; ".join(verrs))
    try:
        path.with_suffix(".json.bak").write_text(raw, encoding="utf-8")
    except Exception:
        pass
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(profile, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, path)
    return {"slug": slug, "video_format": _format_view(slug, profile)}


def _style_view(slug: str) -> dict:
    """The lane's short-form STYLE (reel rotation), plus the menu of presets valid for it.
    Reads lanes.json via short_style — the file the SHORT renderer actually consults, which is
    the whole reason this is not another video.format-style write to the client profile."""
    ss = eng.short_style
    try:
        return {"current": ss.current(slug), "presets": ss.presets_for(slug)}
    except Exception as e:
        return {"current": {"name": None}, "presets": [], "error": str(e)[:200]}


def set_short_style(slug: str, name: str) -> dict:
    """Rewrite the lane's mode_rotation via the registry's own atomic lanes.json writer.
    Unknown styles and disallowed lanes RAISE (loud), mirroring set_video_format's posture."""
    ss = eng.short_style
    try:
        cur = ss.set_style(slug, name)
    except ss.UnknownStyle as e:
        raise ValueError(str(e))
    return {"slug": slug, "short_style": {"current": cur, "presets": ss.presets_for(slug)}}


def run_one(slug: str, kind: str, target: str, source: str,
            source_ref: str | None, actor: str = "owner") -> dict:
    """Fire ONE asset now. Honest about what it can and cannot start.

    `fire()` launches the lane's Windows scheduled task, which is the SAME path the hourly
    dispatcher uses — so a manual run behaves identically to a scheduled one (same guards, same
    on/off switch). It returns immediately; the work itself takes 30-60 minutes.

    `source` records the operator's intent for this run so the cycle can honor it:
      topic -> pick by coverage (blog_inventory.next_term, the least-served term)
      blog  -> build from an already-published post (source_ref)
    """
    import json as _json
    from datetime import datetime, timezone
    from pathlib import Path

    # ⛔ PER-KIND SWITCH, enforced server-side. fire() only checks the LANE-level switch, and for
    # blog_posts the target is "cycle" — the whole lane cycle, which leads with a blog deploy. So
    # a switched-off kind was one button click from publishing. The UI disables the button, but a
    # disabled button is a suggestion; this is the gate.
    try:
        _kind_on = eng.cadence.is_kind_enabled(slug, kind)
    except Exception:
        _kind_on = False          # fail closed: unreadable profile must not publish
    if not _kind_on:
        raise ValueError(f"{kind} is switched OFF for '{slug}' in its publishing cadence — "
                         f"switch it on and save before running one")

    task = eng.cadence_dispatch.task_for(slug, target)
    if not task:
        raise ValueError(f"no {target} scheduled task mapped for '{slug}' — this lane cannot run "
                         f"{kind} on demand yet")

    # Write the intent BEFORE firing, so the cycle reads a value that is already on disk.
    intent = {"slug": slug, "kind": kind, "target": target, "source": source,
              "source_ref": (source_ref or "").strip() or None, "actor": actor,
              "at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    try:
        d = Path.home() / ".geo-flywheel" / "run-intent"
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{slug}.json").write_text(_json.dumps(intent, indent=1), encoding="utf-8")
        intent["written"] = True
    except Exception as e:  # never block a run because the hint could not be saved
        intent["written"] = False
        intent["write_error"] = str(e)[:160]

    ok, msg = eng.cadence_dispatch.fire(slug, target)
    return {"ok": ok, "started": ok, "task": task, "message": msg, "intent": intent,
            "note": "started in the background; a full cycle takes 30-60 min"}


# ---------------------------------------------------------------------------------------------
# THE FULL CHAIN (Cory 2026-08-20): one longtail phrase -> blog -> longform | short | still,
# with per-step state the UI renders as a pulsing stepper. The orchestrator is the engine's
# chain_run.py, launched DETACHED here; it owns the state file and invokes the runners
# synchronously so step transitions are real, not inferred.
# ---------------------------------------------------------------------------------------------

def chain_status(slug: str) -> dict:
    """Read the chain state file. Never raises: no file means no chain has ever run."""
    import json as _json
    from datetime import datetime
    from pathlib import Path
    p = Path.home() / ".geo-flywheel" / "state" / f"chain-{slug}.json"
    if not p.is_file():
        return {"active": False, "exists": False}
    try:
        d = _json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:
        return {"active": False, "exists": True, "error": str(e)[:120]}
    # Staleness: the orchestrator updates on every transition; a doc not done and not updated
    # for 3h means the process died. Say so rather than pulse forever.
    stale = False
    if not d.get("done"):
        try:
            age = (datetime.now() - datetime.fromisoformat(d.get("updated"))).total_seconds()
            stale = age > 3 * 3600
        except Exception:
            stale = False
    return {"active": bool(not d.get("done") and not stale), "exists": True,
            "stale": stale, **d}


CHAIN_STEPS = ("blog", "longform", "short", "still")


def recent_posts(slug: str, limit: int = 5) -> dict:
    """The lane's most recent published posts, for the per-step run picker.

    Newest first. A post with no recorded date sorts after every dated one rather than to the
    top: an undated row is unknown, not new, and putting it first would offer the operator the
    wrong default at the exact moment the choice matters.
    """
    try:
        import blog_inventory as bi
    except Exception as e:
        return {"posts": [], "why": f"blog_inventory unavailable: {str(e)[:120]}"}
    try:
        rows = bi.inventory(slug) or []
    except Exception as e:
        return {"posts": [], "why": f"inventory failed: {str(e)[:120]}"}
    # ⛔ SORT ON SOMETHING THAT IS ACTUALLY THERE (2026-08-24). inventory() leaves `at` None for
    # every disk-sourced post - all 45 on neuron-hq and all 50 on salisburyre - so ordering by
    # `at` alone returns five arbitrary posts under a label that says "most recent". File mtime is
    # the recency signal that exists on disk, and it is the same one chain_run.find_slug already
    # trusts to match a post to a run. Catalog dates still win where a post has one.
    from datetime import datetime
    from pathlib import Path

    def _ts(r) -> float:
        at = r.get("at")
        if at:
            try:
                return datetime.fromisoformat(str(at).replace("Z", "+00:00")).timestamp()
            except Exception:
                pass
        f = r.get("file")
        if f:
            try:
                return Path(f).stat().st_mtime
            except Exception:
                pass
        return 0.0

    rows = [r for r in rows if r.get("slug")]
    for r in rows:
        r["_ts"] = _ts(r)
    rows.sort(key=lambda r: r["_ts"], reverse=True)
    out = []
    for r in rows[: max(1, min(int(limit or 5), 25))]:
        when = r.get("at")
        if not when and r.get("_ts"):
            when = datetime.fromtimestamp(r["_ts"]).isoformat(timespec="seconds")
        out.append({"slug": r.get("slug"), "title": r.get("title") or r.get("slug"),
                    "at": when, "dated": bool(r.get("at")),
                    "url": r.get("url"), "cluster": r.get("cluster")})
    return {"posts": out, "total": len(rows)}


def run_chain(slug: str, phrase: str, actor: str = "owner",
              only: list | None = None, post_slug: str = "") -> dict:
    """Launch the chain, detached. Refuses while one is genuinely live for this lane.

    `only` runs a SUBSET of the pipeline (the cockpit's per-step buttons). Every step except
    `blog` aims at an already-published post, so those require `post_slug` - the engine refuses
    without it, and so does this, because failing here gives the operator a usable message
    instead of a detached process that dies into a log file nobody opens.
    """
    import subprocess
    import sys
    from pathlib import Path

    phrase = (phrase or "").strip()
    if not (8 <= len(phrase) <= 200):
        raise ValueError("give the longtail phrase itself (8-200 characters)")
    steps = [str(x).strip() for x in (only or []) if str(x).strip()]
    bad = [s for s in steps if s not in CHAIN_STEPS]
    if bad:
        raise ValueError("unknown step(s): " + ", ".join(bad))
    post_slug = (post_slug or "").strip()
    # "manual" means: aim at whichever published post this phrase is about. Resolving it through
    # blog_inventory.check reuses the title-similarity matcher the duplicate gate already relies
    # on rather than writing a second one that would drift from it. A near-miss is REFUSED with
    # the closest candidate named, because pointing a render at the wrong post is the wrong-topic
    # defect this pipeline has already shipped three times.
    if post_slug == "manual":
        post_slug = ""
        if set(steps) - {"blog"}:
            try:
                import blog_inventory as bi
                m = (bi.check(phrase, slug, 0.45).get("matches") or [])
            except Exception as e:
                raise ValueError(f"could not search this lane's posts: {str(e)[:120]}")
            if not m:
                raise ValueError("no published post matches that phrase - pick one from the list")
            post_slug = str(m[0].get("slug") or "")
            if not post_slug:
                raise ValueError("the closest post has no slug - pick one from the list")
    if steps and (set(steps) - {"blog"}) and not post_slug:
        raise ValueError("choose the published post these steps should aim at")
    if post_slug and not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{2,160}", post_slug):
        raise ValueError("that post slug does not look like a slug")
    cur = chain_status(slug)
    if cur.get("active"):
        raise ValueError("a chain is already running for this lane - let it finish")
    if not cp.brand(cp.load(slug)):
        raise ValueError(f"no profile for '{slug}'")

    script = Path(eng.ENGINE_DIR) / "chain_run.py" if hasattr(eng, "ENGINE_DIR") else None
    if not script or not script.is_file():
        script = Path.home() / ".claude" / "skills" / "geo-flywheel" / "references" / "engine" / "chain_run.py"
    if not script.is_file():
        raise ValueError("chain_run.py not found in the engine")

    # DETACHED: the chain runs 40-90 minutes; the API call returns immediately and the UI polls
    # chain_status. CREATE_NEW_PROCESS_GROUP + DETACHED_PROCESS so a backend restart cannot kill
    # a chain mid-publish.
    flags = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    logdir = Path.home() / ".geo-flywheel" / "logs" / "chain"
    logdir.mkdir(parents=True, exist_ok=True)
    out = open(logdir / f"launch-{slug}.log", "a", encoding="utf-8")
    cmd = [sys.executable, str(script), "--lane", slug, "--phrase", phrase]
    if steps:
        cmd += ["--only", ",".join(steps)]
    if post_slug:
        cmd += ["--slug", post_slug]
    subprocess.Popen(cmd, stdout=out, stderr=subprocess.STDOUT, creationflags=flags)
    what = " + ".join(steps) if steps else "full pipeline"
    return {"ok": True, "started": True, "phrase": phrase, "only": steps,
            "post_slug": post_slug or None,
            "note": what + " launched" + (f" against /{post_slug}" if post_slug else "")
                    + "; poll GET /clients/" + slug + "/chain"}
