import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Page } from "../components/Page";
import { Card, Section, Banner, Skeleton, Chip, Empty, Spinner } from "../components/ui";
import { IconAlert, IconCopy, IconCheck, IconExternal, IconShield, IconPlay, IconBolt } from "../components/icons";
import { api } from "../lib/api";
import { copy, titleCase } from "../lib/format";

/* ---- tiny toast ---- */
function useToast() {
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "danger" } | null>(null);
  const show = (text: string, tone: "ok" | "danger" = "ok") => setMsg({ text, tone });
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2600);
    return () => clearTimeout(t);
  }, [msg]);
  const node = msg ? (
    <div className="fixed bottom-5 right-5 z-[60] animate-fade-up">
      <div
        className={
          "flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm shadow-card " +
          (msg.tone === "ok" ? "border-ok/30 bg-ok/15 text-ok" : "border-danger/30 bg-danger/15 text-danger")
        }
      >
        {msg.tone === "ok" ? <IconCheck size={15} /> : <IconAlert size={15} />} {msg.text}
      </div>
    </div>
  ) : null;
  return { show, node };
}

/* ---- one labeled copy block (community kit field) ---- */
function CopyField({
  label, value, copied, onCopy, focused,
}: { label: string; value: string; copied: boolean; onCopy: () => void; focused?: boolean }) {
  return (
    <div className={"rounded-xl border p-2.5 transition-colors " + (focused ? "border-primary/50 bg-primary/5" : "border-line bg-surface/40")}>
      <div className="mb-1 flex items-center justify-between">
        <span className="label">{label}</span>
        <button
          onClick={onCopy}
          className={"chip transition-colors " + (copied ? "bg-ok/15 text-ok" : "bg-white/5 text-muted hover:text-ink")}
        >
          {copied ? <><IconCheck size={12} /> Copied!</> : <><IconCopy size={12} /> Copy</>}
        </button>
      </div>
      <div className="mono whitespace-pre-wrap break-words text-xs leading-relaxed text-ink">{value}</div>
    </div>
  );
}

