"""pitch_batch.py — daily placement-pitch sender (registered as GEO-Pitch-Sender, 08:15).

Takes every actionable listicle_pitch across brands through the SAME gates as the cockpit
button (lane autosend_email + Workspace tenant assert + BCC), capped 8 sends/brand/run for
deliverability; directory/forum/site kits are prepared-only (human guardrail). Originally the
2026-07-16 'perform all 14' batch (Cory).

Per brand: take every actionable listicle_pitch (sends ride each lane's autosend_email
gate + BCC), and take directory_claim/forum_answer to PREPARED (materials only —
community/human-only guardrail holds). 45s spacing between sends for deliverability.
neuron-hq first; AA/TB once their refresh jobs land a doc; CFO lane cycle fired LAST
(after the Claude-subscription-heavy takes) to avoid single-seat contention.
"""
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, r"C:\Users\you\Downloads\geo-cockpit\server")
from app.services import actions_service as acts  # noqa: E402

LOG = Path.home() / ".geo-flywheel" / "state" / "pitch-batch.log"
SEND_KINDS = ("listicle_pitch",)
PREP_KINDS = ("directory_claim", "forum_answer", "site_fix")
BRANDS = ["neuron-hq", "auto-advisor", "top-builder-ai", "top-practice-cfo"]
MAX_SENDS_PER_BRAND = 8   # mirror the cycle outreach cap


def log(msg: str) -> None:
    line = time.strftime("%H:%M:%S ") + msg
    print(line, flush=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def wait_for_doc(slug: str, timeout_s: int = 900) -> bool:
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        if acts.load(slug).get("generated_at"):
            return True
        time.sleep(20)
    return False


def run_brand(slug: str) -> dict:
    doc = acts.load(slug)
    if not doc.get("generated_at"):
        log(f"{slug}: no action doc yet — waiting for the refresh job")
        if not wait_for_doc(slug):
            log(f"{slug}: refresh never landed — skipped")
            return {"slug": slug, "skipped": "no doc"}
    sent = prepared = failed = 0
    for a in acts.load(slug).get("actions", []):
        kind, status = a.get("kind"), a.get("status")
        if status in ("done", "working", "hold", "dismissed", "sent"):
            continue
        if kind in SEND_KINDS and sent >= MAX_SENDS_PER_BRAND:
            log(f"{slug}: send cap reached ({MAX_SENDS_PER_BRAND}) — remaining pitches stay prepared")
            continue
        if kind not in SEND_KINDS + PREP_KINDS:
            continue
        try:
            r = acts.take(slug, a["id"])
            note = (r.get("execution_note") or "")[:110]
            log(f"{slug}: {kind} {a.get('host','')} -> {r.get('status')} | {note}")
            if r.get("status") == "sent":
                sent += 1
                time.sleep(45)   # deliverability spacing between live sends
            elif r.get("status") == "prepared":
                prepared += 1
        except Exception as e:
            failed += 1
            log(f"{slug}: {kind} {a.get('host','')} FAILED: {str(e)[:140]}")
    return {"slug": slug, "sent": sent, "prepared": prepared, "failed": failed}


def main() -> None:
    log("=== batch outreach start ===")
    results = [run_brand(s) for s in BRANDS]
    log("RESULTS: " + json.dumps(results))
    log("=== batch outreach done ===")


if __name__ == "__main__":
    main()
