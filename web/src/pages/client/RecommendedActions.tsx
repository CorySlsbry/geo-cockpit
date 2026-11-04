import { useEffect, useState } from "react";
import { Card, Section, Chip, Empty, Spinner } from "../../components/ui";
import { IconExternal } from "../../components/icons";
import { api } from "../../lib/api";

const ACTION_KIND: Record<string, { label: string; tone: string }> = {
  directory_claim: { label: "directory / listing", tone: "primary" },
  forum_answer: { label: "forum answer (human-post)", tone: "warn" },
  listicle_pitch: { label: "inclusion pitch", tone: "ok" },
  video_gap: { label: "dominate: blog + video + shorts", tone: "primary" },
  site_fix: { label: "site health (blocking)", tone: "danger" },
};

export function RecommendedActions({ slug }: { slug: string }) {
  const [doc, setDoc] = useState<any>(null);
  const [busy, setBusy] = useState<string>("");   // "refresh" | action id (while its job runs)
  const [openId, setOpenId] = useState<string>("");
  const [msg, setMsg] = useState<string>("");
  const [job, setJob] = useState<any>(null);      // the in-flight refresh/take job (SSE progress)
  const [vv, setVv] = useState<Record<string, any>>({}); // video-verify results per action id

  async function verifyVideo(id: string) {
    setVv((s) => ({ ...s, [id]: { busy: true } }));
    try {
      const r = await api.videoVerify(slug, id);
      setVv((s) => ({ ...s, [id]: r }));
    } catch (e: any) {
      setVv((s) => ({ ...s, [id]: { error: String(e.message || e) } }));
    }
  }

  const loadDoc = () => api.actions(slug).then(setDoc).catch(() => setDoc({ actions: [] }));
  useEffect(() => {
    setJob(null); setBusy("");
    api.actions(slug).then((d) => {
      setDoc(d);
      if (d.job_id) followJob(d.job_id, "refresh");   // a job started elsewhere (Action Center / another tab)
    }).catch(() => setDoc({ actions: [] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  // while a detached job (video production) is working, poll for its report-back
  const anyWorking = (doc?.actions || []).some((a: any) => a.status === "working");
  useEffect(() => {
    if (!anyWorking) return;
    const t = setInterval(loadDoc, 30000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyWorking, slug]);

  // follow a queued refresh/take job: SSE for live phase/pct, polling as the fallback
  function followJob(jobId: string, busyKey: string) {
    setBusy(busyKey);
    let stop = false;
    let es: EventSource | null = null;
    const finish = (j: any) => {
      if (stop) return;
      stop = true;
      es?.close();
      setJob(null); setBusy("");
      if (j?.status === "failed") setMsg(j?.error || "job failed");
      loadDoc();
    };
    const poll = () =>
      api.job(jobId).then((j) => {
        if (stop) return;
        setJob(j);
        if (j.status === "done" || j.status === "failed") finish(j);
        else setTimeout(poll, 2000);
      }).catch(() => !stop && setTimeout(poll, 4000));
    poll();
    try {
      es = new EventSource(api.jobEventsUrl(jobId));
      es.onmessage = (ev) => { try { if (!stop) setJob((p: any) => ({ ...(p || {}), ...JSON.parse(ev.data) })); } catch { /* keepalive */ } };
      es.addEventListener("done", () => api.job(jobId).then(finish));
      es.addEventListener("failed", () => api.job(jobId).then(finish));
      es.onerror = () => es?.close(); // polling covers it
    } catch { /* EventSource unsupported */ }
  }

  async function refresh() {
    setMsg("");
    try {
      const r = await api.actionsRefresh(slug);   // returns {job_id} immediately
      followJob(r.job_id, "refresh");
    } catch (e: any) { setMsg(String(e.message || e)); }
  }
  async function take(id: string) {
    setMsg("");
    try {
      const r = await api.actionTake(slug, id);
      followJob(r.job_id, id);
      setOpenId(id);
    } catch (e: any) { setMsg(String(e.message || e)); }
  }
  async function mark(id: string, status: string) {
    try {
      const updated = await api.actionStatus(slug, id, status);
      setDoc((d: any) => ({ ...d, actions: d.actions.map((a: any) => (a.id === id ? updated : a)) }));
    } catch (e: any) { setMsg(String(e.message || e)); }
  }
  function copy(text: string) {
    navigator.clipboard?.writeText(text).then(() => setMsg("copied to clipboard")).catch(() => {});
  }

  const actions = (doc?.actions || []).filter((a: any) => a.status !== "dismissed");

  return (
    <Section title="Recommended actions" sub="Where the AIs already look and you aren't — worked into ready-to-use moves">
      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-muted">
            {doc?.generated_at ? <>derived from a live measure · {doc.generated_at}</> : "no action list yet — refresh to derive one"}
          </div>
          <button className="btn-ghost" disabled={!!busy} aria-busy={busy === "refresh"} onClick={refresh}
            title="Re-measures the buyer questions live (runs in the background, 1-4 minutes)">
            {busy === "refresh" ? <><Spinner size={13} /> measuring…</> : "Refresh recommendations"}
          </button>
        </div>
        {job && busy && (
          <div className="mb-3 rounded-lg border border-line bg-surface/50 p-2.5" role="status" aria-live="polite">
            <div className="flex items-center gap-2 text-xs text-muted">
              <Spinner size={12} />
              <span className="font-medium text-ink">{job.phase || "queued"}</span>
              <span>{job.log?.length ? job.log[job.log.length - 1].line : "starting…"}</span>
              <span className="ml-auto mono text-dim">{job.pct ?? 0}%</span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${job.pct ?? 0}%` }} />
            </div>
          </div>
        )}
        {msg && <div role="status" aria-live="polite" className={`mb-2 text-xs ${msg === "copied to clipboard" ? "text-ok" : "text-danger"}`}>{msg}</div>}
        {!actions.length && !busy && <Empty title="Nothing recommended" sub="Refresh after the next audit — or you're already cited everywhere we measured." />}
        <div className="grid gap-2">
          {actions.map((a: any) => {
            const k = ACTION_KIND[a.kind] || { label: a.kind, tone: "dim" };
            const open = openId === a.id;
            return (
              <div key={a.id} className={`rounded-xl border p-3 ${a.status === "done" ? "border-ok/30 bg-ok/5" : "border-line bg-surface/50"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone={k.tone as any}>{k.label}</Chip>
                  <b className="text-sm text-ink">{a.title}</b>
                  {a.status === "done" && <Chip tone="ok">done</Chip>}
                  {a.status === "prepared" && <Chip tone="primary">prepared</Chip>}
                  {a.status === "sent" && <Chip tone="ok">sent ✉</Chip>}
                  {a.status === "working" && <Chip tone="warn"><Spinner size={10} /> producing…</Chip>}
                  {a.status === "hold" && <Chip tone="dim" title={a.execution_note || "a fresh matching asset already exists — waiting for the AI engines to re-crawl"}>on hold · recency gap</Chip>}
                  <div className="ml-auto flex items-center gap-1.5">
                    {a.status !== "done" && a.status !== "working" && a.status !== "hold" && (
                      <button className="btn-primary !px-3 !py-1.5 text-xs" disabled={!!busy}
                        onClick={() => (a.materials && a.status !== "todo" ? setOpenId(open ? "" : a.id) : take(a.id))}
                        title="Does everything automatable: produces + posts videos, sends pitches, and hands you paste-ready text for the human-only parts">
                        {busy === a.id ? <><Spinner size={12} /> working…</> : a.materials && a.status !== "todo" ? (open ? "Hide" : "View the work") : "Take the action"}
                      </button>
                    )}
                    {a.status === "prepared" && (a.kind === "video_gap" || a.kind === "listicle_pitch") && !a.execution_note && (
                      <button className="btn-primary !px-3 !py-1.5 text-xs !bg-ok/80 hover:!bg-ok" disabled={!!busy}
                        onClick={() => take(a.id)}
                        title={a.kind === "video_gap" ? "Dominate this question: produce the blog + long-form video + shorts and post to the client's channels (each cadence + channel guarded)" : "Find the editor's contact and send the pitch (BCC to you)"}>
                        {busy === a.id ? <><Spinner size={12} /> working…</> : a.kind === "video_gap" ? "Produce blog + video + shorts" : "Send the pitch"}
                      </button>
                    )}
                    <button className="btn-ghost !px-2.5 !py-1.5 text-xs" onClick={() => mark(a.id, a.status === "done" ? "todo" : "done")}>
                      {a.status === "done" ? "Reopen" : "Mark done"}
                    </button>
                    <button className="btn-ghost !px-2.5 !py-1.5 text-xs !text-dim" onClick={() => mark(a.id, "dismissed")}>Dismiss</button>
                  </div>
                </div>
                <p className="mt-1.5 text-xs text-muted">{a.why}</p>
                {a.execution_note && (
                  <p className={`mt-1 text-xs ${a.status === "sent" || a.status === "done" ? "text-ok" : a.status === "working" ? "text-warn" : "text-dim"}`}>
                    {a.execution_note}
                  </p>
                )}
                {/* video_gap loop-closer: made+posted (link + channel check), producing, or not-produced-why */}
                {a.kind === "video_gap" && a.video && a.video.state !== "none" && (
                  <div className={`mt-2 rounded-lg border p-2.5 text-xs ${
                    a.video.state === "published" ? "border-ok/30 bg-ok/5"
                    : a.video.state === "producing" ? "border-warn/30 bg-warn/5" : "border-line bg-surface/40"}`}>
                    {a.video.state === "published" && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-ok">✓ Published</span>
                        {a.video.url && (
                          <a className="text-primary-light hover:underline" href={a.video.url} target="_blank" rel="noreferrer">
                            watch video <IconExternal size={10} />
                          </a>
                        )}
                        {a.video.blog_url && (
                          <a className="text-primary-light hover:underline" href={a.video.blog_url} target="_blank" rel="noreferrer">
                            read blog <IconExternal size={10} />
                          </a>
                        )}
                        {a.video.shorts ? <Chip tone="ok">{a.video.shorts} short{a.video.shorts > 1 ? "s" : ""} posted</Chip> : null}
                        {a.video.url && (
                          <button className="btn-ghost !px-2 !py-0.5 text-[11px]" disabled={vv[a.id]?.busy} onClick={() => verifyVideo(a.id)}>
                            {vv[a.id]?.busy ? <Spinner size={10} /> : "verify channel"}
                          </button>
                        )}
                        {vv[a.id] && vv[a.id].verified === true && <Chip tone="ok">✓ posted to {vv[a.id].actual_channel}</Chip>}
                        {vv[a.id] && vv[a.id].verified === false && <Chip tone="danger">⚠ wrong channel: {vv[a.id].actual_channel} (expected {vv[a.id].expected_channel})</Chip>}
                        {vv[a.id] && vv[a.id].verified === null && <span className="text-dim">{vv[a.id].reason}</span>}
                        <button className="btn-ghost !px-2 !py-0.5 text-[11px] !text-ok" onClick={() => mark(a.id, "done")}>done — remove</button>
                      </div>
                    )}
                    {a.video.state === "producing" && (
                      <span className="text-warn">{a.video.reason || "Producing now"}. This flips to “published” with the blog + video + shorts links when it lands.</span>
                    )}
                    {a.video.state === "blocked" && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-muted">No video was produced — {a.video.reason}</span>
                        <button className="btn-ghost !px-2 !py-0.5 text-[11px] !text-dim" onClick={() => mark(a.id, "dismissed")}>remove this task</button>
                      </div>
                    )}
                  </div>
                )}
                {open && a.materials && (
                  <div className="mt-3 rounded-lg border border-line bg-bg/60 p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <button className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => copy(a.materials.text)}>Copy all</button>
                      {a.materials.target_url && (
                        <a className="text-xs text-primary-light hover:underline" href={a.materials.target_url} target="_blank" rel="noreferrer">
                          open the target page <IconExternal size={10} />
                        </a>
                      )}
                      <span className="text-[10px] text-dim">generated {a.materials.generated_at}</span>
                    </div>
                    <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-ink/90">{a.materials.text}</pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </Section>
  );
}
