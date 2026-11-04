# geo cockpit

> **Portfolio snapshot.** A sanitized, history-free copy of a private repository, published to show the work.
> Credentials, customer and lead data, internal notes and third-party material were removed, and real client
> and people names were replaced with fictional ones, so this copy is not meant to run as-is.

- **What it is:** A web and desktop control panel for the pluggable GEO (AI-search) content flywheel.
- **Stack:** React, Tailwind, FastAPI
- **Languages:** TypeScript, Python, JavaScript, PowerShell
- **Private repo history:** 55 commits, 2026-07-12 to 2026-08-24
- **This snapshot:** 114 files
- **Built by:** Cory Salisbury, with Claude Code

_All rights reserved. Shared for portfolio review only; no license is granted to copy, modify or redistribute this code._

---

A premium web + desktop control panel for the pluggable GEO flywheel. Run audits, review/approve
draft posts, onboard + connect + arm clients, and monitor deliveries — from anywhere at
**https://geo.neuron-hq.com**, with the AI work running on the Claude Max **subscription** (via the
engine's `claude_local` adapter, no metered API cost).

```
geo-cockpit/
  server/    FastAPI backend (127.0.0.1:8791) — imports the GEO engine in-process, serves the API + the built SPA
  web/       React + Vite + Tailwind premium SPA (built to web/dist, served by the backend)
  desktop/   Electron launcher — starts the backend hidden (no terminal), confirms Claude, hosts the cockpit; -> .exe
  ops/       Cloudflare tunnel config + setup-remote.ps1 + NEEDS-CORY.md (go-live checklist)
```

## Architecture
- The backend wraps the engine (`~/.claude/skills/geo-flywheel/references/engine`) **in-process** through
  one boundary (`server/app/engine_bridge.py`). It never weakens the engine's guardrails: community
  channels are copy-only, owned posts are `dry_run`-gated by the engine, arming is an atomic validated
  `dry_run` flip, and editing a draft re-runs the deterministic brand-safety gate.
- Long audits run as background jobs (SQLite `cockpit.db` + a thread pool), streamed to the UI over SSE.
- Auth, built once: **Cloudflare Access** at the edge → the app verifies the `Cf-Access-Jwt-Assertion`
  header → email→role (owner/team/client, with a per-client slug filter). The `127.0.0.1` bind means only
  cloudflared reaches it. The desktop app authenticates locally via a per-run `X-Cockpit-Local` token so it
  is trusted on the loopback without opening the same bypass to remote requests.

## Develop
```bash
# backend (dev auth bypass; localhost only)
cd server && COCKPIT_DEV=1 python -m uvicorn app.main:app --host 127.0.0.1 --port 8791
# frontend (proxied to the backend); or build once and let the backend serve it
cd web && npm install && npm run dev        # http://localhost:5273
cd web && npm run build                     # -> web/dist, served at http://127.0.0.1:8791
```

## Ship
- Remote: `ops/setup-remote.ps1` + a Cloudflare Access app (see `ops/NEEDS-CORY.md`).
- Desktop: `cd desktop && npm run dist` → `desktop/dist/*.exe`.

## Guardrail note
The cockpit is a *gated caller* over the engine, not a bypass. It cannot auto-post to community
platforms, cannot post from an unarmed (dry-run) client, and re-checks the brand-safety gate on every
edit before allowing an owned post.
