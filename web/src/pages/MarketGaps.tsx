import { useEffect, useState } from "react";
import { Page } from "../components/Page";
import { Card, Section, Chip, Banner, Empty, Skeleton, Spinner } from "../components/ui";
import { IconAlert, IconCheck, IconCopy, IconExternal } from "../components/icons";
import { api } from "../lib/api";

/** Market Gaps — FOUNDER-LED demand-test posts for unsold, pre-customer offers.
 *  Sell the outcome, hide the AI. Nothing posts without an owner click (dry-run default).
 *  Separate from the GEO flywheel: no citation loop, no cadence, no buyer_clusters. */

// which brand each gap's audience maps to (v1: only #1 has a connected channel)
const GAP_BRAND: Record<string, string> = { "1": "top-builder-ai" };

export default function MarketGaps() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busyGen, setBusyGen] = useState(false);
  const [gapId, setGapId] = useState<string>("1");
  const [brand, setBrand] = useState<string>("top-builder-ai");
  const [msg, setMsg] = useState("");
  const [results, setResults] = useState<Record<string, any>>({}); // post_id -> dry-run/post result

  const load = () => api.marketGaps().then((r) => { setD(r); if (r.job_id) follow(r.job_id); })
    .catch((e) => setErr(String(e.message || e)));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  function follow(jobId: string) {
    setBusyGen(true);
    const poll = () => api.job(jobId).then((j) => {
      if (j.status === "done" || j.status === "failed") {
        setBusyGen(false);
        if (j.status === "failed") setMsg(j.error || "generation failed");
        api.marketGaps().then(setD).catch(() => {});
      } else setTimeout(poll, 2500);
    }).catch(() => setTimeout(poll, 5000));
    poll();
  }

  async function generate() {
    setMsg(""); setResults({});
    try { const r = await api.marketGapsGenerate({ gap_id: gapId, brand_slug: brand, n: 5 }); follow(r.job_id); }
    catch (e: any) { setMsg(String(e.message || e)); }
  }
  async function sendPost(slug: string, postId: string, dry: boolean) {
    setResults((s) => ({ ...s, [postId]: { busy: true } }));
    try {
      const r = await api.marketGapsPost(slug, { post_id: postId, dry_run: dry });
      setResults((s) => ({ ...s, [postId]: { ...r, was_dry: dry } }));
      if (!dry) await api.marketGaps().then(setD);
    } catch (e: any) {
      setResults((s) => ({ ...s, [postId]: { error: String(e.message || e), was_dry: dry } }));
    }
  }
  async function dismiss(slug: string, postId: string) {
    try { await api.marketGapsDismiss(slug, postId); await api.marketGaps().then(setD); }
    catch (e: any) { setMsg(String(e.message || e)); }
  }
  function copy(text: string, postId: string) {
    navigator.clipboard?.writeText(text).then(() => {
      setResults((s) => ({ ...s, [postId]: { copied: true } }));
    }).catch(() => {});
  }

  if (err && !d) return <Page title="Market Gaps"><Banner tone="danger"><IconAlert size={14} /> {err}</Banner></Page>;
  if (!d) return <Page title="Market Gaps"><Skeleton className="h-24" /><Skeleton className="h-64" /></Page>;

  const gaps: any[] = d.gaps || [];
  const channels: Record<string, string[]> = d.channels || {};
  const proposal = (d.proposals || {})[brand];
  const posts: any[] = (proposal?.posts || []).filter((p: any) => p.status !== "dismissed");
  const brandChannels = channels[brand] || [];

  return (
    <Page title="Market Gaps" crumb="founder-led demand tests · sell the outcome · human-gated">
      <Banner tone="primary">
        <IconAlert size={14} />
        <span>
          <b>Phase-0 demand tests.</b> These offers are unsold. Sell first, deliver semi-manually.
          Posts drive to the gap's free spearhead. Nothing posts without your click, and success here
          is spearhead interest, not GEO citations. Kept fully separate from the flywheel.
        </span>
      </Banner>

      <Section title="Pick a gap" sub="From the Market-Gap Radar. Only gaps with a connected brand channel can post; others are copy-only.">
        <div className="grid gap-3 md:grid-cols-3">
          {gaps.map((g) => {
            const mapped = GAP_BRAND[g.id];
            const ready = mapped && (channels[mapped] || []).length > 0;
            const sel = g.id === gapId;
            return (
              <button key={g.id} onClick={() => { setGapId(g.id); if (mapped) setBrand(mapped); }}
                className={`card p-4 text-left transition ${sel ? "ring-2 ring-primary/40" : "card-hover"}`}>
                <div className="flex items-center justify-between gap-2">
                  <b className="text-sm text-ink">Gap #{g.id}</b>
                  {ready ? <Chip tone="ok">ready · {mapped}</Chip> : <Chip tone="dim">copy-only (no channel)</Chip>}
                </div>
                <div className="mt-1 text-xs text-muted line-clamp-2">{g.title}</div>
                {g.spearhead && <div className="mt-2 text-[11px] text-dim line-clamp-2">spearhead: {g.spearhead.replace(/\*\*/g, "")}</div>}
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Generate demand-test posts"
        sub="Drafted on the Max subscription in the delivery brand's voice: pain-led, outcome-first, spearhead CTA, no AI mention, no em-dashes."
        right={
          <div className="flex items-center gap-2">
            <select className="input !w-auto text-xs" value={brand} onChange={(e) => setBrand(e.target.value)}
              aria-label="target brand">
              {Object.keys(channels).map((s) => (
                <option key={s} value={s}>{s}{(channels[s] || []).length ? "" : " (no channel)"}</option>
              ))}
            </select>
            <button className="btn-primary !py-1.5 !text-xs" disabled={busyGen} onClick={generate}>
              {busyGen ? <><Spinner size={12} /> drafting…</> : `Generate for gap #${gapId}`}
            </button>
          </div>
        }
      >
        <Card className="p-4">
          {msg && <div role="status" aria-live="polite" className="mb-2 text-xs text-danger">{msg}</div>}
          {!brandChannels.length && (
            <div className="mb-3 text-xs text-warn">
              {brand} has no connected postable channel — you can still generate + copy the posts, but Post is disabled.
            </div>
          )}
          {!posts.length && !busyGen ? (
            <Empty title={proposal ? "All posts dismissed" : "No posts yet"}
                   sub={`Generate a batch for ${brand}, review each, then post or copy.`} />
          ) : (
            <div className="grid gap-2">
              {proposal && <div className="text-xs text-muted">gap #{proposal.gap_id} · drafted {proposal.at}</div>}
              {posts.map((p: any) => {
                const res = results[p.id] || {};
                const posted = p.status === "posted";
                return (
                  <div key={p.id} className={`rounded-xl border p-3 ${posted ? "border-ok/30 bg-ok/5" : p.ok ? "border-line bg-surface/50" : "border-warn/30 bg-warn/5"}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip tone="primary">{p.platform}</Chip>
                      {posted && <Chip tone="ok">posted ✓</Chip>}
                      {!p.ok && <Chip tone="warn">review</Chip>}
                      <div className="ml-auto flex items-center gap-1.5">
                        <button className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => copy(p.text, p.id)}>
                          {res.copied ? "copied" : <><IconCopy size={12} /> Copy</>}
                        </button>
                        {!posted && (
                          <>
                            <button className="btn-ghost !px-2.5 !py-1 text-xs" disabled={res.busy}
                              onClick={() => sendPost(brand, p.id, true)} title="Dry-run: preview the post plan, sends nothing">
                              {res.busy && res.was_dry ? <Spinner size={11} /> : "Preview"}
                            </button>
                            <button className="btn-primary !px-2.5 !py-1 text-xs" disabled={res.busy || !brandChannels.length}
                              onClick={() => sendPost(brand, p.id, false)} title="Posts to the connected channel(s)">
                              {res.busy && res.was_dry === false ? <Spinner size={11} /> : "Post now"}
                            </button>
                            <button className="btn-ghost !px-2 !py-1 text-xs !text-dim" onClick={() => dismiss(brand, p.id)}>Dismiss</button>
                          </>
                        )}
                      </div>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-ink/90">{p.text}</p>
                    {(p.warnings || []).map((w: string, i: number) => (
                      <p key={i} className="mt-1 text-[11px] text-warn">⚠ {w}</p>
                    ))}
                    {res.error && <p className="mt-1 text-xs text-danger">{res.error}</p>}
                    {res && !res.error && !res.busy && (res.plan || res.posted) && (
                      <div className="mt-2 rounded-lg border border-line bg-bg/60 p-2 text-xs">
                        {res.was_dry ? <span className="text-muted">DRY RUN — would post to: </span> : <span className="text-ok">Posted: </span>}
                        {((res.was_dry ? res.plan : res.posted) || []).map((x: any, i: number) => (
                          <span key={i} className="mr-2">
                            {x.network}{x.url && <a className="ml-1 text-primary-light hover:underline" href={x.url} target="_blank" rel="noreferrer">view <IconExternal size={9} /></a>}
                          </span>
                        ))}
                        {res.exit_code === 3 && <span className="text-warn">cadence cap hit (shouldn't happen — separate stream)</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </Section>
    </Page>
  );
}