export default function Review() {
  const { jobId } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const { show, node: toast } = useToast();

  // per-owned-target working state
  const [owned, setOwned] = useState<Record<number, any>>({});
  // marked-posted community kits (local)
  const [postedKits, setPostedKits] = useState<Record<number, boolean>>({});
  // "Copied!" flip key -> timeout
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  // 2D keyboard focus: card index + field index
  const [focus, setFocus] = useState<{ card: number; field: number }>({ card: 0, field: 0 });
  const [editing, setEditing] = useState<string | null>(null); // `${rank}:${fieldIdx}`
  // citation-gap topic queue for this lane — what the next flywheel cycle will build
  const [topics, setTopics] = useState<any[]>([]);
  const [topicsOpen, setTopicsOpen] = useState(false);

  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (!jobId) return;
    api
      .review(jobId)
      .then((d) => {
        setData(d);
        const init: Record<number, any> = {};
        (d.owned || []).forEach((t: any) => {
          init[t.rank] = { fields: (t.fields || []).map((f: any) => ({ ...f })), gate: t.gate || "ok", gate_ok: (t.gate || "ok") === "ok", busy: false, posted: false, result: null };
        });
        setOwned(init);
        if (d.slug) refreshTopics(d.slug);
      })
      .catch((e) => setErr(String(e.message || e)));
  }, [jobId]);

  // The queue is the point of the whole screen: every gap we answer should become an owned asset.
  // Failure here is non-fatal — the review screen must still work if the queue is unreadable.
  async function refreshTopics(slug?: string) {
    const s = slug || data?.slug;
    if (!s) return;
    try {
      const r = await api.topics(s);
      setTopics(r.topics || []);
    } catch {
      /* queue unreadable — leave the list as-is rather than breaking review */
    }
  }

  const community = useMemo(
    () => [...((data?.kits as any[]) || [])].sort((a, b) => (a.rank || 99) - (b.rank || 99)),
    [data]
  );
  const ownedList = useMemo(
    () => [...((data?.owned as any[]) || [])].sort((a, b) => (a.rank || 99) - (b.rank || 99)),
    [data]
  );

  // flat card list for keyboard nav: community first, then owned
  const cards = useMemo(
    () => [
      ...community.map((k) => ({ kind: "kit" as const, d: k, fields: k.fields || [], postUrl: k.post_url })),
      ...ownedList.map((o) => ({ kind: "owned" as const, d: o, fields: owned[o.rank]?.fields || o.fields || [], postUrl: o.post_url })),
    ],
    [community, ownedList, owned]
  );

  const flip = (key: string) => {
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1200);
  };
  const doCopy = useCallback(async (key: string, text: string) => {
    const ok = await copy(text);
    if (ok) flip(key);
    else show("Copy failed", "danger");
  }, [show]);

  // ---- owned target actions ----
  async function commitEdit(rank: number, idx: number, value: string) {
    setEditing(null);
    setOwned((s) => {
      const t = s[rank]; if (!t) return s;
      const fields = t.fields.map((f: any, i: number) => (i === idx ? { ...f, value } : f));
      return { ...s, [rank]: { ...t, fields } };
    });
    // re-run the brand-safety gate on the edited text
    try {
      const cur = (owned[rank]?.fields || []).map((f: any, i: number) => (i === idx ? { ...f, value } : { ...f }));
      const r = await api.editTarget(jobId!, rank, cur);
      setOwned((s) => ({ ...s, [rank]: { ...s[rank], fields: r.fields || s[rank].fields, gate: r.gate, gate_ok: !!r.gate_ok } }));
      if (!r.gate_ok) show(`Gate blocked: ${r.gate}`, "danger");
    } catch (e: any) {
      show(String(e.message || e), "danger");
    }
  }

  // one click posts every OWNED target whose brand-safety gate is green and isn't posted
  // yet — sequential (honest per-item results), same server-side re-gate per post
  const [batchBusy, setBatchBusy] = useState(false);
  async function postAllGateGreen() {
    const ready = ownedList.filter((t: any) => {
      const st = owned[t.rank] || { gate_ok: t.gate === "ok" };
      return st.gate_ok && !st.posted && !st.busy && !(st.result?.result?.needs_media);
    });
    if (!ready.length) { show("Nothing gate-green left to post", "ok"); return; }
    setBatchBusy(true);
    for (const t of ready) {
      // eslint-disable-next-line no-await-in-loop
      await postTarget(t.rank);
    }
    setBatchBusy(false);
  }

  async function postTarget(rank: number) {
    setOwned((s) => ({ ...s, [rank]: { ...s[rank], busy: true } }));
    try {
      const r = await api.postTarget(jobId!, rank);
      const res = r.result || {};
      setOwned((s) => ({ ...s, [rank]: { ...s[rank], busy: false, result: r, posted: !r.dry_run && res.ok } }));
      // Surface what happened to the underlying citation gap, not just the post.
      const tq = r.topic || {};
      const queuedMsg =
        tq.status === "queued" ? ` · queued "${tq.question}" as a ${tq.shape} topic`
        : tq.status === "duplicate" ? " · gap already queued"
        : tq.status === "done" ? " · gap already covered"
        : "";
      if (r.dry_run) show(`Simulated ${r.platform} — nothing posted${queuedMsg}`, "ok");
      else if (res.ok) show(`Posted to ${r.platform}!${queuedMsg}`, "ok");
      else show(res.reason || "Post failed", "danger");
      if (tq.status === "queued") refreshTopics();
    } catch (e: any) {
      setOwned((s) => ({ ...s, [rank]: { ...s[rank], busy: false } }));
      show(String(e.message || e), "danger");
    }
  }

  // ---- keyboard nav ----
  const focusCard = useCallback((i: number) => {
    setFocus({ card: Math.max(0, Math.min(cards.length - 1, i)), field: 0 });
  }, [cards.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || editing) return; // don't hijack typing
      const cur = cards[focus.card];
      if (e.key === "j" || e.key === "J") { e.preventDefault(); focusCard(focus.card + 1); }
      else if (e.key === "k" || e.key === "K") { e.preventDefault(); focusCard(focus.card - 1); }
      else if (e.key === "c" || e.key === "C") {
        if (cur?.fields?.length) {
          const f = cur.fields[Math.min(focus.field, cur.fields.length - 1)];
          doCopy(`kb-${focus.card}-${focus.field}`, f.value);
          show(`Copied ${f.label}`, "ok");
        }
      } else if (e.key === "o" || e.key === "O") {
        if (cur?.postUrl) window.open(cur.postUrl, "_blank", "noreferrer");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cards, focus, editing, focusCard, doCopy, show]);

  useEffect(() => {
    cardRefs.current[focus.card]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focus.card]);

  if (err) return <Page title="Review drafts"><Banner tone="danger"><IconAlert size={14} /> {err}</Banner></Page>;
  if (!data)
    return (
      <Page title="Review drafts">
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40" />)}</div>
      </Page>
    );

  const total = community.length + ownedList.length;
  const postedCount = Object.values(postedKits).filter(Boolean).length + Object.values(owned).filter((t: any) => t.posted).length;
  const armed = !data.dry_run;

  return (
    <Page title={`Review · ${data.brand?.name || data.slug}`} crumb="Approve · copy · post">
      {toast}

      {/* toolbar */}
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-3">
          <button className="btn-ghost !py-1.5 !text-xs" onClick={() => nav(`/audit/${jobId}`)}>← Back to audit</button>
          <div className="text-sm text-muted">
            <span className="font-semibold text-ink">{postedCount}</span> / {total} posted
          </div>
          <button className="btn-primary !py-1.5 !text-xs" disabled={batchBusy}
            onClick={postAllGateGreen}
            title="Posts every owned target whose brand-safety gate is green (each one still re-gates server-side)">
            {batchBusy ? <Spinner size={12} /> : null} Post all gate-green
          </button>
          <button className="btn-ghost !py-1.5 !text-xs" onClick={() => { setTopicsOpen(o => !o); refreshTopics(); }}
            title="Citation gaps queued as owned-asset topics for the next flywheel cycle">
            Topic queue <span className="font-semibold text-ink">{topics.length}</span>
          </button>
        </div>
        <div className="flex items-center gap-2">
          {armed ? <Chip tone="warn">● ARMED — posts go live</Chip> : <Chip tone="dim">● DRY-RUN — simulate only</Chip>}
          <span className="hidden items-center gap-2 text-[11px] text-dim md:flex">
            <kbd className="rounded border border-line bg-surface px-1.5 py-0.5 mono">J</kbd>/<kbd className="rounded border border-line bg-surface px-1.5 py-0.5 mono">K</kbd> move
            <kbd className="rounded border border-line bg-surface px-1.5 py-0.5 mono">C</kbd> copy
            <kbd className="rounded border border-line bg-surface px-1.5 py-0.5 mono">O</kbd> open
          </span>
        </div>
      </Card>

      {/* ===== Community drafts (copy-only) ===== */}
      <Section
        title="Community drafts — copy &amp; paste"
        sub="Always posted by hand. Copy each field, open the thread, paste. The community guardrail never auto-posts these."
      >
        {community.length === 0 ? (
          <Empty title="No community drafts in this run" />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {community.map((k: any, ci: number) => {
              const cardIdx = ci; // community come first in flat list
              const focused = focus.card === cardIdx;
              const posted = !!postedKits[k.rank];
              const allText = (k.fields || []).map((f: any) => `${f.label}: ${f.value}`).join("\n\n");
              return (
                <div
                  key={k.rank}
                  ref={(el) => (cardRefs.current[cardIdx] = el)}
                  onClick={() => setFocus({ card: cardIdx, field: 0 })}
                  className={
                    "card p-4 transition-all " +
                    (focused ? "ring-2 ring-primary/40 " : "") +
                    (posted ? "opacity-60" : "")
                  }
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Chip tone="primary">{titleCase(k.platform)}</Chip>
                      {k.handle && <span className="mono text-xs text-muted">{k.handle}</span>}
                      <Chip tone={k.priority === "high" ? "warn" : "dim"}>{k.priority}</Chip>
                    </div>
                    <span className="text-[11px] text-dim">#{k.rank}</span>
                  </div>

                  {k.why && <p className="mt-2 text-xs text-muted">{k.why}</p>}

                  <div className="mt-3 space-y-2">
                    {(k.fields || []).map((f: any, fi: number) => {
                      const key = `kit-${k.rank}-${fi}`;
                      return (
                        <CopyField
                          key={fi}
                          label={f.label}
                          value={f.value}
                          copied={copiedKey === key}
                          focused={focused && focus.field === fi}
                          onCopy={() => { setFocus({ card: cardIdx, field: fi }); doCopy(key, f.value); }}
                        />
                      );
                    })}
                  </div>

                  <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
                    <button className="btn-ghost flex-1 !text-xs" onClick={() => doCopy(`kit-all-${k.rank}`, allText)}>
                      {copiedKey === `kit-all-${k.rank}` ? <><IconCheck size={13} /> Copied all</> : <><IconCopy size={13} /> Copy all</>}
                    </button>
                    {k.post_url && (
                      <a className="btn-ghost !text-xs" href={k.post_url} target="_blank" rel="noreferrer">
                        <IconExternal size={13} /> Open
                      </a>
                    )}
                    <button
                      className={posted ? "btn-ghost !text-xs !text-ok" : "btn-ghost !text-xs"}
                      onClick={() => setPostedKits((s) => ({ ...s, [k.rank]: !s[k.rank] }))}
                    >
                      {posted ? <><IconCheck size={13} /> Posted</> : "Mark posted"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* ===== Owned / auto targets (approve-to-post) ===== */}
      <Section
        title="Owned channels — approve &amp; post"
        sub={armed ? "Armed. Edit any field, then post to your live channel." : "Dry-run. Edit any field and simulate — nothing goes live until you arm the client."}
      >
        {ownedList.length === 0 ? (
          <Empty title="No owned targets in this run" />
        ) : (
          <div className="space-y-4">
            {ownedList.map((t: any, oi: number) => {
              const cardIdx = community.length + oi;
              const focused = focus.card === cardIdx;
              const st = owned[t.rank] || { fields: t.fields, gate: t.gate, gate_ok: t.gate === "ok", busy: false };
              const res = st.result?.result || {};
              const needsMedia = !!res.needs_media;
              const canPost = st.gate_ok && !st.busy && !needsMedia;
              return (
                <div
                  key={t.rank}
                  ref={(el) => (cardRefs.current[cardIdx] = el)}
                  tabIndex={0}
                  onClick={() => setFocus({ card: cardIdx, field: 0 })}
                  onFocus={() => setFocus((f: any) => (f.card === cardIdx ? f : { card: cardIdx, field: 0 }))}
                  className={"card p-4 transition-all " + (focused ? "ring-2 ring-primary/40 " : "") + (st.posted ? "opacity-70" : "")}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Chip tone="primary">{titleCase(t.platform)}</Chip>
                      <Chip tone="ok">auto</Chip>
                      <Chip tone={t.priority === "high" ? "warn" : "dim"}>{t.priority}</Chip>
                      <span className="text-xs text-muted">{t.cluster}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Chip tone={st.gate_ok ? "ok" : "danger"}>{st.gate_ok ? "✓ gate ok" : `✗ ${st.gate}`}</Chip>
                      <span className="text-[11px] text-dim">#{t.rank}</span>
                    </div>
                  </div>

                  {t.why && <p className="mt-2 text-xs text-muted">{t.why}</p>}

                  <div className="mt-3 space-y-2">
                    {(st.fields || []).map((f: any, fi: number) => {
                      const ek = `${t.rank}:${fi}`;
                      const isEditing = editing === ek;
                      const isFocusedField = focused && focus.field === fi;
                      return (
                        <div
                          key={fi}
                          className={"rounded-xl border p-2.5 transition-colors " + (isFocusedField ? "border-primary/50 bg-primary/5" : "border-line bg-surface/40")}
                        >
                          <div className="mb-1 flex items-center justify-between">
                            <span className="label">{f.label}</span>
                            {!isEditing && <span className="text-[10px] text-dim">click to edit</span>}
                          </div>
                          {isEditing ? (
                            <textarea
                              autoFocus
                              defaultValue={f.value}
                              aria-label={`Edit ${f.label}`}
                              className="input mono min-h-[80px] text-xs"
                              onBlur={(e) => commitEdit(t.rank, fi, e.target.value)}
                            />
                          ) : (
                            <div
                              role="button"
                              tabIndex={0}
                              aria-label={`Edit ${f.label}`}
                              className="mono cursor-text whitespace-pre-wrap break-words text-xs leading-relaxed text-ink hover:text-primary-light focus:outline-none focus:ring-1 focus:ring-primary/50"
                              onClick={(e) => { e.stopPropagation(); setFocus({ card: cardIdx, field: fi }); setEditing(ek); }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault(); e.stopPropagation();
                                  setFocus({ card: cardIdx, field: fi }); setEditing(ek);
                                }
                              }}
                            >
                              {f.value || <span className="text-dim">empty — click to write</span>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* simulate plan / result */}
                  {st.result && (
                    <div className="mt-3 rounded-xl border border-line bg-surface/50 p-3 text-xs">
                      <div className="mb-1 flex items-center gap-2 text-dim">
                        <IconBolt size={12} /> {st.result.dry_run ? "Simulated plan (nothing posted)" : "Post result"}
                      </div>
                      <pre className="mono max-h-40 overflow-auto whitespace-pre-wrap break-words text-[11px] text-muted">
                        {JSON.stringify(st.result.result?.plan || st.result.result, null, 2)}
                      </pre>
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                    {armed ? (
                      <button className="btn-primary !text-xs" disabled={!canPost} onClick={() => postTarget(t.rank)}>
                        <IconShield size={14} /> {st.busy ? "Posting…" : "Approve & Post"}
                      </button>
                    ) : (
                      <button className="btn-primary !text-xs" disabled={!canPost} onClick={() => postTarget(t.rank)}>
                        <IconPlay size={14} /> {st.busy ? "Simulating…" : "Simulate"}
                      </button>
                    )}
                    {t.post_url && (
                      <a className="btn-ghost !text-xs" href={t.post_url} target="_blank" rel="noreferrer">
                        <IconExternal size={13} /> Open channel
                      </a>
                    )}
                    {!st.gate_ok && <span className="text-[11px] text-danger">Fix the flagged text to enable posting.</span>}
                    {needsMedia && (
                      <span className="chip bg-warn/12 text-warn"><IconAlert size={12} /> needs rendered video</span>
                    )}
                    {st.posted && <span className="chip bg-ok/15 text-ok"><IconCheck size={12} /> posted</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </Page>
  );
}
