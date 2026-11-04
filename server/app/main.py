"""
main.py — the GEO Cockpit FastAPI app.

Serves the built React SPA at / and a JSON API at /api/*. Bound to 127.0.0.1 by the
launcher; reachable remotely only through the Cloudflare tunnel + Access. Every request
passes the GuardMiddleware (Host allowlist + CSRF on mutations).
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse

from app.config import CONFIG, DATA_DIR, REPORTS_DIR, WEB_DIST
from app.security import GuardMiddleware
from app.routers import (system, clients, audits, review, connect, onboard, monitor, metrics,
                         webhooks, ads, social, jobs, action_center, mail_audit, market_gaps,
                         research)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("cockpit")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    if CONFIG.get("dev"):
        log.warning("COCKPIT_DEV=1 -> auth bypass active (owner). NEVER expose this process.")
    log.info("GEO Cockpit up on %s:%s (public=%s)", CONFIG["host"], CONFIG["port"],
             CONFIG.get("public_host", ""))
    # Cory's standing order: audit what we actually sent every 24h. The cockpit owns the
    # schedule (it runs 24/7 under the supervisor) — an hourly due-check, so a restart
    # catches a missed run up instead of skipping the day.
    try:
        from app.services import mail_audit_service
        mail_audit_service.start_scheduler()
    except Exception as e:
        log.warning("mail audit scheduler not started: %s", str(e)[:200])
    yield


app = FastAPI(title="GEO Cockpit", version="0.1.0",
              docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
app.add_middleware(GuardMiddleware)
for _r in (system, metrics, clients, connect, audits, review, onboard, monitor, webhooks, ads,
           social, jobs, action_center, mail_audit, market_gaps, research):
    app.include_router(_r.router)


_PLACEHOLDER = """<!doctype html><html><head><meta charset=utf-8>
<title>GEO Cockpit</title><style>body{background:#0C0A14;color:#EDF1F6;
font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0}
.b{max-width:34rem;text-align:center}.d{color:#7C5CFF;letter-spacing:.2em;font-size:12px}
</style></head><body><div class=b><div class=d>GEO COCKPIT</div>
<h1>Backend is running.</h1><p style="color:#93959C">The React app has not been built yet.
Run the Vite build in <code>web/</code> — its output in <code>web/dist</code> is served here.</p>
<p><a style="color:#A38DFF" href="/api/health">/api/health</a></p></div></body></html>"""


@app.get("/{full_path:path}", include_in_schema=False)
def spa(full_path: str):
    """Serve the SPA build; fall back to a placeholder until the React build exists."""
    if full_path.startswith("api/") or full_path.startswith("api"):
        return JSONResponse({"error": "not found"}, status_code=404)
    if full_path:
        candidate = (WEB_DIST / full_path).resolve()
        # jail: only serve files strictly inside WEB_DIST (is_relative_to avoids the
        # separator-less prefix match that a sibling like web/dist-backup could slip through)
        if candidate.is_relative_to(WEB_DIST.resolve()) and candidate.is_file():
            return FileResponse(str(candidate))
    index = WEB_DIST / "index.html"
    if index.is_file():
        return FileResponse(str(index))
    return HTMLResponse(_PLACEHOLDER)
