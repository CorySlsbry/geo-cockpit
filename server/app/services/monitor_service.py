"""
monitor_service.py — delivery-log tails, scheduled-task health, and the Claude LLM-path log.

All reads. Delivery logs are the engine's own JSONL (dm-watcher / email-responder / social-log) plus
the cockpit's own action log. Task health is an honest `schtasks` query (reports "not registered"
rather than pretending). The Claude log shows which path (subscription vs metered) served each call.
"""
from __future__ import annotations

import json
import subprocess
from datetime import datetime
from pathlib import Path

from app.config import DATA_DIR
from app import engine_bridge as eng

GEO_DIR = Path.home() / ".geo-flywheel"
CONFIG_DIR = Path(getattr(eng.geo_config, "CONFIG_DIR", GEO_DIR))

_DELIVERY_LOGS = {
    "dm": GEO_DIR / "dm-watcher-log.jsonl",
    "email": GEO_DIR / "email-responder-log.jsonl",
    "social": CONFIG_DIR / "social-log.jsonl",
    "cockpit": DATA_DIR / "cockpit-actions.jsonl",
}
_CLAUDE_LOG = GEO_DIR / "logs" / "claude_local.jsonl"

# scheduled tasks the flywheel may register (honest "not registered" when absent)
_GEO_TASKS = [
    "GEO-Audit",                     # weekly per-client audit (measure/draft/report)
    "Neuron-GEO-Flywheel",           # per-brand content cycles (blog + long-form + shorts + post)
    "AutoAdvisor-GEO-Flywheel",
    "TopBuilderAI-GEO-Flywheel",
    "TopPracticeCFO-GEO-Flywheel",
    "GEO-Shorts-Publisher",          # timed shorts publishing
    "Neuron-DM-Watcher",             # IG comment -> DM lead-magnet auto-reply
    "GEO-Email-Watcher",             # per-mailbox monitoring + triage/management
    "GEO-Email-Brief",               # daily per-brand mailbox Slack digest
    "GEO-Ads-Optimizer",             # daily Meta ads proposals -> Slack (propose-then-approve)
    "GEO-Cadence-Dispatcher",        # hourly: fires due lanes + processes citation re-checks
    "CloutHook-Shorts",              # CloutHook shorts-only lane (Thu+Sun)
    "GEO-Cockpit",                   # the cockpit's own supervisor (backend + tunnel)
    "GEO-Needs-You",                 # daily 7:45am: the one 'needs you' Slack digest
    "GEO-Pitch-Sender",              # daily 8:15am: sends actionable placement pitches (gated, capped)
    # (GEO-Mail-Audit is intentionally NOT here: the cockpit's own scheduler owns the 24h
    #  sent-mail audit — see services/mail_audit_service.py + the Mail Audit page. The
    #  standalone task is disabled so there is exactly ONE owner of that cadence.)
]


def tail_jsonl(path: Path, limit: int = 100) -> list[dict]:
    if not path.is_file():
        return []
    out: list[dict] = []
    try:
        lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    except Exception:
        return []
    for line in lines[-limit:]:
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except Exception:
            out.append({"raw": line[:400]})
    return out


def deliveries(source: str = "dm", limit: int = 100) -> dict:
    path = _DELIVERY_LOGS.get(source)
    if path is None:
        return {"source": source, "rows": [], "error": "unknown source"}
    rows = tail_jsonl(path, limit)
    rows.reverse()  # newest first
    return {"source": source, "path": str(path), "count": len(rows), "rows": rows}


def claude_log(limit: int = 60) -> dict:
    rows = tail_jsonl(_CLAUDE_LOG, limit)
    rows.reverse()
    return {"path": str(_CLAUDE_LOG), "count": len(rows), "rows": rows}


