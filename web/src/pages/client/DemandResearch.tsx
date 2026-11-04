import { useEffect, useState } from "react";
import { Chip, Spinner } from "../../components/ui";
import { api } from "../../lib/api";

/** Search-demand research: run as a background job -> pending proposal -> one-click Apply. */
export function DemandResearch({ slug, onApplied }: { slug: string; onApplied: () => void }) {
  const [report, setReport] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = () => api.research(slug).then((r) => {
    setReport(r.report);
    if (r.job_id) follow(r.job_id);   // a job already running (onboarding auto-research etc.)
  }).catch(() => {});
  useEffect(() => { setReport(null); setBusy(false); setMsg(""); load(); /* eslint-disable-line */ }, [slug]);

  function follow(jobId: string) {
    setBusy(true);
    const poll = () => api.job(jobId).then((j) => {
      if (j.status === "done" || j.status === "failed") {
        setBusy(false);
        if (j.status === "failed") setMsg(j.error || "research failed");
        api.research(slug).then((r) => setReport(r.report)).catch(() => {});
      } else setTimeout(poll, 2500);
    }).catch(() => setTimeout(poll, 5000));
    poll();
  }

  async function run() {
    setMsg("");
    try { const r = await api.researchRun(slug); follow(r.job_id); }
    catch (e: any) { setMsg(String(e.message || e)); }
  }
  async function apply() {
    setBusy(true); setMsg("");
    try { await api.researchApply(slug); setMsg("applied — buyer questions updated"); await load(); onApplied(); }
    catch (e: any) { setMsg(String(e.message || e)); }
    finally { setBusy(false); }
  }

  // Freshen the set. Each of these DELETES questions, and the questions drive every measure and
  // topic pick — so each confirms first and reports exactly how many it removed.
  async function hygiene(kind: "clear" | "inferred" | "prune") {
    const label = kind === "clear" ? "Remove ALL buyer questions for this client?"
      : kind === "inferred" ? "Remove only the inferred (guessed) questions? Researched and manual ones are kept."
      : "Remove questions older than 30 days?";
    if (!window.confirm(label)) return;
    setBusy(true); setMsg("");
    try {
      const r = kind === "clear" ? await api.clustersClear(slug)
        : kind === "inferred" ? await api.clustersClearInferred(slug)
        : await api.clustersPrune(slug, 30);
      setMsg(r.removed_count
        ? `applied — removed ${r.removed_count}, ${r.remaining} left`
        : `applied — nothing matched, ${r.remaining} left`);
      await load(); onApplied();
    } catch (e: any) { setMsg(String(e.message || e)); }
    finally { setBusy(false); }
  }

  const pending = report?.status === "pending";
  return (
    <div className="mt-3 border-t border-line pt-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-ghost !px-3 !py-1.5 text-xs" disabled={busy} onClick={run}
          title="Grounds the questions in REAL demand: Google autocomplete + what the AI engines say people ask (1-2 min, background)">
          {busy ? <><Spinner size={12} /> researching…</> : "Research demand"}
        </button>
        {pending && (
          <button className="btn-primary !px-3 !py-1.5 text-xs" disabled={busy} onClick={apply}
            title="Rewrites buyer questions from the researched set (keeps verified seeds + adds real queries the guess missed)">
            Apply researched set
          </button>
        )}
        {report && !pending && report.status === "applied" && (
          <Chip tone="ok">research applied {String(report.applied_at || "").slice(0, 10)}</Chip>
        )}
        <span className="mx-1 h-4 w-px bg-line" aria-hidden="true" />
        <button className="btn-ghost !px-3 !py-1.5 text-xs" disabled={busy}
          onClick={() => hygiene("inferred")}
          title="Removes only the guessed questions from onboarding. Researched and hand-entered ones are kept.">
          Clear guesses
        </button>
        <button className="btn-ghost !px-3 !py-1.5 text-xs" disabled={busy}
          onClick={() => hygiene("prune")}
          title="Cycles out questions added more than 30 days ago, so the set stays fresh.">
          Cycle out 30d+
        </button>
        <button className="btn-ghost !px-3 !py-1.5 text-xs text-danger" disabled={busy}
          onClick={() => hygiene("clear")}
          title="Removes every buyer question for this client and starts from empty.">
          Clear all
        </button>
        {msg && <span role="status" aria-live="polite" className={`text-xs ${msg.startsWith("applied") ? "text-ok" : "text-danger"}`}>{msg}</span>}
      </div>
      {pending && (
        <div className="mt-2 rounded-lg border border-line bg-surface/50 p-2.5 text-xs">
          <div className="mb-1 text-muted">
            Researched {report.at?.slice(0, 16)} · {(report.suggested_new || []).length} real queries the current set missed
            {report.counts?.orphans ? <> · <span className="text-warn">{report.counts.orphans} current question(s) look like guesses nobody searches</span></> : null}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(report.suggested_new || []).slice(0, 8).map((r: any, i: number) => (
              <Chip key={i} tone="primary" title={`score ${r.score} · via ${(r.sources || []).join(", ")}`}>+ {r.query}</Chip>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
