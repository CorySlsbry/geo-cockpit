import { useEffect, useState } from "react";
import { Card, Chip, Spinner } from "../../components/ui";
import { IconExternal } from "../../components/icons";
import { api } from "../../lib/api";

/** Per-client Market Research + Marketing Engine (the neuron-research pair): niche sync,
 *  run buttons (JOBS follow idiom), weekly cadence dial, and the per-client report link. */
export function ResearchMarketingCard({ slug }: { slug: string }) {
  const [row, setRow] = useState<any>(null);        // this lane's entry from /api/research/clients
  const [hidden, setHidden] = useState(false);      // endpoint unavailable (non-owner / old backend)
  const [weeks, setWeeks] = useState("0");
  const [busy, setBusy] = useState<string>("");     // "sync" | "research" | "marketing" | "save" | "site"
  const [job, setJob] = useState<any>(null);
  const [msg, setMsg] = useState("");
  const [site, setSite] = useState("");             // the website the directors look at

  const load = () =>
    api.researchClients().then((r) => {
      const mine = (r.clients || []).find((c: any) => c.slug === slug) || null;
      setRow(mine);
      if (mine) setWeeks(String(mine.cadence?.every_weeks ?? 0));
      if (mine) setSite(mine.website || "");
      if (mine?.job_id) {
        // a run already in flight (started elsewhere): pick the busy label from the job's kind
        api.job(mine.job_id)
          .then((j) => follow(mine.job_id, j.kind === "marketing_run" ? "marketing" : "research"))
          .catch(() => follow(mine.job_id, "research"));
      }
      return mine;
    }).catch(() => setHidden(true));
  useEffect(() => { setRow(null); setHidden(false); setBusy(""); setJob(null); setMsg(""); load(); /* eslint-disable-line */ }, [slug]);

  function follow(jobId: string, key: string) {
    setBusy(key);
    const poll = () => api.job(jobId).then((j) => {
      setJob(j);
      if (j.status === "done" || j.status === "failed") {
        setBusy(""); setJob(null);
        if (j.status === "failed") setMsg(j.error || `${key} run failed`);
        else setMsg(`${key} run finished`);
        load();
      } else setTimeout(poll, 2500);
    }).catch(() => setTimeout(poll, 5000));
    poll();
  }

  async function sync() {
    setBusy("sync"); setMsg("");
    try { const r = await api.researchClientSync(slug); setMsg(`niche synced (${r.niche?.seed_count ?? 0} seeds)`); await load(); }
    catch (e: any) { setMsg(String(e.message || e)); }
    finally { setBusy(""); }
  }
  async function run(kind: "research" | "marketing") {
    setMsg("");
    try { const r = await api.researchClientRun(slug, kind); follow(r.job_id, kind); }
    catch (e: any) { setMsg(String(e.message || e)); }
  }
  /* THE SITE THE DIRECTORS LOOK AT. It is the niche's brand.domain, which m1_competitor and
     marketing/s1_found both read, so this really does change what gets researched - it is not a
     label. Saving with no niche config yet creates one first, so an operator does not have to
     know that Sync must come before pointing a lane at a site. */
  async function saveSite() {
    setBusy("site"); setMsg("");
    try {
      const r = await api.researchClientWebsiteSet(slug, site.trim());
      setSite(r.website);
      setMsg(r.niche_created ? `researching ${r.website} (niche config created)`
                             : `researching ${r.website}`);
      await load();
    } catch (e: any) { setMsg(String(e.message || e)); }
    finally { setBusy(""); }
  }

  async function saveCadence() {
    setBusy("save"); setMsg("");
    try {
      const n = Math.max(0, parseInt(weeks || "0", 10) || 0);
      await api.researchClientCadenceSet(slug, n);
      setMsg("saved"); await load();
    } catch (e: any) { setMsg(String(e.message || e)); }
    finally { setBusy(""); }
  }

  if (hidden || !row) return null;   // endpoint unavailable or lane unknown: render nothing
  const fb = row.findings_by_status || {};
  const cad = row.cadence || {};
  const dirty = String(cad.every_weeks ?? 0) !== String(Math.max(0, parseInt(weeks || "0", 10) || 0));
  /* A profile-sourced value is only a SUGGESTION until it is saved into the niche, so the Save
     button stays live for it even when the text has not been edited - otherwise the one action
     that locks it in would be disabled at exactly the moment it matters. */
  const siteDirty = site.trim() !== (row.website || "") || row.website_source !== "niche";
  const running = busy === "research" || busy === "marketing";

  return (
    <Card className="p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="label">Research &amp; Marketing</span>
        <Chip tone="dim" title="Market Research (demand + competitor mining) and the AI Marketing Engine, run per client against its own niche config.">market research + marketing engine</Chip>
        {(fb.approved ?? 0) > 0 && <Chip tone="ok">{fb.approved} approved</Chip>}
        {(fb.draft ?? 0) > 0 && <Chip tone="primary">{fb.draft} drafts</Chip>}
        {row.last_run
          ? <Chip tone="dim" title={`run ${row.last_run.run_id} (${row.last_run.status})`}>last run {String(row.last_run.ts || "").slice(0, 10)}</Chip>
          : <Chip tone="warn">never ran</Chip>}
      </div>

      {/* WHAT to research, above HOW OFTEN - pointing the lane at the wrong site makes the
          cadence irrelevant, so it reads in that order. */}
      <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface/50 p-2.5">
        <div className="min-w-[130px]">
          <div className="text-xs font-medium text-ink">Website to research</div>
          <div className="text-[10px] text-dim">the site the directors look at</div>
        </div>
        <input
          className="input mono min-w-[13rem] flex-1 !py-1.5 text-xs"
          aria-label="Website to research"
          placeholder="example.com"
          value={site}
          maxLength={253}
          disabled={busy === "site"}
          onChange={(e) => setSite(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && siteDirty && site.trim()) { e.preventDefault(); saveSite(); } }}
        />
        <button className="btn-primary !px-3 !py-1.5 text-xs"
          disabled={busy === "site" || !siteDirty || !site.trim()} onClick={saveSite}>
          {busy === "site" ? <Spinner size={12} /> : null} Save
        </button>
        <div className="ml-auto text-[11px]">
          {/* An operator has to be able to tell "this IS what gets researched" from "this is
              what we would default to" - a suggested value that reads as saved is a lie. */}
          {row.website_source === "niche"
            ? <span className="text-ok">saved</span>
            : row.website_source === "profile"
              ? <span className="text-warn">from the client profile - save to lock it in</span>
              : <span className="text-warn">not set</span>}
        </div>
      </div>

      {/* cadence dial: 0 = off; the hourly Neuron-Research-Cadence task fires due lanes */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface/50 p-2.5">
        <div className="min-w-[130px]">
          <div className="text-xs font-medium text-ink">Run research every</div>
          <div className="text-[10px] text-dim">0 = off - the hourly runner fires due lanes</div>
        </div>
        <input
          className="input mono !w-16 text-center" inputMode="numeric"
          aria-label="Research cadence in weeks"
          value={weeks}
          onChange={(e) => setWeeks(e.target.value.replace(/[^0-9]/g, ""))}
        />
        <span className="text-xs text-muted">weeks</span>
        <button className="btn-primary !px-3 !py-1.5 text-xs" disabled={busy === "save" || !dirty} onClick={saveCadence}>
          {busy === "save" ? <Spinner size={12} /> : null} Save
        </button>
        <div className="ml-auto text-[11px] text-muted">
          {cad.every_weeks > 0
            ? cad.next_due
              ? <>next due <b className="text-ink">{String(cad.next_due).slice(0, 10)}</b></>
              : <span className="text-warn">due at the next hourly check</span>
            : <span className="text-dim">auto-runs off</span>}
        </div>
      </div>

      {job && running && (
        <div className="mt-2 rounded-lg border border-line bg-surface/50 p-2.5" role="status" aria-live="polite">
          <div className="flex items-center gap-2 text-xs text-muted">
            <Spinner size={12} />
            <span className="font-medium text-ink">{job.phase || "queued"}</span>
            <span>{job.log?.length ? job.log[job.log.length - 1].line : "starting..."}</span>
            <span className="ml-auto mono text-dim">{job.pct ?? 0}%</span>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
        {!row.niche_exists ? (
          <>
            <button className="btn-primary !px-3 !py-1.5 text-xs" disabled={!!busy} onClick={sync}
              title="Generates niches/<slug>.json from this client's profile (buyer questions become research seeds)">
              {busy === "sync" ? <><Spinner size={12} /> syncing...</> : "Sync client"}
            </button>
            <span className="text-[11px] text-dim">no niche config yet - sync creates it from the profile</span>
          </>
        ) : (
          <>
            <button className="btn-primary !px-3 !py-1.5 text-xs" disabled={!!busy} onClick={() => run("research")}
              title="Demand Radar + Competitor Intel (modules m3,m1) then rebuilds the report - background job, a few minutes">
              {busy === "research" ? <><Spinner size={12} /> researching...</> : "Run research"}
            </button>
            <button className="btn-ghost !px-3 !py-1.5 text-xs" disabled={!!busy} onClick={() => run("marketing")}
              title="Marketing Engine stage s1 (get found) then rebuilds the marketing report - background job">
              {busy === "marketing" ? <><Spinner size={12} /> running...</> : "Run marketing"}
            </button>
            <button className="btn-ghost !px-3 !py-1.5 text-xs" disabled={!!busy} onClick={sync}
              title="Refreshes the niche config from the profile (merge - hand-edits kept)">
              {busy === "sync" ? <><Spinner size={12} /> syncing...</> : "Re-sync"}
            </button>
            {row.report_built && (
              <a className="btn-ghost !px-3 !py-1.5 text-xs" href={api.researchClientReportUrl(slug)} target="_blank" rel="noreferrer"
                title="The one-page research report for this client (views/<slug>.html)">
                View report <IconExternal size={11} />
              </a>
            )}
          </>
        )}
        {msg && (
          <span role="status" aria-live="polite"
            className={`text-xs ${msg === "saved" || msg.includes("synced") || msg.includes("finished") ? "text-ok" : "text-danger"}`}>
            {msg}
          </span>
        )}
      </div>
    </Card>
  );
}
