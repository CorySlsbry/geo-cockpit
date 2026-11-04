"""
connections.py — the FULL per-client connection status the cockpit cards show.

Source-of-truth order (Cory 2026-07-13): the central credential vault (~/.neuron-vault,
`tokens.list_tokens()` — DPAPI-encrypted, auto-refreshing) FIRST, then the legacy stores the
engine still reads (`~/.social-tokens/<slug>/`, `~/.youtube-tokens/`). A connection shows as
connected if EITHER has it, so nothing already-connected is hidden while the vault migration
finishes. We only ever read presence/handle — never a token value.

  * YouTube — vault `oauth:youtube:<channel>` (or legacy `~/.youtube-tokens/<channel>.json`),
    mapped from profile.youtube.channel (neuron/autoadvisor/salisbury).
  * Instagram/TikTok/LinkedIn/mailbox — engine `connect.status()` (~/.social-tokens) overlaid with
    vault `oauth:<provider>:<slug>` presence.
  * Email — Google Workspace mailbox (every brand has one); the flywheel auto-reply hookup is the
    optional extra.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from app import engine_bridge as eng

YT_TOKENS = Path.home() / ".youtube-tokens"
_VAULT_DIR = r"C:\Users\you\.neuron-vault"


def vault_accounts() -> set[tuple[str, str]]:
    """(provider, account) pairs present in the central vault's OAuth store. Empty on any failure
    (so the cockpit degrades to the legacy stores rather than erroring)."""
    try:
        if _VAULT_DIR not in sys.path:
            sys.path.insert(0, _VAULT_DIR)
        import tokens as vault_tokens  # noqa: E402
        return {(t.get("provider"), t.get("account")) for t in vault_tokens.list_tokens()}
    except Exception:
        return set()


def youtube_status(profile: dict, vt: set | None = None) -> dict:
    channel = ((profile or {}).get("youtube") or {}).get("channel")
    if not channel:
        return {"connected": False, "note": "no youtube.channel in profile"}
    vt = vault_accounts() if vt is None else vt
    in_vault = ("youtube", channel) in vt
    on_disk = (YT_TOKENS / f"{channel}.json").is_file()
    connected = in_vault or on_disk
    return {
        "connected": connected, "handle": channel, "managed": True, "missing_to_post": [],
        "source": "vault" if in_vault else ("legacy" if on_disk else None),
        "note": ("YouTube via the central vault (auto-refresh)" if in_vault
                 else "YouTube via ~/.youtube-tokens" if on_disk
                 else f"no token for channel '{channel}'"),
    }


def email_status(slug: str, profile: dict, social_status: dict | None = None,
                 vt: set | None = None) -> dict:
    """Email = the brand's Google Workspace mailbox (every brand has one). 'monitored'/'auto_replies'
    = the flywheel holds a per-mailbox Gmail OAuth token (oauth:gmail:<address> in the vault, minted
    by connect_gmail.py), so it can read (and, with the compose scope, reply) on its own."""
    em = (profile or {}).get("email") or {}
    addr = (em.get("from_identity") or "").strip()
    vt = vault_accounts() if vt is None else vt
    monitored = bool(addr) and ("gmail", addr.lower()) in vt
    return {
        "connected": bool(addr), "via": "google_workspace", "managed": True,
        "handle": addr, "monitored": monitored, "auto_replies": monitored, "missing_to_post": [],
        "note": ("Google Workspace — monitored (Gmail token in vault)" if monitored
                 else "Google Workspace (mailbox not yet connected for monitoring — run connect_gmail.py)"),
    }


def full_status(slug: str, profile: dict) -> dict:
    """engine social-token status, overlaid with the central vault, plus youtube + email."""
    st = dict(eng.connect.status(slug))          # instagram/tiktok/linkedin/gbp/mailbox (~/.social-tokens)
    vt = vault_accounts()
    for prov in ("instagram", "facebook", "tiktok", "linkedin", "mailbox"):
        entry = dict(st.get(prov) or {"connected": False})
        if (prov, slug) in vt:                   # also in the central vault
            entry["connected"] = True
            entry["source"] = "vault"
        st[prov] = entry
    st["youtube"] = youtube_status(profile, vt)
    st["email"] = email_status(slug, profile, social_status=st, vt=vt)
    return st


def managed_plan(platform: str, slug: str, profile: dict) -> dict | None:
    """Read-only 'connect' panels for the two managed connections (no token to paste)."""
    if platform == "youtube":
        yt = (profile or {}).get("youtube") or {}
        # ⛔ `.get(k, default)` DOES NOT COVER A NULL VALUE (fixed 2026-07-31). The default only
        # fires when the key is ABSENT. New clients are created with `"channel": null` present, so
        # ch was None and the panel rendered the literal string "None" — channel 'None', vault key
        # `oauth:youtube:None` — while simultaneously asserting "YouTube is connected and managed
        # centrally". A panel that claims a connection exists for a channel that was never named
        # is worse than an error: it sends you looking for a token instead of naming the real gap.
        ch = (yt.get("channel") or "").strip()
        s = youtube_status(profile)
        if not ch:
            return {
                "platform": "youtube", "managed": True, "connected": False,
                "authorize_url": "", "token_fields": [],
                "steps": [
                    "This client has no YouTube channel assigned yet, so there is nothing to connect.",
                    "Set `youtube.channel` on the client (the short token name, e.g. 'neuron' or "
                    "'topbuilderos'), then run the flywheel's YouTube OAuth once for that channel: "
                    "`python yt_auth.py <channel>`.",
                    "Finally migrate it into the vault with tokens.migrate_youtube_tokens so it "
                    "auto-refreshes and posting keeps working.",
                ],
                "notes": ["no youtube.channel set for this client — nothing is connected"],
            }
        return {
            "platform": "youtube", "managed": True, "connected": s.get("connected"),
            "authorize_url": "", "token_fields": [],
            "steps": [
                (f"YouTube channel '{ch}' is managed centrally — its OAuth token lives in your "
                 "credential vault (~/.neuron-vault) and auto-refreshes, so posting keeps working."
                 if s.get("connected") else
                 f"Channel '{ch}' is assigned but NO token was found for it, in the vault or in "
                 "~/.youtube-tokens. Run `python yt_auth.py {ch}` once, then migrate it into the "
                 "vault (tokens.migrate_youtube_tokens)."),
                "Nothing to paste here. To connect a different channel, run the flywheel's YouTube "
                "OAuth for it and migrate it into the vault.",
            ],
            "notes": [f"vault key: oauth:youtube:{ch}"],
        }
    if platform == "email":
        em = (profile or {}).get("email") or {}
        addr = em.get("from_identity") or "the brand address"
        s = email_status(slug, profile)
        monitored = s.get("monitored")
        return {
            "platform": "email", "managed": True, "connected": s.get("connected"),
            "authorize_url": "", "token_fields": [],
            "steps": [
                f"Email for this brand is a separate Google Workspace mailbox ({addr}). Sending and "
                "receiving already work in Workspace.",
                ("This mailbox is CONNECTED for monitoring — the flywheel holds a per-mailbox Gmail token "
                 f"(oauth:gmail:{addr} in the vault) and reads it on its own."
                 if monitored else
                 "To let the flywheel monitor it (and auto-reply to lead-magnet requests), connect it once: "
                 f"run  python connect_gmail.py --address {addr}  (add --full to also grant draft/send). "
                 "Sign into THIS brand's Google account in the browser; the refresh token lands in the vault "
                 "and auto-refreshes. Least privilege: read-only by default."),
            ],
            "notes": [f"mailbox: {addr} (separate Google Workspace inbox)",
                      f"vault key: oauth:gmail:{em.get('from_identity','')}" if em.get("from_identity") else
                      "vault key: oauth:gmail:<address>"],
        }
    return None
