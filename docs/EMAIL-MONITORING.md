# Email monitoring — per-mailbox Gmail (support@<domain>)

Each brand's `support@<domain>` is a **separate Google Workspace mailbox**. The flywheel's email
responder/monitor reads (and, with the compose scope, replies to) each one using a **per-mailbox
OAuth token** stored in the central DPAPI vault. One connect per mailbox; it auto-refreshes forever.

## Architecture
- **`connect_gmail.py`** (engine) — one-time consent per mailbox. Reuses the existing Google OAuth
  client (`~/.youtube-tokens/client_secret.json` — no new Cloud project). Stores
  `oauth:gmail:<address>` in the vault via the same token manager YouTube uses.
- **`GmailMailbox`** (in `email_watcher.py`) — the LIVE adapter. Stdlib-only Gmail REST via an
  auto-refreshing vault token: `messages.list`/`get` to read, `messages.send` / `drafts.create` to
  reply. Selected with `python email_watcher.py --adapter gmail`.
- The watcher's existing spine is unchanged: classify → verified reply (two-stage) → channel-verify →
  auto-send magnet deliveries (unless the profile is `dry_run`, which drafts) / draft outreach.

## Connect a mailbox (NEEDS CORY — one browser sign-in each)
```
cd <engine dir>   # ...\skills\geo-flywheel\references\engine
python connect_gmail.py --list                          # shows all 4 mailboxes + status
python connect_gmail.py --address support@autoadvisorpartners.com          # read-only (monitor)
python connect_gmail.py --address support@autoadvisorpartners.com --full   # + draft/send (auto-reply)
```
Sign into **that brand's** Google account in the browser and approve. The four mailboxes:
`support@autoadvisorpartners.com`, `support@neuron-hq.com`, `support@topbuilderai.com`,
`support@toppracticecfo.com`.

## Scopes (least privilege)
- `gmail.readonly` — read the inbox (monitoring). **Default.**
- `gmail.compose` — create drafts + send (auto-reply). Added only with `--full`.
- `gmail.modify` — read + send + label + trash (**full management**). Added only with `--manage`.
  Trash is recoverable (30d); this scope can NOT permanently delete.

## Full management (triage: label / review / trash + daily brief)
`email_manager.py` triages every new message and acts on it; `email_brief.py` posts a daily digest.
Enabled per brand via `profile.email.manage = {enabled, trash_policy, dry_run}` (all 4 profiles have
`{enabled:true, trash_policy:"moderate", dry_run:true}`; `geo_onboard.py` sets this default too).

**To turn it on, re-consent each mailbox with the management scope (one browser sign-in each):**
```
python connect_gmail.py --address support@autoadvisorpartners.com --manage
python connect_gmail.py --address support@neuron-hq.com --manage
python connect_gmail.py --address support@topbuilderai.com --manage
python connect_gmail.py --address support@toppracticecfo.com --manage
python connect_gmail.py --list      # CAPABILITY column should read "FULL management"
```
Until a mailbox has `gmail.modify`, the watcher logs `manage_scope_missing` (with the exact command)
and keeps monitoring/replying — management just no-ops.

**Triage (each new message → one class, Gmail signals first, LLM only for replies):**
| Class | What it is | Action |
|---|---|---|
| `magnet_request` | contains a lead-magnet keyword | auto-reply the magnet + label `GEO/Leads` |
| `outreach_reply` | a reply to our outreach | draft for review + label `GEO/Review` |
| `review` | a real, personal, direct email | label `GEO/Review` (never trashed) |
| `notify` | an automated update we keep | label `GEO/FYI` + mark read |
| `trash` | spam / bulk promo / (moderate) routine updates | Trash (recoverable) + label `GEO/Trashed` |

**Trash policy** (`manage.trash_policy`): `conservative` (spam + promos-with-unsubscribe only) ·
`moderate` (default — also routine notifications/newsletters) · `label_only` (never auto-trash; just
label `GEO/Trash-candidate`). Personal, non-bulk email is NEVER auto-trashed under any policy.

**dry_run** (`manage.dry_run`, default true): labels + mark-read + briefs run, but junk is only
**shadow-labelled** `GEO/Trash-candidate` (not actually trashed) and replies stay drafts. Flip to
`false` (arm) per brand to let it trash + auto-send for real.

**Daily brief** (`GEO-Email-Brief` task, 7:30am): one Slack post per brand — review queue, leads,
FYI, trashed, inbox-unread — routed brand-aware via `GEO_SLACK_WEBHOOK` (per-brand override if set,
else the shared #seo-geo-updates channel).

## Run the monitor
```
python email_watcher.py --adapter gmail --once      # one poll across every connected mailbox
python email_watcher.py --adapter gmail             # continuous (default 180s)
```
An unconnected mailbox logs `adapter_unavailable` and is skipped — it can never block the others.
Dedup: read-only can't mark-as-read, so handled message ids are tracked in
`~/.geo-flywheel/email-seen/<address>.json` (a message is handled exactly once).

## Security posture — see `SECURITY_AUDIT.md`
Tenant isolation (the token's authorized account must equal the mailbox address, or it refuses to
act), least-scope, tokens encrypted at rest in the vault, no secret values ever logged.
