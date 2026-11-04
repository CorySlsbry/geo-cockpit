"""
auth.py — identity + role resolution (built once, scales single-user -> team -> client).

Three layers of auth protect this app; this module is layer (b), the app-side check:
  (a) Cloudflare Access gates geo.neuron-hq.com at the edge (login, no passwords here).
  (b) We verify the ``Cf-Access-Jwt-Assertion`` header (RS256 sig + aud + iss + exp against
      the team JWKS) and map the email -> role (owner | team | client) from cockpit.config.
  (c) The 127.0.0.1 bind means only cloudflared (same box) can reach us.

``COCKPIT_DEV=1`` synthesizes an owner identity for local development. It is loud and must
NEVER be set for the tunnelled/service process.
"""
from __future__ import annotations

import logging
import os
import secrets

import jwt
from fastapi import HTTPException, Request

from app.config import CONFIG

# The desktop (Electron) app spawns the backend with COCKPIT_LOCAL_TOKEN set and injects the same
# value as X-Cockpit-Local on every request. That header proves "this request came from the local
# desktop shell" -> owner. A tunnelled/remote request never carries it, so it still falls through to
# the Cloudflare Access JWT check. This lets ONE backend be both locally-trusted and remotely-gated.
_LOCAL_TOKEN = os.environ.get("COCKPIT_LOCAL_TOKEN", "").strip()

log = logging.getLogger("cockpit.auth")

_jwks_client: "jwt.PyJWKClient | None" = None


def _owner_email() -> str:
    for email, entry in CONFIG.get("roles", {}).items():
        if isinstance(entry, dict) and entry.get("role") == "owner":
            return email
    return "cory.salisbury@gmail.com"


def _jwks():
    global _jwks_client
    team = CONFIG.get("access", {}).get("team_domain", "")
    if not team:
        return None
    if _jwks_client is None:
        base = team if team.startswith("http") else f"https://{team}"
        _jwks_client = jwt.PyJWKClient(f"{base}/cdn-cgi/access/certs")
    return _jwks_client


def _verify_access_jwt(token: str) -> dict | None:
    access = CONFIG.get("access", {})
    team, aud = access.get("team_domain", ""), access.get("aud", "")
    if not team or not aud:
        return None
    client = _jwks()
    if client is None:
        return None
    signing_key = client.get_signing_key_from_jwt(token)
    issuer = team if team.startswith("http") else f"https://{team}"
    return jwt.decode(token, signing_key.key, algorithms=["RS256"], audience=aud, issuer=issuer)


# Headers cloudflare's edge stamps on EVERY tunnelled request. Their absence on a 127.0.0.1
# request means it came from a genuine local process (the app binds loopback, so the ONLY non-local
# path in is cloudflared, which always sets cf-ray). This is what lets the local browser + desktop
# app in without weakening the remote gate.
_CF_MARKERS = ("cf-ray", "cf-connecting-ip", "cf-access-jwt-assertion", "cf-worker", "cdn-loop")


def _is_local_request(request: Request) -> bool:
    client = (request.client.host if request.client else "") or ""
    if client not in ("127.0.0.1", "::1"):
        return False
    return not any(request.headers.get(h) for h in _CF_MARKERS)


def _role_for(email: str) -> dict | None:
    entry = CONFIG.get("roles", {}).get(email.lower())
    if not entry:
        return None
    role = entry.get("role", "client")
    if role in ("owner", "team"):
        slugs = None  # None == all clients
    else:
        slugs = [entry["slug"]] if entry.get("slug") else []
    return {"email": email.lower(), "role": role, "slugs": slugs}


def get_identity(request: Request) -> dict | None:
    if CONFIG.get("dev"):
        return {"email": _owner_email(), "role": "owner", "slugs": None}
    if _LOCAL_TOKEN and secrets.compare_digest(request.headers.get("x-cockpit-local", ""), _LOCAL_TOKEN):
        return {"email": _owner_email(), "role": "owner", "slugs": None}
    if CONFIG.get("trust_local_loopback", True) and _is_local_request(request):
        return {"email": _owner_email(), "role": "owner", "slugs": None}
    token = request.headers.get("cf-access-jwt-assertion", "")
    if not token:
        return None
    try:
        claims = _verify_access_jwt(token)
    except Exception as e:
        log.warning("Access JWT verify failed: %r", e)
        return None
    if not claims:
        return None
    email = (claims.get("email") or "").strip()
    if not email:
        return None
    return _role_for(email)


# --- FastAPI dependencies ---------------------------------------------------
def require_user(request: Request) -> dict:
    ident = get_identity(request)
    if not ident:
        raise HTTPException(status_code=401, detail="authentication required")
    return ident


def require_owner(request: Request) -> dict:
    ident = require_user(request)
    if ident["role"] != "owner":
        raise HTTPException(status_code=403, detail="owner role required")
    return ident


def visible_slugs(ident: dict) -> list[str] | None:
    """Return the slugs this identity may see, or None for all."""
    return ident.get("slugs")


def ensure_slug_visible(ident: dict, slug: str) -> None:
    """403 if this identity is scoped (a client role) and the slug isn't in its set. No-op for
    owner/team (slugs is None). Object-level authz for the per-client endpoints."""
    vis = ident.get("slugs")
    if vis is not None and slug not in vis:
        raise HTTPException(status_code=403, detail="not permitted for this client")
