import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Page } from "../components/Page";
import { Card, Section, Spinner, Banner, Chip, Dot, Stat, Empty } from "../components/ui";
import { IconAlert, IconCheck, IconExternal, IconChevron, IconBolt, IconRefresh, IconShield } from "../components/icons";
import { api } from "../lib/api";
import { num, ago } from "../lib/format";

const PHASES = ["measure", "draft", "news", "video", "autopost", "render", "kits"] as const;
const PHASE_LABEL: Record<string, string> = {
  measure: "Measure", draft: "Draft", news: "News", video: "Video",
  autopost: "Autopost", render: "Render", kits: "Kits",
};
const RUNNING = (s?: string) => s === "queued" || s === "running";

function elapsed(from?: string, to?: string, now?: number) {
  if (!from) return "—";
  const a = new Date(from).getTime();
  const b = to ? new Date(to).getTime() : now || Date.now();
  if (isNaN(a) || isNaN(b) || b < a) return "—";
  const s = Math.floor((b - a) / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return h ? `${h}h ${m}m ${ss}s` : m ? `${m}m ${ss}s` : `${ss}s`;
}

/* premium horizontal stepper over the pipeline phases */
function Stepper({ phase, status }: { phase?: string; status?: string }) {
  const curIdx = Math.max(0, PHASES.indexOf((phase || "") as any));
  const failed = status === "failed";
  const done = status === "done";
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
      {PHASES.map((p, i) => {
        const state = done ? "done" : i < curIdx ? "done" : i === curIdx ? (failed ? "fail" : "active") : "todo";
        return (
          <div key={p} className="flex items-center gap-1.5">
            <div
              className={
                "flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-xs transition-colors " +
                (state === "done"
                  ? "border-ok/30 bg-ok/10 text-ok"
                  : state === "active"
                  ? "border-primary/40 bg-primary/15 text-primary-light shadow-glow"
                  : state === "fail"
                  ? "border-danger/40 bg-danger/10 text-danger"
                  : "border-line bg-surface/50 text-dim")
              }
            >
              <span className="grid h-4 w-4 place-items-center">
                {state === "done" ? (
                  <IconCheck size={13} />
                ) : state === "active" ? (
                  <span className="h-2 w-2 animate-pulse2 rounded-full bg-primary-light" />
                ) : state === "fail" ? (
                  <IconAlert size={12} />
                ) : (
                  <span className="text-[10px] font-semibold">{i + 1}</span>
                )}
              </span>
              <span className="font-medium">{PHASE_LABEL[p]}</span>
            </div>
            {i < PHASES.length - 1 && (
              <span className={"h-px w-4 " + (i < curIdx || done ? "bg-ok/40" : "bg-line")} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function ScoreCell({ row }: { row: any }) {
  const label = row.label || (row.cited === true ? "cited" : row.cited === false ? "absent" : "unknown");
  const tone = label === "cited" ? "ok" : label === "absent" ? "danger" : "dim";
  return <Chip tone={tone as any}>{label === "cited" ? "✓ cited" : label === "absent" ? "✗ absent" : "? unknown"}</Chip>;
}

export default function Audit() {
  const { jobId } = useParams();
  const nav = useNavigate();
  const [job, setJob] = useState<any>(null);
  const [aud, setAud] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const logRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // live clock while running (for elapsed)
  useEffect(() => {
    if (!RUNNING(job?.status)) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [job?.status]);

  // fetch full audit.json once done
  const loadResults = (id: string) => api.auditJson(id).then(setAud).catch(() => {});

  // polling fallback + SSE live stream
  useEffect(() => {
    if (!jobId) return;
    let stop = false;
    let es: EventSource | null = null;

    const settle = (j: any) => {
      if (j.status === "done" && !aud) loadResults(jobId);
    };

    const poll = () =>
      api
        .audit(jobId)
        .then((j) => {
          if (stop) return;
          setJob(j);
          settle(j);
          if (RUNNING(j.status)) setTimeout(poll, 1500);
        })
        .catch((e) => !stop && setErr(String(e.message || e)));
    poll();

    // EventSource for snappier updates (auth headers injected by the environment)
    try {
      es = new EventSource(api.eventsUrl(jobId));
      es.onmessage = (ev) => {
        try {
          const f = JSON.parse(ev.data);
          if (stop) return;
          setJob((prev: any) => ({ ...(prev || {}), ...f }));
        } catch {
          /* ignore keepalives */
        }
      };
      const finish = () => {
        if (stop) return;
        api.audit(jobId).then((j) => {
          setJob(j);
          settle(j);
        });
        es?.close();
      };
      es.addEventListener("done", finish);
      es.addEventListener("failed", finish);
      es.onerror = () => es?.close(); // fall back to polling
    } catch {
      /* EventSource unsupported — polling covers it */
    }

    return () => {
      stop = true;
      es?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  // keep the log scrolled to the newest line
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [job?.log?.length]);

  if (err && !job) return <Page title="Audit"><Banner tone="danger"><IconAlert size={14} /> {err}</Banner></Page>;
  if (!job) return <Page title="Audit"><Card className="p-6"><div className="flex items-center gap-3 text-sm text-muted"><Spinner /> loading job…</div></Card></Page>;

  const done = job.status === "done";
  const failed = job.status === "failed";
  const running = RUNNING(job.status);
  const summary = aud?.summary || job.summary || {};
  const el = elapsed(job.started_at || job.created_at, job.finished_at, now);

  return (
    <Page title={`Audit · ${job.slug || ""}`} crumb={`Job ${jobId}`}>
      {/* status header */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {running && <Spinner size={18} />}
            {done && <span className="text-ok"><IconCheck size={20} /></span>}
            {failed && <span className="text-danger"><IconAlert size={20} /></span>}
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-semibold text-ink">
                  {done ? "Audit complete" : failed ? "Audit failed" : job.status === "queued" ? "Queued" : "Running audit"}
                </span>
                {job.dry_run != null && (job.dry_run ? <Chip tone="dim">● dry-run</Chip> : <Chip tone="warn">● armed</Chip>)}
              </div>
              <div className="mt-0.5 text-xs text-muted">
                {running && <>Phase <span className="mono text-primary-light">{job.phase || "…"}</span> · elapsed {el}</>}
                {done && <>Finished {ago(job.finished_at)} · took {el}</>}
                {failed && <>Stopped after {el}</>}
              </div>
            </div>
          </div>
          {running && (
            <div className="flex items-center gap-2 text-xs text-muted">
              <IconBolt size={13} className="text-primary-light" />
              drafting via subscription — no per-token cost
            </div>
          )}
        </div>

        {/* progress bar */}
        {(running || failed) && (
          <div className="mt-4">
            <div className="mb-1 flex items-center justify-between text-[11px] text-dim">
              <span>{PHASE_LABEL[job.phase] || "Starting…"}</span>
              <span className="mono">{num(job.pct || 0)}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface">
              <div
                className={"h-full rounded-full transition-all duration-500 " + (failed ? "bg-danger" : "bg-primary")}
                style={{ width: `${Math.max(3, Math.min(100, job.pct || 0))}%` }}
              />
            </div>
          </div>
        )}

        {/* stepper */}
        {(running || failed) && (
          <div className="mt-4">
            <Stepper phase={job.phase} status={job.status} />
          </div>
        )}

        {failed && (
          <div className="mt-4">
            <Banner tone="danger"><IconAlert size={14} /> {job.error || "The run failed. Check the log below."}</Banner>
          </div>
        )}
      </Card>

      {/* live log */}
      {(running || failed) && (
        <Card className="p-0">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <div className="text-xs font-semibold uppercase tracking-wider text-primary-light">Live log</div>
            <div className="flex items-center gap-1.5 text-[11px] text-dim">
              <Dot tone={running ? "primary" : "danger"} pulse={running} /> {(job.log || []).length} lines
            </div>
          </div>
          <div ref={logRef} className="mono max-h-72 overflow-auto px-4 py-3 text-xs leading-relaxed text-muted">
            {(job.log || []).length === 0 ? (
              <div className="text-dim">waiting for output…</div>
            ) : (
              (job.log || []).map((l: any, i: number) => (
                <div key={i} className="flex gap-3">
                  <span className="shrink-0 text-dim">{l.ts ? String(l.ts).slice(11, 19) : ""}</span>
                  <span className="whitespace-pre-wrap break-words">{l.line}</span>
                </div>
              ))
            )}
          </div>
        </Card>
      )}

      {/* ===== DONE: results ===== */}
      {done && (
        <>
          {/* summary KPI chips */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-7">
            <Stat label="Clusters" value={num(summary.clusters)} />
            <Stat label="Measured" value={num(summary.measured)} />
            <Stat label="Cited" value={num(summary.cited)} tone={summary.cited ? "ok" : undefined} />
            <Stat label="Absent" value={num(summary.absent)} tone={summary.absent ? "danger" : undefined} />
            <Stat label="Unknown" value={num(summary.unknown)} tone={summary.unknown ? "warn" : undefined} />
            <Stat label="Targets" value={num(summary.targets)} />
            <Stat label="Drafts" value={num(summary.drafts_written)} />
          </div>

          {/* primary CTA */}
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-primary" onClick={() => nav(`/audit/${jobId}/review`)}>
              <IconShield size={15} /> Review &amp; approve drafts →
            </button>
            <a className="btn-ghost" href={api.reportUrl(jobId!)} target="_blank" rel="noreferrer">
              <IconExternal size={14} /> Open report
            </a>
            <button className="btn-ghost" onClick={() => nav(`/clients/${job.slug}`)}>
              <IconChevron size={14} /> Back to client
            </button>
          </div>

          {/* scorecard */}
          <Section title="Scorecard" sub="Where AI answers cite you — and who they cite instead">
            <Card className="overflow-hidden p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-dim">
                      <th className="px-4 py-2.5 font-semibold">Buyer question</th>
                      <th className="px-4 py-2.5 font-semibold">Status</th>
                      <th className="px-4 py-2.5 font-semibold">Where cited</th>
                      <th className="px-4 py-2.5 font-semibold">Who AI cites instead</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(aud?.scorecard || []).map((row: any, i: number) => (
                      <tr key={i} className="border-b border-line/60 align-top last:border-0">
                        <td className="px-4 py-3">
                          <div className="font-medium text-ink">{row.cluster}</div>
                          {row.note && <div className="mt-0.5 text-[11px] text-dim">{row.note}</div>}
                        </td>
                        <td className="px-4 py-3"><ScoreCell row={row} /></td>
                        <td className="px-4 py-3">
                          {(row.cited_where || []).length ? (
                            <div className="flex flex-wrap gap-1">
                              {row.cited_where.map((w: string, k: number) => (
                                <Chip key={k} tone="ok">{w}</Chip>
                              ))}
                            </div>
                          ) : (
                            <span className="text-dim">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {(row.competitor_urls || []).length ? (
                            <div className="flex flex-wrap gap-x-3 gap-y-1">
                              {row.competitor_urls.map((c: any, k: number) => (
                                <a
                                  key={k}
                                  href={c.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-xs text-primary-light hover:underline"
                                  title={c.url}
                                >
                                  {c.host || c.url} <IconExternal size={11} />
                                </a>
                              ))}
                            </div>
                          ) : (
                            <span className="text-dim">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {!(aud?.scorecard || []).length && (
                      <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-dim">No scorecard rows.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </Section>

          {/* ranked checklist */}
          <Section title="Ranked action checklist" sub="The assets to publish, easiest & highest-impact first">
            <div className="space-y-2">
              {[...(aud?.targets || [])].sort((a, b) => (a.rank || 99) - (b.rank || 99)).map((t: any) => {
                const gateOk = t.gate === "ok";
                return (
                  <Card key={t.rank} className="card-hover flex flex-wrap items-center gap-3 p-3.5">
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/15 text-sm font-bold text-primary-light">
                      {t.rank}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-ink">{t.title || t.cluster}</span>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted">{t.why}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Chip tone="primary">{t.platform}</Chip>
                      <Chip tone={t.priority === "high" ? "warn" : "dim"}>{t.priority}</Chip>
                      <Chip tone={t.channel === "auto" ? "ok" : "dim"}>{t.channel === "auto" ? "auto" : "draft"}</Chip>
                      <Chip tone={gateOk ? "ok" : "danger"}>{gateOk ? "✓ gate ok" : `✗ ${t.gate}`}</Chip>
                    </div>
                  </Card>
                );
              })}
              {!(aud?.targets || []).length && <Empty title="No targets in this run" sub="Re-run without a cost cap to generate targets." />}
            </div>
          </Section>

          {/* report viewer */}
          <Section
            title="Report viewer"
            sub="The self-contained branded report"
            right={
              <div className="flex items-center gap-2">
                <a className="btn-ghost !py-1.5 !text-xs" href={api.reportUrl(jobId!)} target="_blank" rel="noreferrer">
                  <IconExternal size={13} /> Open in new tab
                </a>
                <button
                  className="btn-ghost !py-1.5 !text-xs"
                  onClick={() => iframeRef.current?.contentWindow?.print()}
                >
                  Print
                </button>
              </div>
            }
          >
            <Card className="overflow-hidden p-0">
              <iframe
                ref={iframeRef}
                title="audit report"
                src={api.reportUrl(jobId!)}
                className="h-[75vh] w-full bg-white"
              />
            </Card>
          </Section>
        </>
      )}

      {/* queued placeholder */}
      {job.status === "queued" && !running && (
        <Card className="p-6"><div className="flex items-center gap-3 text-sm text-muted"><IconRefresh size={16} /> Queued — waiting for a worker…</div></Card>
      )}
    </Page>
  );
}
