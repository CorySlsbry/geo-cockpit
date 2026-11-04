"""mail_audit.py — the sent-mail quality surface.

GET  /api/mail-audit          -> last report + run history + when the next run is due
POST /api/mail-audit/run      -> run one now (background job; the SPA follows /api/jobs/<id>)
POST /api/mail-audit/resume   -> re-enable GEO-Pitch-Sender after a halt (owner's call)

Owner-only: these read every brand's sent mail (customer data) and the resume flips a
spend/send-affecting stream back on.
"""
from __future__ import annotations

import subprocess

from fastapi import APIRouter, Depends, HTTPException

from app.auth import require_owner
from app.services import mail_audit_service as svc
from app.services.jobs import JOBS

router = APIRouter(prefix="/api/mail-audit", tags=["mail-audit"])


@router.get("")
def get_audit(ident: dict = Depends(require_owner)):
    running = JOBS.running_for("_mail_audit", kinds=("mail_audit",))
    return {
        "report": svc.last_report(),
        "history": svc.history(),
        "due_in_s": round(svc.due_in_seconds()),
        "interval_h": svc.INTERVAL_H,
        "job_id": running,
        "sender_enabled": _pitch_sender_enabled(),
    }


def _pitch_sender_enabled() -> bool | None:
    """Is GEO-Pitch-Sender armed? (An audit halt disables it.) None = unknown."""
    try:
        r = subprocess.run(["schtasks", "/query", "/tn", "GEO-Pitch-Sender", "/fo", "list"],
                           capture_output=True, text=True, timeout=20)
        if r.returncode != 0:
            return None
        for line in (r.stdout or "").splitlines():
            if line.lower().startswith("status:"):
                return "disabled" not in line.lower()
    except Exception:
        pass
    return None


@router.post("/run")
def run_now(ident: dict = Depends(require_owner)):
    existing = JOBS.running_for("_mail_audit", kinds=("mail_audit",))
    if existing:
        return {"job_id": existing, "status": "running", "already_running": True}
    job_id = JOBS.enqueue_fn("mail_audit", "_mail_audit",
                             lambda progress: svc.run(progress=progress))
    return {"job_id": job_id, "status": "queued"}


@router.post("/resume")
def resume_sender(ident: dict = Depends(require_owner)):
    """Re-arm the pitch sender after a halt. Deliberately manual: the halt means a broken
    email really shipped, so a human confirms the root cause is fixed."""
    try:
        r = subprocess.run(["schtasks", "/Change", "/TN", "GEO-Pitch-Sender", "/ENABLE"],
                           capture_output=True, text=True, timeout=20)
        if r.returncode != 0:
            raise HTTPException(400, (r.stderr or r.stdout or "enable failed")[:200])
        (svc.STATE_DIR / "pitch-sender-halted.txt").unlink(missing_ok=True)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e)[:200])
    return {"ok": True, "sender_enabled": True}
