// api.ts — the one place the SPA talks to the backend. Handles the CSRF token for mutations.
let _csrf: string | null = null;

async function csrf(): Promise<string> {
  if (_csrf) return _csrf;
  const r = await fetch("/api/csrf");
  if (!r.ok) throw new Error("not authenticated");
  _csrf = (await r.json()).token;
  return _csrf!;
}

type Opts = { method?: string; body?: unknown };

async function req<T = any>(path: string, { method = "GET", body }: Opts = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  if (method !== "GET") headers["x-cockpit-token"] = await csrf();
  const r = await fetch(path, init);
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try {
      const d = await r.json();
      msg = d.detail || d.error || msg;
    } catch {
      /* ignore */
    }
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  const ct = r.headers.get("content-type") || "";
  return (ct.includes("application/json") ? r.json() : r.text()) as Promise<T>;
}

export const api = {
  system: () => req("/api/system"),
  dashboard: () => req("/api/metrics/dashboard"),
  series: (source: string, metric: string, brand: string, days = 180) =>
    req(`/api/metrics/series?source=${source}&metric=${metric}&brand=${brand}&days=${days}`),

  actionCenter: () => req("/api/action-center"),
  job: (id: string) => req(`/api/jobs/${id}`),
  jobResult: (id: string) => req(`/api/jobs/${id}/result`),
  jobEventsUrl: (id: string) => `/api/jobs/${id}/events`,

  clients: () => req("/api/clients"),
  clientDetail: (slug: string) => req(`/api/clients/${slug}`),
  arm: (slug: string) => req(`/api/clients/${slug}/arm`, { method: "POST", body: { confirm_slug: slug } }),
  // `enabled` is the PER-KIND switch (this one content kind, on this lane). Distinct from
  // setClientEnabled below, which switches the whole lane.
  setCadence: (slug: string, updates: Record<string, { count: number; per: string; enabled?: boolean }>) =>
    req(`/api/clients/${slug}/cadence`, { method: "POST", body: { updates } }),
  // Output size for this lane's renders. A preset name, an alias, or WxH — the engine raises on
  // a typo rather than quietly falling back to 16:9.
  setVideoFormat: (slug: string, format: string) =>
    req(`/api/clients/${slug}/video-format`, { method: "POST", body: { format } }),
  // Reel style (which short-form modes rotate). Writes lanes.json via the engine registry —
  // the file the SHORT renderer actually reads. Unknown styles and disallowed lanes 400.
  setShortStyle: (slug: string, style: string) =>
    req(`/api/clients/${slug}/short-style`, { method: "POST", body: { style } }),
  // Narrated vs character-led, per video kind. Enforced at RENDER time (the engine reads the
  // profile), so this is a setting, not a suggestion to a prompt.
  // The FULL CHAIN: one longtail phrase -> blog -> longform | short | still, detached on the
  // server. Status is a state file the orchestrator rewrites on every step transition, so the
  // stepper's pulse reflects real work, not an animation timer.
  // `only` runs a SUBSET (the per-step buttons); omitted = the full chain, unchanged.
  // post_slug is the published post the non-blog steps aim at, or "manual" to resolve it from
  // the phrase server-side.
  runChain: (slug: string, phrase: string, opts?: { only?: string[]; post_slug?: string }) =>
    req(`/api/clients/${slug}/chain`, { method: "POST", body: { phrase, ...(opts || {}) } }),
  chainStatus: (slug: string) => req(`/api/clients/${slug}/chain`),
  // The lane's most recent posts - what a single step can be pointed at.
  recentPosts: (slug: string, limit = 5) =>
    req(`/api/clients/${slug}/posts?limit=${limit}`),
  setNarration: (slug: string, kind: string, mode: string) =>
    req(`/api/clients/${slug}/narration`, { method: "POST", body: { kind, mode } }),
  // The FIXED voice per character role (female / male / bot) - the same three voices on every
  // video, because a character whose voice changes between videos is a different character.
  setCharacterVoices: (slug: string, voices: { female: string; male: string; bot: string }) =>
    req(`/api/clients/${slug}/character-voices`, { method: "POST", body: voices }),
  listElevenVoices: () => req(`/api/clients/voices/eleven`),
  research: (slug: string) => req(`/api/clients/${slug}/research`),
  researchRun: (slug: string) => req(`/api/clients/${slug}/research`, { method: "POST" }),
  researchApply: (slug: string) => req(`/api/clients/${slug}/research/apply`, { method: "POST" }),
  // per-client market research + marketing engine (neuron-research pair)
  researchClients: () => req("/api/research/clients"),
  researchClientSync: (slug: string) => req(`/api/research/clients/${slug}/sync`, { method: "POST" }),
  researchClientRun: (slug: string, kind: "research" | "marketing") =>
    req(`/api/research/clients/${slug}/run`, { method: "POST", body: { kind } }),
  researchClientCadence: (slug: string) => req(`/api/research/clients/${slug}/cadence`),
  researchClientCadenceSet: (slug: string, every_weeks: number) =>
    req(`/api/research/clients/${slug}/cadence`, { method: "POST", body: { every_weeks } }),
  researchClientReportUrl: (slug: string) => `/api/research/client-report/${slug}`,
  // The site the research + marketing directors look at (the niche's brand.domain). Creates the
  // niche config first when there is none, so pointing a lane at a site is one action.
  researchClientWebsiteSet: (slug: string, website: string) =>
    req(`/api/research/clients/${slug}/website`, { method: "POST", body: { website } }),
  clustersStatus: (slug: string) => req(`/api/clients/${slug}/clusters/status`),
  clustersAdd: (slug: string, term: string) =>
    req(`/api/clients/${slug}/clusters/add`, { method: "POST", body: { term } }),
  clustersRemove: (slug: string, term: string) =>
    req(`/api/clients/${slug}/clusters/remove`, { method: "POST", body: { term } }),
  clustersClear: (slug: string) => req(`/api/clients/${slug}/clusters/clear`, { method: "POST" }),
  clustersClearInferred: (slug: string) =>
    req(`/api/clients/${slug}/clusters/clear-inferred`, { method: "POST" }),
  clustersPrune: (slug: string, days = 30) =>
    req(`/api/clients/${slug}/clusters/prune?days=${days}`, { method: "POST" }),
  actions: (slug: string) => req(`/api/clients/${slug}/actions`),
  videoVerify: (slug: string, id: string) => req(`/api/clients/${slug}/actions/${id}/video-verify`),
  actionsRefresh: (slug: string) => req(`/api/clients/${slug}/actions/refresh`, { method: "POST" }),
  actionTake: (slug: string, id: string) => req(`/api/clients/${slug}/actions/${id}/take`, { method: "POST" }),
  actionStatus: (slug: string, id: string, status: string) =>
    req(`/api/clients/${slug}/actions/${id}/status`, { method: "POST", body: { status } }),
  adsAnalysis: () => req("/api/ads/analysis"),
  adsAnalyze: () => req("/api/ads/analyze", { method: "POST" }),
  adsPerform: () => req("/api/ads/perform", { method: "POST" }),
  adsDecline: () => req("/api/ads/decline", { method: "POST" }),
  socialAccounts: () => req("/api/social/accounts"),
  socialRecent: () => req("/api/social/recent"),
  socialPost: (body: { lane: string; text: string; link?: string; media_url?: string;
                       platforms?: string[]; dry_run: boolean; ignore_cadence?: boolean }) =>
    req("/api/social/post", { method: "POST", body }),
  disarm: (slug: string) => req(`/api/clients/${slug}/disarm`, { method: "POST" }),
  // On/off switch for the whole lane. NOT the same as arm/disarm: arm controls whether a run
  // PUBLISHES, this controls whether it RUNS at all (and therefore whether it costs anything).
  setClientEnabled: (slug: string, enabled: boolean) =>
    req(`/api/clients/${slug}/${enabled ? "enable" : "disable"}`, { method: "POST" }),

  startAudit: (body: any) => req("/api/audits", { method: "POST", body }),
  audit: (id: string) => req(`/api/audits/${id}`),
  auditList: (slug?: string) => req(`/api/audits${slug ? `?slug=${slug}` : ""}`),
  auditJson: (id: string) => req(`/api/audits/${id}/audit.json`),
  review: (id: string) => req(`/api/audits/${id}/review`),
  editTarget: (id: string, rank: number, fields: any[]) =>
    req(`/api/audits/${id}/targets/${rank}`, { method: "PATCH", body: { fields } }),
  postTarget: (id: string, rank: number) =>
    req(`/api/audits/${id}/targets/${rank}/post`, { method: "POST" }),
  runOneStatus: (slug: string) => req(`/api/clients/${slug}/run-one`),
  runOne: (slug: string, kind: string, source: string, source_ref?: string) =>
    req(`/api/clients/${slug}/run-one`, { method: "POST", body: { kind, source, source_ref } }),
  topics: (slug: string, status: string = "queued") =>
    req(`/api/audits/topics/${slug}?status=${status}`),

  connectStatus: (slug: string) => req(`/api/clients/${slug}/connect`),
  connectPlan: (slug: string, platform: string) => req(`/api/clients/${slug}/connect/${platform}`),
  connectSave: (slug: string, platform: string, body: any) =>
    req(`/api/clients/${slug}/connect/${platform}`, { method: "POST", body }),

  onboardPreview: (body: any) => req("/api/onboard/preview", { method: "POST", body }),
  onboardSave: (body: any) => req("/api/onboard/save", { method: "POST", body }),

  ads: () => req("/api/ads"),
  adsApply: (body: { campaign_id: string; action: string; value?: number | null }) =>
    req("/api/ads/apply", { method: "POST", body }),
  adsConfig: (body: { auto_apply?: boolean; auto_apply_actions?: string[] }) =>
    req("/api/ads/config", { method: "POST", body }),
  marketGaps: () => req("/api/market-gaps"),
  marketGapsGenerate: (body: { gap_id: string; brand_slug: string; n?: number }) =>
    req("/api/market-gaps/generate", { method: "POST", body }),
  marketGapsPost: (slug: string, body: { post_id: string; dry_run: boolean; platforms?: string[] }) =>
    req(`/api/market-gaps/${slug}/post`, { method: "POST", body }),
  marketGapsDismiss: (slug: string, post_id: string) =>
    req(`/api/market-gaps/${slug}/dismiss`, { method: "POST", body: { post_id } }),
  mailAudit: () => req("/api/mail-audit"),
  mailAuditRun: () => req("/api/mail-audit/run", { method: "POST" }),
  mailAuditResume: () => req("/api/mail-audit/resume", { method: "POST" }),
  monitor: (limit = 40) => req(`/api/monitor?limit=${limit}`),
  deliveries: (source: string, limit = 100) => req(`/api/monitor/deliveries?source=${source}&limit=${limit}`),

  reportUrl: (id: string) => `/api/audits/${id}/report`,
  eventsUrl: (id: string) => `/api/audits/${id}/events`,
};
