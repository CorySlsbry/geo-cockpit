"""
config.py — non-secret cockpit configuration.

Loads ``cockpit.config.json`` (engine dir, ports, Cloudflare Access team/aud, the
email->role map) and layers environment overrides on top. No secrets live here; the
engine's own keys are resolved through ``geo_config`` inside the engine, never here.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent          # geo-cockpit/server
REPO_DIR = SERVER_DIR.parent                                  # geo-cockpit
CONFIG_PATH = SERVER_DIR / "cockpit.config.json"
DATA_DIR = SERVER_DIR / "data"
REPORTS_DIR = DATA_DIR / "reports"
WEB_DIST = REPO_DIR / "web" / "dist"

_DEFAULTS = {
    "engine_dir": r"C:\Users\you\.claude\skills\geo-flywheel\references\engine",
    "bridge_db": r"C:\Users\you\Computer\services\bridge\metrics.db",
    "host": "127.0.0.1",
    "port": 8791,
    "public_host": "geo.neuron-hq.com",
    "access": {"team_domain": "", "aud": ""},
    "roles": {"cory.salisbury@gmail.com": {"role": "owner"}},
    "client_slugs": {},
    "audit_concurrency": 1,
    "trust_local_loopback": True,
}


def _load() -> dict:
    cfg = json.loads(json.dumps(_DEFAULTS))  # deep copy
    if CONFIG_PATH.is_file():
        try:
            data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
            for k, v in data.items():
                if v is not None:
                    cfg[k] = v
        except Exception as e:  # a broken config must not crash boot; fall back to defaults
            print(f"[cockpit.config] WARN could not parse {CONFIG_PATH}: {e!r}")
    # environment overrides
    cfg["dev"] = os.environ.get("COCKPIT_DEV", "").strip().lower() in ("1", "true", "yes")
    if os.environ.get("COCKPIT_PORT"):
        try:
            cfg["port"] = int(os.environ["COCKPIT_PORT"])
        except ValueError:
            pass
    try:
        cfg["audit_concurrency"] = max(1, min(2, int(cfg.get("audit_concurrency", 1))))
    except (TypeError, ValueError):
        cfg["audit_concurrency"] = 1
    return cfg


CONFIG = _load()
