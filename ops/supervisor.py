#!/usr/bin/env python3
"""
supervisor.py - keep the GEO Cockpit backend + Cloudflare tunnel alive, hidden and self-healing.

Run by the "GEO-Cockpit" scheduled task at logon via pythonw (so no console window). It spawns both
children with CREATE_NO_WINDOW; if either dies it respawns within ~10s. It defers to whatever already
owns port 8791 (e.g. the desktop .exe) instead of fighting for it, and it NEVER runs the exposed
backend in dev/bypass mode (COCKPIT_DEV is stripped from the child env).
"""
from __future__ import annotations

import datetime
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

SERVER = Path(r"C:\Users\you\Downloads\geo-cockpit\server")
CF = r"C:\Program Files (x86)\cloudflared\cloudflared.exe"
CFG = str(Path.home() / ".cloudflared" / "config.yml")
LOG = Path.home() / ".geo-flywheel" / "logs" / "cockpit-supervisor.log"
CREATE_NO_WINDOW = 0x08000000
PORT = 8791
# The task runs us under pythonw (no window) -> sys.executable is pythonw.exe, whose sys.stdout/stderr
# are None and make uvicorn's logging crash on startup. Spawn the backend with python.exe instead
# (CREATE_NO_WINDOW still hides its console) so it has real stdio.
PYTHON = str(Path(sys.executable).with_name("python.exe"))
# Prefer the project venv (self-contained deps under Downloads, which the task CAN access — unlike
# the pip --user site-packages under AppData\Roaming, which the scheduled-task profile can't see).
VENV_PY = SERVER / ".venv" / "Scripts" / "python.exe"
BE_LOG = LOG.parent / "cockpit-backend.log"
TUN_LOG = LOG.parent / "cockpit-tunnel.log"


def _out(path: Path):
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        return open(path, "a", encoding="utf-8", buffering=1)
    except Exception:
        return subprocess.DEVNULL


def log(msg: str) -> None:
    try:
        LOG.parent.mkdir(parents=True, exist_ok=True)
        with LOG.open("a", encoding="utf-8") as f:
            f.write(f"{datetime.datetime.now().isoformat(timespec='seconds')} {msg}\n")
    except Exception:
        pass


def port_open(port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


def _user_site_dirs() -> list[str]:
    """The pip --user site-packages (fastapi/uvicorn/jwt live here). A scheduled-task context can
    drop user-site from sys.path AND resolve HOME/APPDATA oddly, so we lead with the known absolute
    path and only add computed ones if they actually exist on disk."""
    candidates = [r"C:\Users\you\AppData\Roaming\Python\Python313\site-packages"]
    try:
        import site
        us = site.getusersitepackages()
        if us:
            candidates.append(us)
    except Exception:
        pass
    return [d for d in dict.fromkeys(candidates) if os.path.isdir(d)]


def _child_env() -> dict:
    e = dict(os.environ)
    e.pop("COCKPIT_DEV", None)  # the tunnelled backend must NEVER bypass auth
    extra = _user_site_dirs()
    if extra:
        cur = e.get("PYTHONPATH", "")
        e["PYTHONPATH"] = os.pathsep.join(extra + ([cur] if cur else []))
    log(f"backend env PYTHONPATH={e.get('PYTHONPATH', '(none)')}")
    return e


def spawn_backend():
    if port_open(PORT):
        return None  # something already serves 8791 (e.g. the desktop app) -> defer
    log("spawning backend")
    exe = str(VENV_PY) if VENV_PY.is_file() else (PYTHON if Path(PYTHON).is_file() else sys.executable)
    return subprocess.Popen(
        [exe, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(PORT)],
        cwd=str(SERVER), env=_child_env(), creationflags=CREATE_NO_WINDOW,
        stdin=subprocess.DEVNULL, stdout=_out(BE_LOG), stderr=subprocess.STDOUT)


def spawn_tunnel():
    if not Path(CF).is_file():
        log("cloudflared not found")
        return None
    log("spawning tunnel")
    return subprocess.Popen(
        [CF, "--config", CFG, "tunnel", "run", "geo-cockpit"],
        creationflags=CREATE_NO_WINDOW,
        stdin=subprocess.DEVNULL, stdout=_out(TUN_LOG), stderr=subprocess.STDOUT)


def alive(p) -> bool:
    return p is not None and p.poll() is None


def main() -> None:
    log("supervisor start")
    backend = spawn_backend()
    tunnel = spawn_tunnel()
    while True:
        time.sleep(10)
        if not alive(backend):
            backend = spawn_backend()
        if not alive(tunnel):
            tunnel = spawn_tunnel()


if __name__ == "__main__":
    main()
