/**
 * copy.ts — the ONE place customer-facing wording lives.
 *
 * The engine's internal nouns (lane, cadence, arm, dry_run, brand-lock) are precise and they
 * stay in the API, the config and the Python. They are also the fastest way to make a buyer
 * feel like they are reading someone else's control panel. This module translates them at the
 * UI boundary only: outcomes on screen, engine vocabulary underneath.
 *
 * Rule when adding: name what the user GETS, not what the system DOES.
 */

export const COPY = {
  /* ---- publishing state (was ARMED / DRY-RUN) ---- */
  live: "Live",
  preview: "Preview mode",
  goLive: "Go live",
  pausePublishing: "Pause publishing",
  goLiveExplain:
    "Going live lets approved channels publish automatically. Everything else stays draft-only.",
  pauseExplain:
    "Pausing returns this brand to preview mode. Work still gets produced, nothing gets published.",
  previewOnlyHint: "Preview publishes nothing. It shows exactly what would go out.",

  /* ---- schedule (was cadence / dials) ---- */
  schedule: "Publishing schedule",
  scheduleSub: "How much this brand publishes, per channel",
  atCap: "At its limit for now",
  atCapExplain:
    "Everything is at its scheduled limit. Nothing is wrong; raise a limit to publish more.",

  /* ---- the locks (was channel-lock / account-lock / BLOCKED) ---- */
  safetyLock: "Safety lock",
  lockOk: "Verified account",
  lockBlocked: "Safety lock: wrong account detected, publishing blocked",
  lockExplain:
    "Each channel is verified against the account it claims to be, in code, before anything posts.",

  /* ---- audit form (was Max measure / Max drafts / No LLM) ---- */
  auditQuestions: "Questions to check",
  auditQuestionsHint: "Leave blank to check all of them",
  auditDrafts: "Drafts to write",
  auditModel: "Writing model",
  auditMeasureOnly: "Measure only, write nothing",

  /* ---- mail ---- */
  resumeSending: "Resume sending",

  /* ---- empty / all-clear states ---- */
  allClear: "All clear. Nothing is waiting on you.",
} as const;

/** ARMED/DRY-RUN chip label + tone from the engine's boolean. */
export function publishState(isLive: boolean): { label: string; tone: "ok" | "dim" } {
  return isLive ? { label: COPY.live, tone: "ok" } : { label: COPY.preview, tone: "dim" };
}