# Windows Task Scheduler "Last Result" codes -> plain English (so a glance says what happened).
_RESULT_LABELS = {
    0: ("Success", True),
    1: ("Failed: script exited 1 (check logs)", False),
    2: ("Failed: script exited 2 (check logs)", False),
    267008: ("Ready (armed)", True),
    267009: ("Currently running", True),
    267010: ("No more runs scheduled", True),
    267011: ("Never run yet", True),
    267014: ("Last run was terminated by the user", False),
    2147750687: ("Skipped: an instance was already running", True),
    2147942401: ("Failed: function not found", False),
    2147942402: ("Failed: file/path not found", False),
    2147942667: ("Failed: invalid directory", False),
    3221225786: ("Stopped (Ctrl+C / shutdown)", False),
    3221225794: ("Failed: app init error", False),
}


def _friendly_result(raw) -> tuple[str | None, bool | None]:
    """(label, ok) for a schtasks Last Result string. ok=None when unknown/absent."""
    if raw in (None, ""):
        return (None, None)
    s = str(raw).strip()
    try:
        code = int(s, 16) if s.lower().startswith("0x") else int(s)
    except ValueError:
        return (s, None)
    if code in _RESULT_LABELS:
        return _RESULT_LABELS[code]
    # unknown: 0x8xxxxxxx / 0xCxxxxxxx (or their unsigned decimals) are Windows errors
    if code < 0 or code >= 0x80000000:
        return (f"Failed: Windows error 0x{code & 0xFFFFFFFF:08X}", False)
    return (f"Exit code {code}", code == 0)


_MONTHS = None


def _parse_dt(s) -> float:
    """schtasks date string -> epoch seconds for sorting. 'Never'/1999 sentinel -> 0."""
    if not s or "1999" in str(s) or str(s).strip().upper() in ("N/A", "NEVER"):
        return 0.0
    for fmt in ("%m/%d/%Y %I:%M:%S %p", "%m/%d/%Y %H:%M:%S", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(str(s).strip(), fmt).timestamp()
        except (ValueError, OverflowError):
            continue
    return 0.0


def _query_task(name: str) -> dict:
    try:
        p = subprocess.run(["schtasks", "/query", "/TN", name, "/fo", "LIST", "/v"],
                           capture_output=True, text=True, timeout=15)
    except Exception as e:
        return {"name": name, "registered": False, "error": str(e)[:120]}
    if p.returncode != 0:
        return {"name": name, "registered": False}
    info: dict = {"name": name, "registered": True}
    for line in (p.stdout or "").splitlines():
        if ":" not in line:
            continue
        k, _, v = line.partition(":")
        k, v = k.strip().lower(), v.strip()
        if k == "status":
            info["status"] = v
        elif k == "last run time":
            info["last_run"] = v
        elif k == "next run time":
            info["next_run"] = v
        elif k == "last result":
            info["last_result"] = v
        elif k == "scheduled task state":
            info["state"] = v
    label, ok = _friendly_result(info.get("last_result"))
    info["last_result_label"] = label
    info["last_result_ok"] = ok
    info["last_run_ts"] = _parse_dt(info.get("last_run"))
    return info


_TASKS_CACHE: dict = {"at": 0.0, "value": None}


def tasks() -> list[dict]:
    """All GEO scheduled tasks, most-recently-run FIRST (never-run tasks sink to the bottom).
    10 sequential schtasks spawns (~0.6s) for state that changes on a minutes scale — cached
    30s so the Monitor poll doesn't re-spawn them every tick."""
    import time as _t
    now = _t.time()
    if _TASKS_CACHE["value"] is None or now - _TASKS_CACHE["at"] >= 30.0:
        out = [_query_task(t) for t in _GEO_TASKS]
        out.sort(key=lambda t: t.get("last_run_ts") or 0.0, reverse=True)
        _TASKS_CACHE.update(at=now, value=out)
    return _TASKS_CACHE["value"]


def overview(limit: int = 40) -> dict:
    return {
        "capabilities": eng.geo_config.capabilities(),
        "claude": eng.claude_status(),   # cached — the raw probe spawns `claude --version` (~2s)
        "last_path": eng.claude_local.last_path() if hasattr(eng.claude_local, "last_path") else None,
        "deliveries": {k: deliveries(k, limit)["rows"] for k in _DELIVERY_LOGS},
        "claude_log": claude_log(limit)["rows"],
        "tasks": tasks(),
    }
