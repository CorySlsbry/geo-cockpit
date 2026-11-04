import { useEffect, useState } from "react";
import { Card, Chip, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { ChainStepper } from "./ChainStepper";

/**
 * Manual longtail target.
 *
 * Research proposes buyer questions and onboarding infers them, but until now an operator who
 * simply KNEW the term to chase had nowhere to type it. The provenance schema has carried
 * "manual" since cluster_hygiene was written, and clear-inferred already promises hand-entered
 * terms survive a cleanup, so the only missing piece was a way in that is not editing the
 * client JSON by hand.
 *
 * Deliberately shows the manual terms it has added, with a remove on each: a field that swallows
 * input and shows nothing back gives an operator no way to tell a typo from a duplicate.
 */
export function ManualTarget({ slug, onChanged }: { slug: string; onChanged: () => void }) {
  const [term, setTerm] = useState("");
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ tone: "ok" | "warn" | "err"; text: string } | null>(null);

  /* Reads provenance from the server rather than from the page summary. The summary's shape is
     owned by another surface, and deriving "which of these did I type" from it would break
     silently the day that shape changes. A failed read shows no chips rather than wrong ones. */
  const loadManual = () =>
    api.clustersStatus(slug)
      .then((r: any) => setManual((r?.terms || []).filter((x: any) => x?.source === "manual").map((x: any) => x.term)))
      .catch(() => setManual([]));

  useEffect(() => { loadManual(); }, [slug]);

  const add = async () => {
    const t = term.trim();
    if (!t || busy) return;
    setBusy(true); setMsg(null);
    try {
      const r: any = await api.clustersAdd(slug, t);
      if (r?.added === false) {
        // Not an error. Saying so plainly beats a silent no-op that reads as a broken button.
        setMsg({ tone: "warn", text: `already tracked: "${r.term}"` });
      } else {
        setMsg({ tone: "ok", text: `added "${r.term}". It will be measured on the next run` });
        setTerm("");
      }
      await loadManual();
      onChanged();
    } catch (e: any) {
      setMsg({ tone: "err", text: e?.message || "could not add that term" });
    } finally {
      setBusy(false);
    }
  };

  /* The FULL CHAIN: blog -> longform | short | still, all pinned to this phrase. Owner-gated
     server-side; this spends real money (~$2-4) and publishes to every connected surface, so the
     button is explicit and separate from "Add target". */
  const [chainKey, setChainKey] = useState(0);
  const runChain = async () => {
    const t = term.trim();
    if (!t || busy) return;
    if (!window.confirm(`Run the FULL pipeline for:

"${t}"

Blog post + long-form + short + still card, published to every connected surface. This takes 40-90 minutes.`)) return;
    setBusy(true); setMsg(null);
    try {
      await api.clustersAdd(slug, t).catch(() => {});   // target it for measurement too; dup is fine
      const r: any = await api.runChain(slug, t);
      setMsg({ tone: "ok", text: r?.note || "chain launched" });
      setTerm("");
      setChainKey((k) => k + 1);                        // remount the stepper so it starts polling
      onChanged();
    } catch (e: any) {
      setMsg({ tone: "err", text: e?.message || "could not start the chain" });
    } finally {
      setBusy(false);
    }
  };

  /* PER-STEP RUNS (Cory 2026-08-24): "a button to run for each platform".
     The full pipeline is 40-90 minutes and ~$2-4, so re-running it because ONE step failed is
     most of the cost for none of the reason. chain_run.py has always supported --only; this is
     the way in.

     ⛔ Blog is the odd one out and the UI has to say so: it CREATES the post from the phrase,
     while the other three aim at one that already exists. Pointing a render at the wrong post is
     the wrong-topic defect this pipeline has shipped three times, so the target is chosen
     explicitly rather than inferred. */
  const STEPS = [
    { key: "blog", label: "Blog post", to: "your site", mins: "10-20 min",
      hint: "Writes a NEW post from the phrase above. Ignores the target picker." },
    { key: "longform", label: "Long-form", to: "YouTube", mins: "30-60 min",
      hint: "Wide 16:9 video aimed at the selected post." },
    { key: "short", label: "Short", to: "YT/IG/FB/LI", mins: "10-15 min",
      hint: "Vertical 9:16, queued then flushed to every connected surface." },
    { key: "still", label: "Still", to: "IG/FB/LI", mins: "2-3 min",
      hint: "1:1 card posted through the social fan-out." },
  ];
  const [posts, setPosts] = useState<any[]>([]);
  const [target, setTarget] = useState<string>("manual");
  const [step, setStep] = useState<string>("");        // which step is launching

  useEffect(() => {
    api.recentPosts(slug, 5)
      .then((r: any) => {
        const p = r?.posts || [];
        setPosts(p);
        // Default to the newest post, because that is what a re-run is almost always about.
        // Falls back to the manual box when the lane has no posts yet.
        setTarget(p.length ? p[0].slug : "manual");
      })
      .catch(() => setPosts([]));
  }, [slug]);

  const runStep = async (k: string) => {
    const s = STEPS.find((x) => x.key === k)!;
    const t = term.trim();
    const usingManual = k === "blog" || target === "manual";
    if (usingManual && !t) {
      setMsg({ tone: "warn", text: `type the phrase above first - ${s.label} needs it` });
      return;
    }
    const aim = k === "blog"
      ? `a NEW post for "${t}"`
      : target === "manual"
        ? `the post matching "${t}"`
        : `/${target}`;
    if (!window.confirm(`Run ${s.label} only.

Target: ${aim}
Publishes to: ${s.to}
Takes about ${s.mins}.`)) return;
    setStep(k); setMsg(null);
    try {
      /* The phrase is what the stepper prints and what the renderers aim at, so an empty box
         must fall back to something TRUE about this run: the selected post's own title. A
         synthetic label like "re-run short for <slug>" would satisfy the length check and then
         show up as the headline of a video. */
      const chosen = posts.find((p) => p.slug === target);
      const phrase = t || (chosen?.title || "").trim();
      if (!phrase) {
        setMsg({ tone: "warn", text: "type the phrase above - that post has no usable title" });
        setStep("");
        return;
      }
      const r: any = await api.runChain(slug, phrase, {
        only: [k],
        post_slug: k === "blog" ? undefined : target,
      });
      setMsg({ tone: "ok", text: r?.note?.split(";")[0] || `${s.label} launched` });
      setChainKey((c) => c + 1);
      onChanged();
    } catch (e: any) {
      setMsg({ tone: "err", text: e?.message || `could not start ${s.label}` });
    } finally {
      setStep("");
    }
  };

  const remove = async (t: string) => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      await api.clustersRemove(slug, t);
      setMsg({ tone: "ok", text: `removed "${t}"` });
      await loadManual();
      onChanged();
    } catch (e: any) {
      setMsg({ tone: "err", text: e?.message || "could not remove that term" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="label">Manual target</span>
        <Chip tone="primary" title="Hand-entered by you. Survives clear-inferred and is measured like any researched term.">
          longtail
        </Chip>
      </div>
      <p className="mb-3 text-[11px] text-muted">
        Know the exact phrase you want to be cited for? Add it here. It is measured on the next run
        and is never removed by "clear guesses".
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input min-w-[16rem] flex-1"
          value={term}
          placeholder="e.g. ai search engine optimization agency"
          maxLength={160}
          disabled={busy}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          aria-label="Manual longtail target"
        />
        <button className="btn" onClick={add} disabled={busy || !term.trim()}>
          {busy ? <Spinner /> : "Add target"}
        </button>
        <button
          className="btn"
          onClick={runChain}
          disabled={busy || !term.trim()}
          title="Blog post + long-form (wide) + short (vertical, fanned out) + 1:1 still card, all targeting this phrase"
        >
          Run full pipeline
        </button>
      </div>

      {msg && (
        <div
          className={
            "mt-2 text-[11px] " +
            (msg.tone === "ok" ? "text-ok" : msg.tone === "warn" ? "text-warn" : "text-danger")
          }
        >
          {msg.text}
        </div>
      )}

      {/* Run ONE step. Separate row, separate confirm, because the whole point is that this is
          cheaper than the full pipeline and the operator should be able to see which is which. */}
      <div className="mt-3 border-t border-line pt-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="label">Run one step</span>
          <label className="flex items-center gap-1.5 text-[11px] text-muted">
            aim at
            <select
              className="input !py-1 !text-[11px] max-w-[22rem]"
              value={target}
              disabled={!!step || busy}
              onChange={(e) => setTarget(e.target.value)}
              aria-label="Post the step should target"
            >
              {posts.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {(p.at || "").slice(0, 10)}
                  {p.dated ? "" : "~"} · {p.title || p.slug}
                </option>
              ))}
              <option value="manual">Manual phrase (from the box above)</option>
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {STEPS.map((s) => (
            <button
              key={s.key}
              className="btn-ghost !px-3 !py-1.5 !text-[11px]"
              onClick={() => runStep(s.key)}
              disabled={!!step || busy}
              title={`${s.hint} Publishes to ${s.to}. About ${s.mins}.`}
            >
              {step === s.key ? <Spinner /> : s.label}
              <span className="ml-1.5 text-dim">→ {s.to}</span>
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[10px] text-dim">
          {posts.length
            ? "Blog writes a new post from the phrase above. Long-form, Short and Still aim at the post you pick."
            : "No posts on this lane yet, so every step uses the phrase above."}
          {posts.some((p) => !p.dated) && " A ~ marks a date taken from the file, not a publish record."}
        </p>
      </div>

      {!!manual.length && (
        <div className="mt-3 border-t border-line pt-2">
          <div className="mb-1.5 text-[10px] text-dim">
            Your targets ({manual.length}) &middot; click to remove
          </div>
          <div className="flex flex-wrap gap-1.5">
            {manual.map((t) => (
              <button key={t} onClick={() => remove(t)} disabled={busy} title={`Remove "${t}"`}>
                <Chip tone="primary">{t} &times;</Chip>
              </button>
            ))}
          </div>
        </div>
      )}
    <ChainStepper key={chainKey} slug={slug} />
    </Card>
  );
}
