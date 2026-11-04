import { useEffect, useState } from "react";
import { Page } from "../components/Page";
import { Card, Section, Chip, Stat, Banner, Empty, Skeleton, Spinner } from "../components/ui";
import { IconAlert } from "../components/icons";
import { Sparkline } from "../components/Charts";
import { api } from "../lib/api";

const money = (v: any) => (v == null ? "—" : "$" + Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }));
const num = (v: any) => (v == null ? "—" : Number(v).toLocaleString());
const WRITE_ACTIONS = new Set(["pause", "scale_budget", "resume"]);

export default function Ads() {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);   // proposal being applied / toggle
  const [analysis, setAnalysis] = useState<any>(null);
  const [performResult, setPerformResult] = useState<any>(null);

  const load = () => {
    api.ads().then(setData).catch((e) => setErr(String(e.message || e)));
    api.adsAnalysis().then((r) => setAnalysis(r.analysis)).catch(() => {});
  };

  async function runAnalyze() {
    setBusy("analyze"); setPerformResult(null);
    try { const r = await api.adsAnalyze(); setAnalysis(r.analysis); }
    catch (e: any) { setErr(String(e.message || e)); }
    finally { setBusy(null); }
  }
  async function runPerform() {
    setBusy("perform");
    try { const r = await api.adsPerform(); setPerformResult(r); setAnalysis(r.analysis); await api.ads().then(setData); }
    catch (e: any) { setErr(String(e.message || e)); }
    finally { setBusy(null); }
  }
  async function runDecline() {
    try { const r = await api.adsDecline(); setAnalysis(r.analysis); setPerformResult(null); }
    catch (e: any) { setErr(String(e.message || e)); }
  }
  useEffect(() => { load(); }, []);

  async function approve(p: any) {
    setBusy(p.campaign_id + p.action);
    try { await api.adsApply({ campaign_id: p.campaign_id, action: p.action, value: p.value }); await load(); }
    catch (e: any) { alert("Apply failed: " + (e.message || e)); }
    finally { setBusy(null); }
  }
  async function toggleAuto(on: boolean) {
    setBusy("auto");
    try { await api.adsConfig({ auto_apply: on }); await load(); }
    catch (e: any) { alert("Toggle failed: " + (e.message || e)); }
    finally { setBusy(null); }
  }

  if (err && !data) return <Page title="Ads"><Banner tone="danger"><IconAlert size={14} /> {err}</Banner></Page>;
  if (!data) return <Page title="Ads"><div className="grid gap-4 sm:grid-cols-3"><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div></Page>;

  const t = data.totals || {};
  const ma = data.marketing_api || {};
  const st = ma.status || {};
  const campaigns: any[] = ma.campaigns || [];
  const pending = analysis?.status === "pending" ? (analysis.proposals || []) : [];
  const autoOn = !!st.auto_apply;

  return (
    <Page title="Ads" crumb="Meta ads · Andromeda-complement · propose → approve">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Ad spend · 30d" value={money(t.spend_30d)} sub={st.primary_ad_account || "all brands"} />
        <Stat label="Purchases · 30d" value={num(t.purchases_30d)} tone={t.purchases_30d ? "ok" : undefined} />
        <Stat label="Open proposals" value={num(pending.length)} tone={pending.length ? "warn" : "ok"} />
      </div>

      {ma.error && <Banner tone="warn"><IconAlert size={14} /> Marketing API: {ma.error}</Banner>}

      {/* ONE proposals surface: analyze -> read -> approve one / perform all / decline */}
      <Section
        title="Proposals & analysis"
        sub="The system reads the KPIs, explains performance, and proposes guardrail-safe improvements. Nothing changes spend without approval."
        right={
          <label className="flex items-center gap-2 text-xs text-muted">
            {busy === "auto" ? <Spinner size={13} /> : null}
            Auto-apply (pause losers only)
            <button
              onClick={() => toggleAuto(!autoOn)} disabled={busy === "auto"}
              role="switch" aria-checked={autoOn} aria-label="Auto-apply pause-only proposals"
              className={`relative h-5 w-9 rounded-full transition ${autoOn ? "bg-ok" : "bg-line"}`}
              title="When on, the scheduled optimizer auto-pauses confirmed losers. Budget increases always need a click."
            >
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${autoOn ? "left-4" : "left-0.5"}`} />
            </button>
          </label>
        }
      >
        <Card className="p-5">
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-primary" disabled={busy === "analyze"} aria-busy={busy === "analyze"} onClick={runAnalyze}>
              {busy === "analyze" ? <Spinner size={13} /> : null} Analyze performance
            </button>
            {analysis?.status === "pending" && (
              <>
                <button className="btn-primary !bg-ok/80 hover:!bg-ok" disabled={busy === "perform"} onClick={runPerform}>
                  {busy === "perform" ? <Spinner size={13} /> : null} Perform improvements ({pending.length})
                </button>
                <button className="btn-ghost !text-warn" disabled={!!busy} onClick={runDecline}>Decline</button>
              </>
            )}
            {analysis && analysis.status !== "pending" && (
              <Chip tone={analysis.status === "performed" ? "ok" : "dim"}>
                last analysis {analysis.at}: {analysis.status}
                {analysis.outcome ? ` — ${analysis.outcome.applied} applied, ${analysis.outcome.manual} to content pipeline, ${analysis.outcome.failed} failed` : ""}
              </Chip>
            )}
          </div>
          {analysis?.summary && (
            <p className="mt-3 max-w-4xl text-sm leading-relaxed text-muted">{analysis.summary}</p>
          )}
          {analysis?.status === "pending" && pending.length > 0 && (
            <div className="mt-3 grid gap-1.5">
              {pending.map((p: any, i: number) => {
                const writeable = WRITE_ACTIONS.has(p.action) && p.campaign_id;
                const tone = p.action === "pause" ? "danger" : p.action === "scale_budget" ? "ok"
                  : p.action === "review" ? "warn" : "primary";
                return (
                  <div key={i} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface/50 p-2.5 text-xs">
                    <div className="min-w-0">
                      <b className="text-ink">{p.campaign_name}</b> · <Chip tone={tone as any}>{p.action}</Chip>
                      {p.account_name && <span className="ml-1 text-[10px] text-dim">· {p.account_name}</span>}
                      <span className="ml-2 text-muted">{p.from} → {p.to}</span>
                      <div className="mt-1 text-dim">{p.reason}</div>
                    </div>
                    {writeable ? (
                      <button
                        onClick={() => approve(p)} disabled={!!busy}
                        aria-label={`Approve: ${p.action} ${p.campaign_name}`}
                        className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                      >{busy === p.campaign_id + p.action ? <Spinner size={13} /> : "Approve"}</button>
                    ) : (
                      <Chip tone="dim" title="Creative work — the content/HeyGen pipeline handles it, not an API write">route to content</Chip>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {analysis?.status === "pending" && !pending.length && (
            <p className="mt-3 text-xs text-ok">Nothing to change — every campaign is inside the guardrails.</p>
          )}
          {!analysis && (
            <p className="mt-3 text-xs text-dim">No analysis yet — run one to get a performance read + proposals.</p>
          )}
          {performResult && (
            <div className="mt-3 rounded-xl border border-line bg-surface/60 p-3 text-xs" role="status" aria-live="polite">
              {(performResult.applied || []).map((a: any, i: number) => (
                <div key={i} className="text-ok">✓ {a.campaign_name}: {a.action} applied</div>
              ))}
              {(performResult.manual || []).map((a: any, i: number) => (
                <div key={i} className="text-muted">→ {a.campaign_name}: {a.action} routed to the content pipeline (creative work, not an API write)</div>
              ))}
              {(performResult.failed || []).map((a: any, i: number) => (
                <div key={i} className="text-danger">✗ {a.campaign_name}: {a.result?.error || "failed"}</div>
              ))}
            </div>
          )}
        </Card>
      </Section>

      {/* Live campaigns (Marketing API) — across all connected ad accounts */}
      <Section title="Live campaigns" sub="Marketing API · all connected ad accounts · full 30-day KPIs">
        {campaigns.length === 0 ? (
          <Empty title="No campaigns" sub={ma.error ? "Marketing API error above." : "None on the connected accounts."} />
        ) : (
          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-dim">
                    <th className="px-4 py-2.5 font-semibold">Campaign</th>
                    <th className="px-3 py-2.5 font-semibold">Account</th>
                    <th className="px-3 py-2.5 font-semibold">Status</th>
                    <th className="px-3 py-2.5 font-semibold">Spend 30d</th>
                    <th className="px-3 py-2.5 font-semibold">Budget/d</th>
                    <th className="px-3 py-2.5 font-semibold">Impr</th>
                    <th className="px-3 py-2.5 font-semibold">Reach</th>
                    <th className="px-3 py-2.5 font-semibold">Freq</th>
                    <th className="px-3 py-2.5 font-semibold">Clicks</th>
                    <th className="px-3 py-2.5 font-semibold">CTR</th>
                    <th className="px-3 py-2.5 font-semibold">CPC</th>
                    <th className="px-3 py-2.5 font-semibold">CPM</th>
                    <th className="px-3 py-2.5 font-semibold">Purch</th>
                    <th className="px-3 py-2.5 font-semibold">Leads</th>
                    <th className="px-3 py-2.5 font-semibold">Cost/result</th>
                    <th className="px-3 py-2.5 font-semibold">ROAS</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c, i) => (
                    <tr key={i} className="border-b border-line/60 last:border-0">
                      <td className="px-4 py-2.5 font-medium text-ink">{c.name}</td>
                      <td className="px-3 py-2.5 text-xs text-muted">{c.account_name || "—"}</td>
                      <td className="px-3 py-2.5"><Chip tone={c.status === "ACTIVE" ? "ok" : "dim"}>{c.status}</Chip></td>
                      <td className="px-3 py-2.5 mono">{money(c.spend)}</td>
                      <td className="px-3 py-2.5 mono text-muted">{money(c.daily_budget_usd)}</td>
                      <td className="px-3 py-2.5 mono text-muted">{(c.impressions ?? 0).toLocaleString()}</td>
                      <td className="px-3 py-2.5 mono text-muted">{(c.reach ?? 0).toLocaleString()}</td>
                      <td className="px-3 py-2.5 mono text-muted">{c.frequency ?? "—"}</td>
                      <td className="px-3 py-2.5 mono text-muted">{(c.clicks ?? 0).toLocaleString()}</td>
                      <td className="px-3 py-2.5 mono text-muted">{c.ctr != null ? `${c.ctr}%` : "—"}</td>
                      <td className="px-3 py-2.5 mono text-muted">{c.cpc != null ? money(c.cpc) : "—"}</td>
                      <td className="px-3 py-2.5 mono text-muted">{c.cpm != null ? money(c.cpm) : "—"}</td>
                      <td className="px-3 py-2.5 mono">{c.purchases ?? 0}</td>
                      <td className="px-3 py-2.5 mono">{c.leads ?? 0}</td>
                      <td className="px-3 py-2.5 mono">{c.cost_per_result != null ? money(c.cost_per_result) : <span className="text-dim">—</span>}</td>
                      <td className="px-3 py-2.5">{c.roas == null ? <span className="text-dim">no data</span> : <Chip tone={c.roas >= 1 ? "ok" : "warn"}>{c.roas}×</Chip>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </Section>

      {/* Guardrails */}
      <Section title="Guardrails" sub="Andromeda-complement — creative over budget; budget edits stay learning-safe">
        <Card className="space-y-2 text-xs text-muted">
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <span>Mode: <b className="text-ink">{st.mode || "propose"}</b></span>
            <span>Auto-apply: <b className={autoOn ? "text-ok" : "text-dim"}>{autoOn ? "on (pause only)" : "off"}</b></span>
            <span>Max/day/campaign: <b className="text-ink">{money(st.guardrails?.max_daily_per_campaign_usd)}</b></span>
            <span>Max change/step: <b className="text-ink">{st.guardrails?.max_change_pct_per_step}%</b></span>
            <span>Pause below ROAS: <b className="text-ink">{st.guardrails?.min_roas_to_keep}</b></span>
            <span>Budget cooldown: <b className="text-ink">{st.guardrails?.budget_change_cooldown_days}d</b></span>
          </div>
          <div className="text-dim">Winner → more creative on the angle (not a bigger budget); CAPI fires on the qualified purchase; budget increases always need a human click.</div>
        </Card>
      </Section>
    </Page>
  );
}
