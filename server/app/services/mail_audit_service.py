"""mail_audit_service.py — the cockpit owns the 24h sent-mail audit.

Cory's standing order (2026-07-17): every 24h, prove we didn't send anything embarrassing;
fix errors in any email stream proactively. Faulty emails (placeholders, generator
scaffolding, "Hi [First Name],") prove we are NOT a high-grade AI system.

The detector itself lives in the ENGINE (`engine/mail_audit.py`) — the cockpit is a gated
caller, never a re-implementation. This service adds what a scheduled task can't:

  * an IN-COCKPIT scheduler: an hourly tick that runs the audit when one is DUE
    (>= INTERVAL_H since the last run). Due-ness beats a fixed clock time because the
    backend restarts (supervisor) — a missed 08:05 is caught up on the next tick instead
    of being silently skipped for the day.
  * on-demand runs from the UI (through the jobs runner, so the SPA gets progress)
  * the report + history for the Mail Audit page and the Dashboard action center

Halting stays the engine's call (`halt_pitch_sender`): a critical defect that actually
SHIPPED disables GEO-Pitch-Sender so a bad night can't ship a second day of bad mail.
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime
from pathlib import Path

from app import engine_bridge as eng

log = logging.getLogger("cockpit.mail_audit")

STATE_DIR = Path.home() / ".geo-flywheel" / "state"
INTERVAL_H = 24          # Cory's cadence: every 24 hours
TICK_S = 3600            # check hourly; run only when due
WINDOW_H = 24            # how much sent mail each run inspects

_lock = threading.Lock()


def last_report() -> dict | None:
    """The most recent audit (what the UI shows)."""
    try:
        import json
        return json.loads((STATE_DIR / "mail-audit.json").read_text(encoding="utf-8"))
    except Exception:
        return None


def history(limit: int = 30) -> list[dict]:
    """One line per past run — the trend that proves we stay clean."""
    path = STATE_DIR / "mail-audit.jsonl"
    if not path.is_file():
        return []
    import json
    out = []
    for line in path.read_text(encoding="utf-8").splitlines()[-limit:]:
        try:
            out.append(json.loads(line))
        except Exception:
            continue
    return list(reversed(out))


def _last_run_ts() -> float:
    r = last_report()
    if not r or not r.get("at"):
        return 0.0
    try:
        return datetime.fromisoformat(r["at"]).timestamp()
    except Exception:
        return 0.0


def due_in_seconds() -> float:
    """Seconds until the next audit is due (<=0 means due now)."""
    return (_last_run_ts() + INTERVAL_H * 3600) - time.time()


def run(progress=None, hours: int = WINDOW_H, halt_on_critical: bool = True) -> dict:
    """Run one audit through the engine. Serialized: two concurrent runs would double-post
    Slack and race the seen-set."""
    tick = progress or (lambda **kw: None)
    if not _lock.acquire(blocking=False):
        raise RuntimeError("an audit is already running")
    try:
        m = eng.mail_audit
        boxes = m.connected_mailboxes()
        tick(phase="scan", pct=10,
             log_line=f"reading sent mail (last {hours}h) across {len(boxes)} mailbox(es)...")

        all_defects, total = [], 0
        for i, box in enumerate(boxes):
            tick(phase="scan", pct=10 + int(70 * i / max(1, len(boxes))),
                 log_line=f"auditing {box}...")
            d, n = m.audit_mailbox(box, hours)
            all_defects.extend(d)
            total += n

        tick(phase="report", pct=85, log_line="classifying defects...")
        seen = m._seen()
        new_defects = [d for d in all_defects if d.get("message_id") not in seen]
        known = len(all_defects) - len(new_defects)
        crit = [d for d in new_defects if d["severity"] == "critical"]

        import json
        report = {"at": time.strftime("%Y-%m-%dT%H:%M:%S"), "hours": hours, "mailboxes": boxes,
                  "messages_checked": total, "defects": new_defects, "all_defects": all_defects,
                  "new_defects": len(new_defects), "known_defects": known, "critical": len(crit)}
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        (STATE_DIR / "mail-audit.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
        with (STATE_DIR / "mail-audit.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps({"at": report["at"], "messages_checked": total,
                                "new_defects": len(new_defects), "critical": len(crit)}) + "\n")

        # a defect that actually shipped => stop the stream before it ships another day
        report["halted"] = False
        if crit and halt_on_critical:
            report["halted"] = m.halt_pitch_sender(f"{len(crit)} critical defect(s) shipped")

        text = _slack_text(report)
        m.post_slack(text)
        report["slack_text"] = text
        m._mark_seen([d.get("message_id") for d in new_defects if d.get("message_id")])
        tick(phase="done", pct=100,
             log_line=f"{total} message(s) checked, {len(new_defects)} new defect(s)")
        return report
    finally:
        _lock.release()


def _slack_text(r: dict) -> str:
    kn = f" ({r['known_defects']} known/triaged ignored)" if r.get("known_defects") else ""
    if not r["defects"]:
        return (f":white_check_mark: *Mail audit* — {r['messages_checked']} message(s) sent in "
                f"{r['hours']}h across {len(r['mailboxes'])} mailbox(es){kn}. Clean: no "
                f"placeholders, no scaffolding, no broken greetings.")
    lines = [f":mag: *Mail audit — {len(r['defects'])} NEW DEFECT(S)* in "
             f"{r['messages_checked']} sent message(s) ({r['hours']}h){kn}"]
    for d in r["defects"][:10]:
        icon = ":rotating_light:" if d["severity"] == "critical" else ":warning:"
        lines.append(f"{icon} `{d['check']}` → {d.get('to','?')[:40]}\n     _{d.get('context','')[:120]}_")
    if len(r["defects"]) > 10:
        lines.append(f"     …and {len(r['defects']) - 10} more — see the cockpit → Mail Audit")
    if r.get("halted"):
        lines.append(":octagonal_sign: *GEO-Pitch-Sender DISABLED* — a broken email shipped. "
                     "Fix the root cause, then re-enable from the Mail Audit page.")
    return "\n".join(lines)


# ---------------------------------------------------------------- scheduler
def _loop() -> None:
    # let the backend finish booting before the first (possibly slow) Gmail scan
    time.sleep(90)
    while True:
        try:
            if due_in_seconds() <= 0:
                log.info("mail audit due -> running")
                r = run()
                log.info("mail audit done: %s checked, %s new defect(s), halted=%s",
                         r["messages_checked"], r["new_defects"], r.get("halted"))
        except Exception as e:                       # a bad audit must never kill the cockpit
            log.warning("mail audit tick failed: %s", str(e)[:200])
        time.sleep(TICK_S)


def start_scheduler() -> None:
    t = threading.Thread(target=_loop, name="mail-audit", daemon=True)
    t.start()
    log.info("mail audit scheduler started (every %sh, hourly due-check)", INTERVAL_H)
