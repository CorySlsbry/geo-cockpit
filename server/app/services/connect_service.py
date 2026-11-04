"""
connect_service.py — wrap the engine's per-client OAuth connect helper + the managed connections.

plan() prints the (non-secret) authorize URL + steps; save_token() stores a pasted token in the
brand's own ~/.social-tokens/<slug>/ store. YouTube + email are MANAGED connections (their tokens
live in the flywheel's own stores / Resend) — they surface as read-only status panels, not paste
flows. We build the argparse-style object connect.build_token expects (SimpleNamespace), so the
engine's field-default / handle logic runs verbatim. Secret token VALUES are never returned.
"""
from __future__ import annotations

from types import SimpleNamespace

from app import engine_bridge as eng
from app.services import connections

connect = eng.connect
# order shown in the connect UI: Instagram + Facebook first (current focus), TikTok + LinkedIn last
PLATFORMS = ["instagram", "facebook", "youtube", "email", "gbp", "tiktok", "linkedin", "mailbox"]
MANAGED = {"youtube", "email"}          # read-only status panels, no token to paste


def _profile(slug: str) -> dict | None:
    try:
        return eng.client_profile.load(slug)
    except Exception:
        return None


def status(slug: str) -> dict:
    return connections.full_status(slug, _profile(slug) or {})


def plan(slug: str, platform: str) -> dict:
    profile = _profile(slug)
    if platform in MANAGED:
        return connections.managed_plan(platform, slug, profile)
    if platform not in connect.PLATFORMS:
        raise ValueError(f"unknown platform '{platform}'")
    return connect.plan(platform, slug, profile, None)


def save_token(slug: str, platform: str, fields: dict) -> dict:
    if platform in MANAGED:
        raise ValueError(f"'{platform}' is a managed connection — nothing to paste here")
    if platform not in connect.PLATFORMS:
        raise ValueError(f"unknown platform '{platform}'")
    ns = SimpleNamespace(
        client=slug,
        token=(fields.get("token") or "").strip() or None,
        token_file=None,
        account_id=fields.get("account_id"),
        location_id=fields.get("location_id"),
        refresh_token=fields.get("refresh_token"),
        handle=fields.get("handle"),
        api_host=fields.get("api_host"),
        expires_at=fields.get("expires_at"),
        email=fields.get("email"),
        page_id=fields.get("page_id"),
        scope=fields.get("scope"),
    )
    tok = connect.build_token(platform, ns, _profile(slug))
    if tok is None:
        raise ValueError("no access token supplied")
    path = connect.save(slug, platform, tok)
    miss = connect.missing_to_post(platform, tok)
    return {"path": str(path), "fields_written": sorted(tok.keys()),  # names only, never values
            "missing_to_post": miss, "postable": not miss, "platform": platform}
