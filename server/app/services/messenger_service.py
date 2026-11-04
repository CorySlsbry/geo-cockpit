"""
messenger_service.py — Meta webhook auth + FB/IG comment→DM lead-magnet auto-reply.

This is the cockpit-side receiver for Meta's Messenger/Instagram webhooks. It is a PUBLIC
endpoint (Cloudflare Access needs a bypass for /webhooks/meta so Meta can reach it), so it
is NOT protected by the cockpit's Access/JWT/CSRF — it authenticates the way Meta intends:

  * verify_token_ok  — constant-time check of the GET subscription handshake token
    (minted once into data/.meta-webhook-token, same pattern as the CSRF token).
  * signature_ok     — constant-time HMAC-SHA256 of the RAW POST body against the Meta app
    secret (IG_OAUTH_CLIENT_SECRET, from the central vault). Nothing is parsed until it passes.

handle_event maps an incoming page / IG-business id -> the brand's stored PAGE token + that
brand's lead magnets, matches a magnet keyword in the comment / DM text, and replies with the
magnet link (IG private-reply / DM works today via instagram_manage_messages; the FB Page
message path activates once pages_messaging is granted — see docs/NEEDS-CORY).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from app.config import DATA_DIR

log = logging.getLogger("cockpit.messenger")

API = "https://graph.facebook.com/v23.0"
SOCIAL = Path(os.path.expanduser("~/.social-tokens"))
CLIENTS = Path(os.path.expanduser("~/.geo-flywheel/clients"))
_VERIFY_FILE = DATA_DIR / ".meta-webhook-token"
_VAULT_DIR = r"C:\Users\you\.neuron-vault"


# ------------------------------------------------------------------ secrets / auth
def _app_secret() -> str:
    try:
        if _VAULT_DIR not in sys.path:
            sys.path.insert(0, _VAULT_DIR)
        from secrets_vault import get as vget  # DPAPI vault, stdlib-only
        return (vget("IG_OAUTH_CLIENT_SECRET") or "").strip()
    except Exception as e:  # never crash the webhook on a secrets hiccup
        log.error("messenger: app secret unavailable: %s", e)
        return ""


def verify_token() -> str:
    """The GET-handshake token; minted + persisted once. Enter the SAME value in Meta's
    webhook config. Low-sensitivity (it only gates the subscription handshake; real event
    auth is the POST signature)."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if _VERIFY_FILE.is_file():
        t = _VERIFY_FILE.read_text(encoding="utf-8").strip()
        if t:
            return t
    t = secrets.token_urlsafe(24)
    _VERIFY_FILE.write_text(t, encoding="utf-8")
    return t


def verify_token_ok(token: str) -> bool:
    return bool(token) and secrets.compare_digest(token, verify_token())


def signature_ok(raw: bytes, header: str) -> bool:
    secret = _app_secret()
    if not secret or not header or not header.startswith("sha256="):
        return False
    mac = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest("sha256=" + mac, header)


# ------------------------------------------------------------------ brand lookup
def _brand_index() -> dict:
    """{page_id | ig_business_id -> {slug, token, api_host, platform}} from stored tokens."""
    idx: dict = {}
    if not SOCIAL.is_dir():
        return idx
    for d in SOCIAL.iterdir():
        if not d.is_dir():
            continue
        for plat in ("facebook", "instagram"):
            p = d / f"{plat}.json"
            if not p.is_file():
                continue
            try:
                t = json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                continue
            aid = str(t.get("account_id") or "").strip()
            if aid and t.get("access_token"):
                idx[aid] = {"slug": d.name, "token": t["access_token"],
                            "api_host": t.get("api_host", API), "platform": plat}
    return idx


def _magnets(slug: str) -> list:
    p = CLIENTS / f"{slug}.json"
    if not p.is_file():
        return []
    try:
        prof = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return []
    return [m for m in (prof.get("magnets") or []) if m.get("keyword") and m.get("link")]


def _match_magnet(text: str, slug: str):
    t = (text or "").lower()
    for m in _magnets(slug):
        if re.search(r"\b" + re.escape(str(m["keyword"]).lower()) + r"\b", t):
            return m
    return None


# ------------------------------------------------------------------ send
def _post(url: str, data: dict) -> dict:
    req = urllib.request.Request(url, data=urllib.parse.urlencode(data).encode(), method="POST")
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode())


def _send_reply(host: str, obj_id: str, token: str, recipient: dict, text: str) -> bool:
    """recipient = {'comment_id': X} (private reply) or {'id': PSID/IGSID} (direct message)."""
    try:
        r = _post(f"{host}/{obj_id}/messages", {
            "recipient": json.dumps(recipient),
            "message": json.dumps({"text": text}),
            "messaging_type": "RESPONSE",
            "access_token": token,
        })
        ok = bool(r.get("message_id") or r.get("recipient_id"))
        log.info("messenger: reply ok=%s via=%s", ok, list(recipient)[0])
        return ok
    except Exception as e:  # FB Messenger needs pages_messaging (not yet granted); IG works
        log.warning("messenger: reply failed (%s) — %s", list(recipient)[0], str(e)[:180])
        return False


# ------------------------------------------------------------------ dispatch
def handle_event(raw: bytes) -> None:
    """Parse a signature-verified webhook body and auto-reply to keyword-matched comments/DMs.
    Runs off the response path (FastAPI BackgroundTask); must never raise."""
    try:
        payload = json.loads(raw.decode("utf-8"))
    except Exception:
        log.warning("messenger: unparseable body"); return

    idx = _brand_index()
    obj = payload.get("object")
    for entry in payload.get("entry", []) or []:
        eid = str(entry.get("id") or "")
        brand = idx.get(eid)
        if not brand:
            log.info("messenger: no connected brand for entry %s (obj=%s) — ignored", eid, obj)
            continue
        slug, token, host = brand["slug"], brand["token"], brand.get("api_host", API)

        # comments / mentions (field changes)
        for ch in entry.get("changes", []) or []:
            val = ch.get("value") or {}
            if val.get("verb") in ("remove", "edit", "hide"):
                continue
            if str((val.get("from") or {}).get("id") or "") == eid:  # our own comment
                continue
            m = _match_magnet(val.get("text") or val.get("message") or "", slug)
            if not m:
                continue
            cid = val.get("comment_id") or val.get("id")
            if cid:
                _send_reply(host, eid, token, {"comment_id": cid},
                            f"Thanks! Here's the {m['name']}: {m['link']}")

        # direct messages
        for msg in entry.get("messaging", []) or []:
            body = msg.get("message") or {}
            if body.get("is_echo"):
                continue
            sender = (msg.get("sender") or {}).get("id")
            m = _match_magnet(body.get("text") or "", slug)
            if m and sender:
                _send_reply(host, eid, token, {"id": sender},
                            f"Here's the {m['name']}: {m['link']}")
