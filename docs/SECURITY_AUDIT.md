# GEO Cockpit — Security Audit

The cockpit + its engine touch customer data (client profiles, tokens, inbound email), so every
build/update clears the `launch-gates` → enterprise-security-audit + production-readiness gates.
This file is the running record.

## App core (2026-07-12 self-audit — committed `b9d2f65`)
Full code review of the auth model: **loopback-trust + Cloudflare Access JWT verification confirmed
sound** (a tunnelled request always carries `cf-ray` and can never be trusted as local). 6 findings
fixed: server-side brand-safety gate at the post boundary, object-level authz on audits/review/
metrics, constant-time `X-Cockpit-Local` compare, path-jail via `is_relative_to`, SQLite WAL.
Every mutation requires CSRF + Host/Origin allowlist. Details in the vault `[[GEO-Cockpit]]` note.

## Meta webhook receiver (2026-07-13 — `8497198` / wiring `69d922d`)
`POST /webhooks/meta` (FB/IG comment→DM auto-reply). Security controls:
- **Auth the provider's way, not ours:** verify-token handshake on GET (constant-time), and every
  POST body's `X-Hub-Signature-256` HMAC is checked against the vault app secret **before** any
  `json.loads` — a bad/absent signature is `403`, nothing is parsed.
- **CSRF exemption is path-scoped** to `/webhooks/` only (Meta can't send our CSRF token); the Host
  allowlist still applies.
- **Cloudflare Access Bypass is path-scoped** to `/webhooks/meta` ONLY (never the hostname), so the
  cockpit + all customer data behind `geo.neuron-hq.com` stay gated. Verified: the webhook path is
  publicly reachable (200), the root still shows the Access login wall.
- Verify-token is low-sensitivity (gitignored file); the HMAC key (app secret) lives in the vault,
  never committed.

## Email monitoring — per-mailbox Gmail (2026-07-13 — `EMAIL-MONITORING.md`)
Reads/creates replies in each brand's separate `support@<domain>` Google Workspace mailbox. Inbound
customer email = customer data, so:
- **Least privilege:** default scope is `gmail.readonly` (monitoring only). Draft/send
  (`gmail.compose`) is opt-in per mailbox via `--full`. No `gmail.modify`, no delete, no full-account
  scope.
- **Tenant isolation (fail-closed):** before reading or replying, `GmailMailbox._assert_identity`
  calls `users.getProfile` and requires the authorized account == the mailbox address; a
  mis-connected token **refuses to act** (can never read/reply from the wrong brand's inbox). The
  connect flow makes the same check and refuses to store a mismatched token.
- **Secrets at rest:** per-mailbox refresh tokens are stored only in the DPAPI-encrypted vault
  (`oauth:gmail:<address>`); access tokens are fetched on demand and auto-refreshed. No token value
  is ever printed, logged, or committed (connect/list emit addresses + scope names + booleans only).
- **Send safety:** magnet-delivery auto-send is still gated by the profile's `dry_run` (drafts until
  armed) and the responder's two-stage brand/channel verify; outreach negotiation always drafts for
  human review. The send cap (`MAX_SENDS_PER_CYCLE`) and per-send spacing are unchanged.
- **Isolation of failure:** an unconnected or erroring mailbox logs and is skipped per-client — it
  cannot break the cross-client run.

## Full email management — triage + trash (2026-07-13 — `email_manager.py` / `email_brief.py`)
Adds automated labeling, review-routing, and trashing across each `support@<domain>` mailbox, plus a
daily Slack brief. Because it can now **move customer email to Trash**, the controls tighten:
- **Least privilege, opt-in scope escalation:** management uses `gmail.modify` (read+send+label+trash)
  — added ONLY via an explicit `--manage` re-consent per mailbox. Monitoring stays on `gmail.readonly`.
  `gmail.modify` can NOT permanently delete; trash is Gmail Trash (recoverable 30 days).
- **Destructive action is gated + reversible:** `manage.dry_run` (default TRUE) gates the ONLY
  destructive action — in dry-run, trash-classified mail is just shadow-labelled `GEO/Trash-candidate`,
  never trashed. Trashing only happens when a brand is explicitly armed (`dry_run:false`). Even then it
  is recoverable, and an audit label `GEO/Trashed` is applied so trashed items are findable.
- **Customer email protected from trash:** classification trashes ONLY bulk/spam (Gmail SPAM label,
  `List-Unsubscribe`, `CATEGORY_PROMOTIONS/UPDATES`, bulk `Precedence`). Any personal, non-bulk,
  direct email is routed to `GEO/Review` and NEVER auto-trashed under any policy. A lead-magnet
  keyword always wins first (a lead is never trashed even if it looks promotional).
- **Same tenant isolation:** every label/trash call goes through the adapter's `_assert_identity`
  (token account must == mailbox address) — management can't touch the wrong brand's inbox.
- **Graceful, auditable degradation:** without `gmail.modify` the watcher logs `manage_scope_missing`
  (with the exact reconnect command) and keeps monitoring; every management action is logged to
  `~/.geo-flywheel/email-responder-log.jsonl` (`managed` records with category + labels + trashed).
- **Slack routing least-surprise:** the daily brief posts per-brand via `GEO_SLACK_WEBHOOK` resolved
  with `brand=<slug>` — a per-brand webhook if present, else the shared GEO channel; no secret values
  logged.

### Residual / follow-ups
- Auto-reply send scope (`--full`) and management (`--manage`) grant send/trash from the brand address;
  keep `manage.dry_run:true` until a brand's triage output has been reviewed in Slack, then arm.
- Per-mailbox connect is a human OAuth consent (by design — Cory signs into each Workspace account).
- ADA/WCAG + data export/delete: the cockpit UI already clears production-readiness (2026-07-12);
  this feature adds no new public UI surface.

## Optimization-loop iteration 2 — read-side authz + write-boundary hardening (2026-07-16)
Fable-5 multi-lens audit (security/correctness/efficiency/UX/GEO-accuracy/video/live-probes) of the
whole app + engine; findings self-verified by code read + live probes, fixed, and re-probed live:
- **Read-side tenant scoping closed BEFORE the client portal ships** (viewer role exists but no
  viewer logins are issued yet — these were latent, not exploited): `/api/monitor*` (cross-brand
  DM/email/social delivery logs + infra) is now **owner-only**; `/api/social/accounts` +
  `/api/social/recent` filter by `visible_slugs`; `GET /api/ads` + `/api/ads/analysis` return the
  cross-account Marketing API view (KPIs/proposals) **only to unscoped (owner/team) identities**.
- **CSRF/Origin webhook exemption narrowed** from the `/webhooks/` subtree to exactly
  `/webhooks/meta` (verified live: POST `/webhooks/other` → 403 csrf, `/webhooks/meta` → HMAC 403).
- **Spend guardrail enforced at the write boundary:** `meta_ads.apply_change('scale_budget')` now
  clamps to `max_daily_per_campaign_usd` even if a caller passes an arbitrary value; `propose()`
  can no longer mark a ROAS-keeper campaign a "confirmed loser" (D-section exclusivity) and counts
  `omni_purchase`/`leadgen` action types so converting campaigns can't be auto-paused as 0-conversion
  losers; proposals dedupe per (campaign, action). Verified live: 1 proposal (review), no
  winner-pause conflicts.
- **State-file race hardening:** `<slug>-actions.json` writers (cockpit + detached producer) now
  share a cross-process lockfile (`action_state.locked`), write via per-PID tmp names, re-load
  fresh state before every save, and the producer's report-back releases the lane video lock even
  when its action was re-derived away (orphaned-lock fix).
- **Slug path-jail** on the actions state path (regex-validated slug; defense in depth).
- Live black-box re-probe on the running server: unauth-with-cf-ray → 401, garbage JWT → 401,
  mutation without CSRF → 403, `/docs`/`/openapi.json` → SPA shell only (Swagger disabled),
  loopback-trust behavior unchanged.
- New surfaces this iteration (generic `/api/jobs/*`, `/api/action-center`) authed with the same
  object-level `ensure_slug_visible` pattern; action-center returns ads state to owner only.

## Meta ads management — spend-changing write surface (2026-07-14 — `meta_ads.py` / `POST /api/ads/apply`)
The optimizer can change ad budgets / pause campaigns (real money), so it is fenced:
- **Human-approved by default:** `mode=propose`, `auto_apply=false`. `meta_ads.apply_change()` REFUSES
  without `approve=True`; the cockpit's `POST /api/ads/apply` is the only path that sets it, and it is an
  owner-authenticated mutation (CSRF token + Host/Origin allowlist via GuardMiddleware). No autonomous spend.
- **Bounded blast radius (guardrails):** $30/day/campaign hard cap, ≤+25% budget change per step, pause only
  when ROAS < 1.0 over the window. A single approved action can't swing spend wildly.
- **Fails closed on missing data:** a campaign with no ROAS data is flagged *review*, never auto-adjusted.
- **Least privilege + secret at rest:** `ads_read`+`ads_management` on the owner's own ad account; the
  long-lived token lives only in the DPAPI vault (`META_ADS_ACCESS_TOKEN`), never printed/committed. Every
  apply is logged to `~/.geo-flywheel/ads-actions.jsonl`.
- **Residual:** the token grant was via Graph API Explorer (short-lived token was pasted in chat once and
  self-expires; the long-lived derived token was never exposed). A Business Manager System User token would
  remove the periodic-reconnect need. Conversion tracking must be wired before ROAS-based automation is useful
  (see `ADS-MANAGEMENT.md`).

## Automated security checks - 2026-08-21T22:15:18 (RED - GATE BLOCKED)

| check | status | detail |
|---|---|---|
| gitleaks | RED | 8 secret(s) detected: {'generic-api-key': 8} in ['C:/Users/you/Downloads/geo-cockpit/desktop/dist/win-unpacked/resources.pak:37 (worktree)', 'C:/Users/you/Downloads/geo-cockpit/desktop/dist/win-unpacked/resources.pak:66 (worktree)', 'C:/Users/you/Downloads/geo-cockpit/desktop/dist/win-unpacked/re |
| mcp | SKIPPED | no --mcp-manifest given (pass the WebMCP/MCP manifest if the app exposes tools) |
| prompt_injection | SKIPPED | no --agent-url given (pass the app's LLM/agent endpoint to red-team it) |

Source: launch-gates/enterprise-security-audit/scripts/run_security_checks.py - gitleaks (history + worktree), MCP manifest/auth, prompt-injection red-team (vault Lib-Security-AI). Full detail: docs/security/checks-*.json. RED blocks the gate; SKIPPED = probe not configured, NOT a pass.

## Automated security checks - 2026-08-21T22:17:37 (no RED)

| check | status | detail |
|---|---|---|
| gitleaks | PASS | no secrets in git history or working tree |
| mcp | SKIPPED | no --mcp-manifest given (pass the WebMCP/MCP manifest if the app exposes tools) |
| prompt_injection | SKIPPED | no --agent-url given (pass the app's LLM/agent endpoint to red-team it) |

Source: launch-gates/enterprise-security-audit/scripts/run_security_checks.py - gitleaks (history + worktree), MCP manifest/auth, prompt-injection red-team (vault Lib-Security-AI). Full detail: docs/security/checks-*.json. RED blocks the gate; SKIPPED = probe not configured, NOT a pass.
