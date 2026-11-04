"""
webhooks.py — Meta (Messenger + Instagram) webhook receiver.

PUBLIC endpoint (Cloudflare Access must bypass /webhooks/meta), so it is NOT behind the
cockpit's Access/JWT/CSRF. It authenticates the Meta way:
  GET  /webhooks/meta — subscription handshake: echo hub.challenge iff hub.verify_token matches.
  POST /webhooks/meta — event delivery: X-Hub-Signature-256 HMAC verified against the app
       secret BEFORE the body is parsed; then a fast 200 while the reply runs in the background
       (Meta requires a sub-second 200 or it retries).
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, BackgroundTasks, Request
from fastapi.responses import JSONResponse, PlainTextResponse

from app.services import messenger_service as M

router = APIRouter(prefix="/webhooks", tags=["webhooks"])
log = logging.getLogger("cockpit.webhooks")


@router.get("/meta")
def verify(request: Request):
    q = request.query_params
    if q.get("hub.mode") == "subscribe" and M.verify_token_ok(q.get("hub.verify_token", "")):
        return PlainTextResponse(q.get("hub.challenge", ""))
    return JSONResponse({"error": "verification failed"}, status_code=403)


@router.post("/meta")
async def receive(request: Request, background: BackgroundTasks):
    raw = await request.body()
    if not M.signature_ok(raw, request.headers.get("x-hub-signature-256", "")):
        log.warning("webhook: rejected POST (bad/absent signature)")
        return JSONResponse({"error": "bad signature"}, status_code=403)
    background.add_task(M.handle_event, raw)  # parse + reply off the response path
    return PlainTextResponse("EVENT_RECEIVED")
