import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Page } from "../components/Page";
import { Card, Section, Banner, Chip, Dot, Skeleton, Empty } from "../components/ui";
import { IconAlert, IconShield, IconPlug, IconExternal } from "../components/icons";
import { api } from "../lib/api";
import { titleCase, shortDate } from "../lib/format";
import { CadenceCard } from "./client/CadenceCard";
import { ResearchMarketingCard } from "./client/ResearchMarketingCard";
import { DemandResearch } from "./client/DemandResearch";
import { ManualTarget } from "./client/ManualTarget";
import { RecommendedActions } from "./client/RecommendedActions";
import { AuditRunCard } from "./client/AuditRunCard";
import { AuditHistory } from "./client/AuditHistory";
import { GoLiveModal } from "./client/GoLiveModal";
import { ConnectWizard, PLATFORM_LABEL } from "./client/ConnectWizard";

// plan token_field name -> connectSave body key
const bodyKey = (f: string) => (f === "access_token" ? "token" : f);

export default function ClientDetail() {
  const { slug } = useParams();
  const nav = useNavigate();

  const [detail, setDetail] = useState<any>(null);
  const [connect, setConnect] = useState<any>(null);
  const [history, setHistory] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  // audit form
  const [maxMeasure, setMaxMeasure] = useState("");
  const [maxDraft, setMaxDraft] = useState("3");
  const [draftModel, setDraftModel] = useState("claude-sonnet-5");
  const [noLlm, setNoLlm] = useState(false);
  const [running, setRunning] = useState(false);

  // arm dialog
  const [armOpen, setArmOpen] = useState(false);
  const [armOk, setArmOk] = useState(false);
  const [armBusy, setArmBusy] = useState(false);

  // connect wizard
  const [wizard, setWizard] = useState<string | null>(null); // platform
  const [plan, setPlan] = useState<any>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [connBusy, setConnBusy] = useState(false);
  const [connResult, setConnResult] = useState<any>(null);

  const loadDetail = () => api.clientDetail(slug!).then(setDetail).catch((e) => setErr(String(e.message || e)));
  const loadConnect = () => api.connectStatus(slug!).then(setConnect).catch(() => {});
  const loadHistory = () => api.auditList(slug).then(setHistory).catch(() => {});

  useEffect(() => {
    if (!slug) return;
    setDetail(null); setConnect(null); setHistory(null); setErr(null);
    loadDetail(); loadConnect(); loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  async function runAudit(rerun = false) {
    setRunning(true);
    setErr(null);
    try {
      const body: any = { slug, max_draft: Number(maxDraft) || 3, draft_model: draftModel, no_llm: noLlm };
      if (maxMeasure.trim()) body.max_measure = Number(maxMeasure);
      const r = await api.startAudit(body);
      nav(`/audit/${r.job_id}`);
    } catch (e: any) {
      setErr(String(e.message || e));
      setRunning(false);
    }
  }

  async function toggleArm() {
    setArmBusy(true);
    try {
      if (summary.armed) await api.disarm(slug!);
      else await api.arm(slug!);
      setArmOpen(false); setArmOk(false);
      await loadDetail();
    } catch (e: any) {
      setErr(String(e.message || e));
    } finally {
      setArmBusy(false);
    }
  }

  async function openWizard(platform: string) {
    setWizard(platform); setPlan(null); setForm({}); setConnResult(null);
    try {
      const p = await api.connectPlan(slug!, platform);
      setPlan(p);
    } catch (e: any) {
      setConnResult({ error: String(e.message || e) });
    }
  }

  async function saveConnect() {
    if (!plan || !wizard) return;
    setConnBusy(true);
    setConnResult(null);
    try {
      const body: Record<string, string> = {};
      (plan.token_fields || []).forEach((f: string) => { if (form[f]?.trim()) body[bodyKey(f)] = form[f].trim(); });
      const r = await api.connectSave(slug!, wizard, body);
      setConnResult(r);
      await loadConnect();
    } catch (e: any) {
      setConnResult({ error: String(e.message || e) });
    } finally {
      setConnBusy(false);
    }
  }

  if (err && !detail) return <Page title="Client"><Banner tone="danger"><IconAlert size={14} /> {err}</Banner></Page>;
  if (!detail)
    return (
      <Page title="Client">
        <Skeleton className="h-24" />
        <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-56" /><Skeleton className="h-56" /></div>
      </Page>
    );

  const summary = detail.summary || {};
  const profile = detail.profile || {};
  const brand = profile.brand || {};
  const status = connect?.status || summary.connect || {};
  const platforms = connect?.platforms || Object.keys(status);
  const jobs = history?.jobs || [];

  return (
    <Page title={summary.name || slug} crumb={summary.domain}>
      {err && <Banner tone="danger"><IconAlert size={14} /> {err}</Banner>}

      {/* header */}
      <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-xl font-semibold text-ink">{summary.name || slug}</h2>
            {summary.armed ? <Chip tone="warn">● ARMED</Chip> : <Chip tone="dim">● DRY-RUN</Chip>}
            {summary.recurring && <Chip tone="primary">recurring</Chip>}
          </div>
          <a href={`https://${summary.domain}`} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted hover:text-primary-light">
            {summary.domain} <IconExternal size={11} />
          </a>
          {brand.voice && <p className="mt-2 max-w-2xl text-xs text-muted">{brand.voice}</p>}
        </div>
        <div className="flex items-center gap-2">
          <button className={summary.armed ? "btn-ghost !text-warn" : "btn-ghost"} onClick={() => { setArmOpen(true); setArmOk(false); }}>
            <IconShield size={15} /> {summary.armed ? "Disarm" : "Arm"}
          </button>
        </div>
      </Card>

      {/* buyer clusters + channels strip */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          {(() => {
            const cr = summary.cluster_research || {};
            const researched = cr.source === "researched";
            const statusOf = (q: string) => {
              const s = (cr.seed_status || []).find((x: any) => x.seed === q);
              return s ? s.status : researched ? "researched" : "inferred";
            };
            const toneOf = (st: string) => (st === "researched" ? "ok" : st === "weak" ? "warn" : st === "inferred" ? "primary" : "dim");
            return (
              <>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="label">Buyer questions ({(summary.clusters || []).length})</span>
                  {researched ? (
                    <Chip tone="ok" title="Grounded in real search demand (Google autocomplete + AI engines)">
                      researched{cr.at ? ` · ${cr.at}` : ""}
                    </Chip>
                  ) : (
                    <Chip tone="warn" title="LLM-inferred from the site — not yet validated against real demand">inferred (guess)</Chip>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(summary.clusters || []).map((c: string, i: number) => {
                    const st = statusOf(c);
                    return <Chip key={i} tone={toneOf(st) as any} title={st}>{c}</Chip>;
                  })}
                  {!(summary.clusters || []).length && <span className="text-xs text-dim">none</span>}
                </div>
                {researched && (
                  <div className="mt-2 text-[10px] text-dim">
                    <span className="mr-3"><span className="text-ok">●</span> really searched</span>
                    <span className="mr-3"><span className="text-warn">●</span> weak signal</span>
                    <span><span className="text-primary-light">●</span> new from research</span>
                  </div>
                )}
                <DemandResearch slug={slug!} onApplied={loadDetail} />
              </>
            );
          })()}
        </Card>
        <Card className="p-4">
          <div className="label mb-2">Channels</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {(summary.auto || []).map((c: string) => <Chip key={c} tone="ok">{titleCase(c)}</Chip>)}
            {(summary.draft || []).map((c: string) => <Chip key={c} tone="dim">{titleCase(c)}</Chip>)}
          </div>
          <div className="mt-3 border-t border-line pt-2 text-[11px] text-muted">
            Auto-replies: <b className="text-ink">{summary.responder?.enabled ? "on" : "off"}</b>
            {summary.responder?.model ? ` · ${summary.responder.model}` : ""}
          </div>
        </Card>
      </div>

      {/* manual longtail target - sits between the researched questions and the cadence
          dials on purpose: it is an INPUT to what gets measured, not a publishing knob. */}
      <ManualTarget slug={slug!} onChanged={loadDetail} />

      {/* publishing cadence — per-client dial for content + social frequency */}
      <CadenceCard
        slug={slug!}
        cadence={summary.cadence}
        videoFormat={summary.video_format}
        shortStyle={summary.short_style}
        videoNarration={summary.video_narration}
        characterVoices={summary.character_voices}
        /* Functional updates: both callbacks used to spread a `detail` captured at render time,
           so overlapping saves (change the size, then hit Save cadence before the size request
           lands) let whichever resolved second write a snapshot predating the first — silently
           reverting the dropdown even though the server had stored the new value. */
        onSaved={(c) => setDetail((d: any) => ({ ...d, summary: { ...d.summary, cadence: c } }))}
        onFormatSaved={(v) => setDetail((d: any) => ({ ...d, summary: { ...d.summary, video_format: v } }))}
        onStyleSaved={(s) => setDetail((d: any) => ({ ...d, summary: { ...d.summary, short_style: s } }))}
        onNarrationSaved={(n) => setDetail((d: any) => ({ ...d, summary: { ...d.summary, video_narration: n } }))}
        onVoicesSaved={(v) => setDetail((d: any) => ({ ...d, summary: { ...d.summary, character_voices: v } }))}
      />

      {/* market research + marketing engine — per-client niche, runs, cadence, report */}
      <ResearchMarketingCard slug={slug!} />

      {/* recommended actions — the placement to-do list, worked into paste-ready moves */}
      <RecommendedActions slug={slug!} />

      {/* Run an audit */}
      <AuditRunCard
        maxMeasure={maxMeasure} onMaxMeasure={setMaxMeasure}
        maxDraft={maxDraft} onMaxDraft={setMaxDraft}
        draftModel={draftModel} onDraftModel={setDraftModel}
        noLlm={noLlm} onNoLlm={setNoLlm}
        running={running} onRun={() => runAudit(false)}
      />

      {/* Connections */}
      <Section title="Connections" sub="Connect each channel so the engine can post for you">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {platforms.map((p: string) => {
            const s = status[p] || {};
            const tone = !s.connected ? "dim" : s.missing_to_post?.length ? "warn" : "ok";
            return (
              <Card key={p} className="card-hover flex items-center justify-between gap-2 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Dot tone={tone as any} pulse={s.connected && !s.missing_to_post?.length} />
                    <span className="font-medium text-ink">{PLATFORM_LABEL[p] || titleCase(p)}</span>
                  </div>
                  <div className="mt-1 truncate text-xs text-muted">
                    {s.connected ? (
                      <>
                        {s.handle && <span className="mono">{s.handle}</span>}
                        {s.missing_to_post?.length ? <span className="text-warn"> · missing {s.missing_to_post.join(", ")}</span> : <span className="text-ok"> · postable</span>}
                      </>
                    ) : (
                      <span className="text-dim">not connected</span>
                    )}
                  </div>
                  {s.expires_at && <div className="mt-0.5 text-[10px] text-dim">expires {shortDate(s.expires_at)}</div>}
                </div>
                <button className="btn-ghost !px-3 !py-2" onClick={() => openWizard(p)} title="Connect"
                  aria-label={`Connect ${PLATFORM_LABEL[p] || p}`}>
                  <IconPlug size={15} />
                </button>
              </Card>
            );
          })}
          {!platforms.length && <Empty title="No platforms" />}
        </div>
      </Section>

      {/* Audit history */}
      <AuditHistory history={history} running={running} onRerun={() => runAudit(true)} />

      {/* ===== Arm / Disarm ===== */}
      <GoLiveModal
        open={armOpen} onClose={() => setArmOpen(false)}
        summary={summary} jobs={jobs}
        armOk={armOk} onArmOkChange={setArmOk}
        armBusy={armBusy} onConfirm={toggleArm}
      />

      {/* ===== Connect wizard ===== */}
      <ConnectWizard
        wizard={wizard} plan={plan}
        form={form} setForm={setForm}
        connBusy={connBusy} connResult={connResult}
        onClose={() => setWizard(null)} onSave={saveConnect}
      />
    </Page>
  );
}
