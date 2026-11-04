"""
system.py — /api/system (battery + Claude connection + capabilities), /api/csrf, /api/health.

The battery is read SERVER-SIDE via psutil so it always reports the LAPTOP's charge, even
when the cockpit is viewed remotely from a phone. The Claude-connection confirmation is
``claude_local.which_path()`` — the desktop launcher shows "Max subscription ✓" from it.
"""
from __future__ import annotations

import datetime

import psutil
from fastapi import APIRouter, Depends

from app import engine_bridge as eng
from app import security
from app.auth import require_user
from app.config import CONFIG

router = APIRouter(prefix="/api", tags=["system"])


def battery_state() -> dict:
    b = psutil.sensors_battery()
    if b is None:
        return {"present": False}
    secs = b.secsleft
    if secs is None or secs < 0:  # POWER_TIME_UNLIMITED (-2) / POWER_TIME_UNKNOWN (-1)
        secs = None
    return {
        "present": True,
        "percent": round(b.percent),
        "plugged": bool(b.power_plugged),
        "secs_left": secs,
    }


@router.get("/health")
def health() -> dict:
    """Unauthenticated readiness probe for the desktop launcher (leaks nothing)."""
    return {"ok": True, "service": "geo-cockpit"}


@router.get("/csrf")
def csrf(ident: dict = Depends(require_user)) -> dict:
    """Hand the per-process CSRF token to the same-origin SPA for mutation requests."""
    return {"token": security.CSRF_TOKEN}


@router.get("/system")
def system(ident: dict = Depends(require_user)) -> dict:
    claude = eng.claude_status()   # cached deep probe — the raw one spawns a 2s subprocess
    return {
        "generated_at": datetime.datetime.now().isoformat(timespec="seconds"),
        "battery": battery_state(),
        "claude": claude,
        "claude_ok": bool(claude.get("cli_available") or claude.get("api_available")),
        "capabilities": eng.geo_config.capabilities(),
        "user": {"email": ident["email"], "role": ident["role"]},
        "server": {"ok": True, "host": CONFIG["host"], "port": CONFIG["port"],
                   "public_host": CONFIG.get("public_host", "")},
        "dev": bool(CONFIG.get("dev")),
    }
