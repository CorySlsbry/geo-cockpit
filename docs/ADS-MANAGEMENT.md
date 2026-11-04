# Meta Ads — propose-then-approve optimizer (COMPLEMENTS Andromeda)

The cockpit's **Ads** page tracks live Meta campaigns and proposes changes against guardrails.
Nothing changes spend automatically — every change is a human click (mode=`propose`).

## Philosophy: complement Andromeda, don't fight it (Cory 2026-07-14, Dante lens)
Andromeda is Meta's creative-matching retrieval engine — you win by **loading the gun with creative**
and letting it optimize, not by micro-managing budgets/audiences. The optimizer is tuned to that:
- **Winner → MORE CREATIVE on the angle, not a bigger budget** (`scale_creative`/`add_creative` are the
  primary proposals, routed to the content/HeyGen pipeline). Multiply the angle, not the dollars.
- **Budget edits are small (≤20%) + rate-limited** (`budget_change_cooldown_days`) so they don't reset the
  learning phase. Budget scale is a *secondary*, out-of-learning-only move.
- **Never pause on thin data** — under `min_spend_to_judge_usd` a loser gets a `hold` ("let it finish
  learning"), not a pause. Pausing mid-learning fights Andromeda.
- **Consolidate** toward fewer Advantage+/broad campaigns (Andromeda rewards consolidation).
- **CAPI must fire on a QUALIFIED event** (real purchase / ICP-qualified booking), never a raw form-fill —
  firing on junk trains Andromeda to find more junk.
Config: `~/.geo-flywheel/ads-config.json` → `philosophy: complement-andromeda` + the guardrail knobs.

## Pieces
- **`engine/meta_ads.py`** — Marketing API client. `campaigns()`/`insights()` read; `propose()` returns
  guardrail-compliant recommendations; `apply_change(..., approve=True)` is the ONLY writer (logged to
  `~/.geo-flywheel/ads-actions.jsonl`). `post_proposals_to_slack()` powers the daily task.
- **Cockpit `/api/ads`** — Bridge tracking + live campaigns + proposals. **`POST /api/ads/apply`** applies
  one approved proposal (owner-only; CSRF + Host/Origin enforced). The Ads page's **Approve** buttons call it.
- **`GEO-Ads-Optimizer`** scheduled task — daily 08:00, posts the proposal queue to Slack.
- **Config** `~/.geo-flywheel/ads-config.json`: `mode=propose`, `auto_apply=false`, guardrails
  (**$30/day/campaign cap, +20%/step, 4-day budget cooldown, pause ROAS<1.0 only past $50 learning floor,
  ≥5 creatives/campaign, 7-day A/B**), `primary_ad_account`.
- **Token**: vault `META_ADS_ACCESS_TOKEN` (long-lived, `ads_read`+`ads_management`). Non-expiring; if it
  ever dies, reconnect via Graph API Explorer and re-store.

## Security
- Spend changes are **human-approved** (`auto_apply=false`); `apply_change` refuses without `approve=True`
  and logs every call. Guardrails cap the blast radius of any single change.
- The optimizer **fails closed**: a campaign with no ROAS data gets a *review* flag, never an auto budget move.
- Ad-account scope (`ads_management`) is a new write surface — see `SECURITY_AUDIT.md`.

## ⚠️ Conversion tracking — the ROAS guardrail needs Purchase events (NEEDS CORY)
Right now `propose()` can only *flag* campaigns, not optimize them, because **no Purchase events are firing**
(30d: 182 clicks, 135 landing-page views, **0 purchases**). The pixel + purchase optimization ARE set up
correctly; the missing piece is the Purchase event firing at checkout completion. Fix either/both:

1. **Verify the base pixel fires on the landing page** — Meta **Events Manager → Test Events**, open
   `neuron-hq.com/chatgpt-test`, confirm a `PageView` shows. (Pixel last fired 2026-07-09 — if it's silent
   while the ad drives traffic, the base snippet is missing on the current page.)
2. **Fire the `Purchase` event on checkout completion (the important one).** Since checkout is Stripe, the
   robust path is the **Meta Conversions API (CAPI)** server-side: on the Stripe `checkout.session.completed`
   webhook, POST a `Purchase` event (with `value` + `currency` + an `event_id` to dedup vs the browser pixel)
   to the pixel. This survives ad-blockers/iOS and is the reliable ROAS source. (Assistant can build this in
   the Neuron app repo — it's a server-side webhook handler, not a cockpit change.)

Once Purchase events flow, `propose()` starts returning real *pause ROAS<1* / *scale winner* proposals, and
the daily Slack + the cockpit Approve buttons become actionable.
