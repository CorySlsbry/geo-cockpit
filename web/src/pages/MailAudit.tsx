import { useEffect, useState } from "react";
import { Page } from "../components/Page";
import { Card, Section, Chip, Stat, Banner, Empty, Skeleton, Spinner } from "../components/ui";
import { IconAlert, IconCheck, IconRefresh } from "../components/icons";
import { api } from "../lib/api";

/** Mail Audit — proof that what we actually SENT in the last 24h wasn't embarrassing.
 *  Reads each brand's Gmail sent folder (ground truth across every stream), not our senders. */

const SEV_TONE: Record<string, string> = { critical: "danger", high: "warn", low: "dim" };
const CHECK_LABEL: Record<string, string> = {
  placeholder: "unfilled [Placeholder]",
  placeholder_generic: "unfilled [Placeholder]",
  merge_field: "unrendered {{merge}}",
  scaffolding: "generator scaffolding leaked",
  bad_greeting: "broken greeting",
  robot_name: "greeted by a handle, not a name",
  junk_token: "junk token (undefined/null)",
  empty_subject: "no subject line",
  wrong_sender: "sent from the wrong brand",
  tenant_mismatch: "mailbox/token mismatch",
  audit_error: "audit could not read the mailbox",
};

function whenDue(s: number, intervalH: number) {
  if (s <= 0) return "due now";
  const mins = Math.round(s / 60);              // round FIRST, then split — else 86399s
  const h = Math.floor(mins / 60), m = mins % 60;  // rendered as "23h 60m"
  return `next in ${h ? h + "h " : ""}${m}m · every ${intervalH}h`;
}

export default function MailAudit() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = () => api.mailAudit().then((r) => { setD(r); if (r.job_id) follow(r.job_id); })
    .catch((e) => setErr(String(e.message || e)));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  function follow(jobId: string) {
    setBusy(true);
    const poll = () => api.job(jobId).then((j) => {
      if (j.status === "done" || j.status === "failed") {
        setBusy(false);
        if (j.status === "failed") setMsg(j.error || "audit failed");
        api.mailAudit().then(setD).catch(() => {});
      } else setTimeout(poll, 2500);
    }).catch(() => setTimeout(poll, 5000));
    poll();
  }

  async function runNow() {
    setMsg("");
    try { const r = await api.mailAuditRun(); follow(r.job_id); }
    catch (e: any) { setMsg(String(e.message || e)); }
  }
  async function resume() {
    setMsg("");
    try { await api.mailAuditResume(); setMsg("pitch sender re-armed"); await load(); }
    catch (e: any) { setMsg(String(e.message || e)); }
  }

  if (err && !d) return <Page title="Mail Audit"><Banner tone="danger"><IconAlert size={14} /> {err}</Banner></Page>;
  if (!d) return <Page title="Mail Audit"><div className="grid gap-4 sm:grid-cols-3"><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div><Skeleton className="h-64" /></Page>;

  const r = d.report;
  const defects: any[] = r?.defects || [];        // NEW defects only (server decides)
  // trust the server's count — recomputing from the array drifts if the shapes disagree
  const crit = r?.critical ?? defects.filter((x) => x.severity === "critical").length;
  const halted = d.sender_enabled === false;

  return (
    <Page title="Mail Audit" crumb="what we actually sent · every 24h · all brands">
      {halted && (
        <Banner tone="danger">
          <IconAlert size={14} />
          <span>
            <b>Pitch sender halted</b> — a broken email actually shipped, so the daily sender was
            disabled to stop a second day of it. Fix the root cause, then re-arm.
          </span>
          <button className="btn-primary !py-1.5 !text-xs" onClick={resume}>Re-arm sender</button>
        </Banner>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Sent · last 24h" value={r ? r.messages_checked : "—"}
              sub={r ? `${(r.mailboxes || []).length} mailbox(es)` : ""} />
        <Stat label="New defects" value={r ? r.new_defects ?? defects.length : "—"}
              tone={defects.length ? (crit ? "danger" : "warn") : "ok"}
              sub={r?.known_defects ? `${r.known_defects} known/triaged ignored` : "since last audit"} />
        <Stat label="Critical" value={r ? crit : "—"} tone={crit ? "danger" : "ok"}
              sub={crit ? "a broken email shipped" : "nothing embarrassing shipped"} />
      </div>

      <Section
        title="Last audit"
        sub="Reads each brand's Gmail sent folder — ground truth across every stream (pitches, follow-ups, nurtures, reports, auto-replies)"
        right={
          <div className="flex items-center gap-2">
            <span className="text-xs text-dim">{whenDue(d.due_in_s, d.interval_h)}</span>
            <button className="btn-ghost !py-1.5 !text-xs" disabled={busy} onClick={runNow}
                    title="Audit the last 24h of sent mail now">
              {busy ? <><Spinner size={12} /> auditing…</> : <><IconRefresh size={13} /> Run audit now</>}
            </button>
          </div>
        }
      >
        <Card className="p-4">
          {msg && <div role="status" aria-live="polite"
                       className={`mb-2 text-xs ${msg.includes("re-armed") ? "text-ok" : "text-danger"}`}>{msg}</div>}
          {!r ? (
            <Empty title="No audit yet" sub="Run one now, or wait for the next scheduled pass." />
          ) : !defects.length ? (
            <div className="flex items-center gap-2 text-sm text-ok">
              <IconCheck size={15} />
              Clean — {r.messages_checked} message(s) in the last {r.hours}h: no placeholders, no
              scaffolding, no broken greetings.
              <span className="text-dim">· {r.at}</span>
            </div>
          ) : (
            <div className="grid gap-2">
              <div className="text-xs text-muted">{r.at} · {defects.length} new defect(s)</div>
              {defects.map((x, i) => (
                <div key={i} className={`rounded-xl border p-3 ${x.severity === "critical" ? "border-danger/30 bg-danger/5" : "border-line bg-surface/50"}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip tone={(SEV_TONE[x.severity] || "dim") as any}>{x.severity}</Chip>
                    <b className="text-sm text-ink">{CHECK_LABEL[x.check] || x.check}</b>
                    <span className="text-xs text-muted">→ {x.to}</span>
                    <span className="ml-auto text-[10px] text-dim">{x.mailbox} · {x.at}</span>
                  </div>
                  {x.subject && <div className="mt-1 text-xs text-muted">subject: {x.subject}</div>}
                  {x.context && (
                    <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-bg/60 p-2 text-[11px] text-ink/80">{x.context}</pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </Section>

      <Section title="History" sub="Every pass — the trend that proves we stay clean">
        {!d.history?.length ? <Empty title="No runs yet" /> : (
          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-dim">
                    <th className="px-4 py-2.5 font-semibold">When</th>
                    <th className="px-3 py-2.5 font-semibold">Sent checked</th>
                    <th className="px-3 py-2.5 font-semibold">New defects</th>
                    <th className="px-3 py-2.5 font-semibold">Critical</th>
                  </tr>
                </thead>
                <tbody>
                  {d.history.map((h: any, i: number) => (
                    <tr key={i} className="border-b border-line/60 last:border-0">
                      <td className="px-4 py-2 text-xs text-muted">{h.at}</td>
                      <td className="px-3 py-2 mono">{h.messages_checked}</td>
                      <td className="px-3 py-2 mono">{h.new_defects ?? "—"}</td>
                      <td className="px-3 py-2">
                        {h.critical ? <Chip tone="danger">{h.critical}</Chip> : <Chip tone="ok">0</Chip>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </Section>
    </Page>
  );
}
