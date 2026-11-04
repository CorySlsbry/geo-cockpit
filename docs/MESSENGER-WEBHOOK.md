# Messenger / Instagram webhook receiver — setup

The cockpit-side receiver is **built + tested**. It auto-replies to FB/IG comments & DMs whose
text contains one of a brand's lead-magnet keywords, sending that magnet's link.

## What's in the code
- `server/app/routers/webhooks.py` — `GET/POST /webhooks/meta`.
- `server/app/services/messenger_service.py` — Meta auth (verify-token + `X-Hub-Signature-256`
  HMAC vs the app secret) + brand lookup (by stored page/IG id) + keyword→magnet reply.
- `server/app/security.py` — the CSRF guard **exempts `/webhooks/`** (Meta signs its own POSTs;
  the Host allowlist still applies).
- Verify-token is minted once into `server/data/.meta-webhook-token` (gitignored). App secret =
  `IG_OAUTH_CLIENT_SECRET` from the central vault. Nothing is parsed until the signature checks out.

Verified locally: GET handshake echoes the challenge only on a matching verify-token; a valid
`X-Hub-Signature-256` returns `200 EVENT_RECEIVED`; a bad/absent signature is `403`; a signed IG
comment containing `PLAYBOOK` correctly routed to Auto Advisor and attempted the private reply.

## Meta-side wiring — STATUS (2026-07-13 PM)

**✅ IG comment→DM is LIVE on all 3 brands.** Done via the Graph API (not the flaky dashboard UI):

1. ✅ **Cloudflare Access path-scoped Bypass on `/webhooks/meta`** — verified (Meta reached the
   endpoint + echoed the challenge; root stays gated).
2. ⛔ **FB Messenger (`pages_messaging`) — DEFERRED** (Cory: "go after it later"). The "Engage with
   customers on Messenger" use case is already on the app, but subscribing the page `messages` field
   and auto-replying to the public needs **App Review + business verification** (the same unverified-
   brand wall as the marketplace scopes). IG comment→DM covers lead-magnet delivery without it.
3. ✅ **App-level `instagram` webhook** — set via `POST /{app-id}/subscriptions`
   (`object=instagram, callback_url=https://geo.neuron-hq.com/webhooks/meta,
   verify_token=<server/data/.meta-webhook-token>, fields=comments,messages`). `GET` confirms
   `active:true`. (Scripts: `scratchpad/subscribe_ig_fields.py`, `check_webhook_sub.py`.)
4. ✅ **Page/IG subscriptions** — `ops/subscribe_pages_to_app.py` subscribed all 3 Pages
   (`subscribed_apps:['Salisbury Video Engine']`, `subscribed_fields=feed`) + Neuron HQ's
   Instagram-Login IG directly via `graph.instagram.com`. Page-linked IG (AA, TB) events flow
   through the PAGE subscription (a direct `/{ig}/subscribed_apps` returns `(#3) capability`).
5. ✅ **Cockpit route live on 8791.**

**Gotcha for re-runs:** subscribe the page with `subscribed_fields=feed` ONLY — adding `messages`
403s `(#200) ... pages_messaging` until FB Messenger is granted (step 2).

**Pending end-to-end confirm:** comment a magnet keyword (e.g. `PLAYBOOK`) on a live IG post →
confirm the DM auto-reply fires (needs a second account).
