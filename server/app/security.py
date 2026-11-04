"""
security.py — request-guard middleware (ported from Ambition's proven local pattern).

Two protections on every request:
  * Host allowlist  -> blocks DNS-rebind (only geo.neuron-hq.com / loopback are valid Hosts).
  * CSRF on mutations -> POST/PUT/PATCH/DELETE must carry an allowed Origin/Referer AND the
    per-process ``X-Cockpit-Token`` header (minted here, handed to the SPA via /api/csrf).

The app is bound to 127.0.0.1, so the only remote path is cloudflared -> Cloudflare Access
-> loopback. This middleware is defense-in-depth beneath Access, and the whole gate locally.
"""
from __future__ import annotations

import secrets

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from app.config import CONFIG, DATA_DIR

_TOKEN_FILE = DATA_DIR / ".cockpit-token"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def _load_or_mint_token() -> str:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if _TOKEN_FILE.is_file():
        existing = _TOKEN_FILE.read_text(encoding="utf-8").strip()
        if existing:
            return existing
    token = secrets.token_urlsafe(32)
    _TOKEN_FILE.write_text(token, encoding="utf-8")
    return token


CSRF_TOKEN = _load_or_mint_token()


def allowed_hosts() -> set[str]:
    port = CONFIG["port"]
    hosts = {f"127.0.0.1:{port}", f"localhost:{port}", "127.0.0.1", "localhost"}
    if CONFIG.get("public_host"):
        hosts.add(CONFIG["public_host"])
    return hosts


def allowed_origins() -> set[str]:
    port = CONFIG["port"]
    origins = {f"http://127.0.0.1:{port}", f"http://localhost:{port}"}
    if CONFIG.get("public_host"):
        origins.add(f"https://{CONFIG['public_host']}")
    return origins


class GuardMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        host = request.headers.get("host", "")
        if host and host not in allowed_hosts():
            return JSONResponse({"error": "bad host"}, status_code=400)

        # Meta webhooks are unauthenticated-by-Origin by design; they authenticate with an
        # X-Hub-Signature-256 HMAC verified inside the route. Exempt only this exact path from
        # the Origin/CSRF gate (the Host allowlist above still applies) — a future /webhooks/*
        # route must be added here deliberately, never inherit the exemption.
        is_meta_webhook = request.url.path == "/webhooks/meta"
        if request.method not in SAFE_METHODS and not is_meta_webhook:
            origin = request.headers.get("origin") or request.headers.get("referer", "")
            origins = allowed_origins()
            ok_origin = bool(origin) and any(origin.startswith(o) for o in origins)
            token = request.headers.get("x-cockpit-token", "")
            if not ok_origin or not secrets.compare_digest(token, CSRF_TOKEN):
                return JSONResponse({"error": "csrf check failed"}, status_code=403)

        return await call_next(request)
