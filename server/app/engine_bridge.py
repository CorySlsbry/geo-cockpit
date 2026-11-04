"""
engine_bridge.py — THE single boundary where the cockpit imports the GEO engine.

The engine modules (client_profile, geo_audit, connect, ...) live in the geo-flywheel
skill and import each other by bare name, so we put their directory on sys.path once
here and import them in-process. Every cockpit service imports the engine THROUGH this
module (``from app import engine_bridge as eng``) — never by re-inserting sys.path
elsewhere. This keeps the coupling in one auditable place.
"""
from __future__ import annotations

import sys

from app.config import CONFIG

ENGINE_DIR = CONFIG["engine_dir"]
if ENGINE_DIR not in sys.path:
    sys.path.insert(0, ENGINE_DIR)

# The engine surface the cockpit depends on. Imported eagerly so a broken engine
# fails loudly at boot rather than on first request.
import action_exec      # noqa: E402
import action_state     # noqa: E402
import asset_library    # noqa: E402
import cadence          # noqa: E402
import cadence_dispatch  # noqa: E402  (task_for/fire — the run-one button)
import client_profile  # noqa: E402
import cluster_research  # noqa: E402
import cluster_hygiene  # noqa: E402
import mail_audit       # noqa: E402
import market_gaps      # noqa: E402
import recheck          # noqa: E402
import site_geo_check   # noqa: E402
import geo_config       # noqa: E402
import geo_audit        # noqa: E402
import connect          # noqa: E402
import slack_kit        # noqa: E402
import audit_report     # noqa: E402
import geo_onboard      # noqa: E402
import social_post      # noqa: E402
import social_guard      # noqa: E402  (account-lock for IG/TikTok/FB/LinkedIn)
import yt_channel_guard  # noqa: E402  (channel-lock for YouTube)
import brand_guard       # noqa: E402  (brand-lock: which brand content is published UNDER)
import claude_local     # noqa: E402
import verify_core      # noqa: E402
import video_format     # noqa: E402  (output size registry — the cockpit's format dropdown)
import short_style      # noqa: E402  (short-form STYLE registry — the reel-style dropdown; the
                        #  sanctioned lanes.json mode_rotation writer, loud on unknown styles)

__all__ = [
    "action_exec", "action_state", "asset_library",
    "cadence", "client_profile", "cluster_research", "cluster_hygiene", "geo_config", "geo_audit", "connect",
    "mail_audit", "market_gaps", "recheck", "site_geo_check", "slack_kit",
    "audit_report", "geo_onboard", "social_post", "social_guard", "yt_channel_guard", "brand_guard",
    "claude_local", "verify_core", "video_format", "short_style",
    "claude_status",
]


import time as _time  # noqa: E402

_CLAUDE_STATUS: dict = {"at": 0.0, "value": None}


def claude_status(ttl: float = 300.0) -> dict:
    """which_path(deep=True) spawns `claude --version` (~2s, boots Node) — far too heavy for
    the SPA's 5-20s status polls. The CLI's install path ~never changes while the server runs,
    so serve a cached deep probe and refresh it at most every ``ttl`` seconds."""
    now = _time.time()
    if _CLAUDE_STATUS["value"] is None or now - _CLAUDE_STATUS["at"] >= ttl:
        _CLAUDE_STATUS.update(at=now, value=claude_local.which_path())
    return _CLAUDE_STATUS["value"]
