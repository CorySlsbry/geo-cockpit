import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";

/**
 * The full-chain stepper (Cory 2026-08-20): "step 1 pulsing when working, stops when done, then
 * step 2 pulses... and if steps run at the same time they are BOTH pulsing until they stop."
 *
 * The pulse is driven by the orchestrator's state file, polled every 5s - not by an animation
 * timer - so a pulsing step means the runner process is genuinely inside that step. Blog runs
 * alone (everything downstream aims at its published slug); long-form, short and still then run
 * in parallel, which is why all three can pulse at once.
 */
const STEPS: { key: string; label: string; sub: string }[] = [
  { key: "blog", label: "Blog post", sub: "pinned to your phrase" },
  { key: "longform", label: "Long-form", sub: "wide 16:9 → YouTube" },
  { key: "short", label: "Short", sub: "9:16 → YT/IG/FB/LI" },
  { key: "still", label: "Still", sub: "1:1 card → socials" },
];

function Dot({ status }: { status: string }) {
  if (status === "running")
    return <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-primary" />;
  if (status === "done")
    return <span className="inline-block h-2.5 w-2.5 rounded-full bg-ok" />;
  if (status === "failed")
    return <span className="inline-block h-2.5 w-2.5 rounded-full bg-danger" />;
  if (status === "skipped")
    return <span className="inline-block h-2.5 w-2.5 rounded-full bg-dim opacity-40" />;
  return <span className="inline-block h-2.5 w-2.5 rounded-full border border-line" />;
}

export function ChainStepper({ slug }: { slug: string }) {
  const [chain, setChain] = useState<any>(null);
  const timer = useRef<any>(null);

  const load = () => api.chainStatus(slug).then(setChain).catch(() => {});

  useEffect(() => {
    load();
    return () => timer.current && clearInterval(timer.current);
  }, [slug]);

  /* Poll only while a chain is live. A finished chain stays on screen as the record of what
     happened; a page with no chain history renders nothing at all. */
  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (chain?.active) timer.current = setInterval(load, 5000);
    return () => timer.current && clearInterval(timer.current);
  }, [chain?.active, slug]);

  if (!chain?.exists) return null;
  const steps = chain.steps || {};
  const running = STEPS.filter((s) => steps[s.key]?.status === "running").map((s) => s.label);

  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="label">Pipeline</span>
        <span className="text-muted truncate max-w-[26rem]" title={chain.phrase}>
          &ldquo;{chain.phrase}&rdquo;
        </span>
        {chain.active && (
          <span className="text-primary animate-pulse">
            {running.length ? `running: ${running.join(" + ")}` : "starting…"}
          </span>
        )}
        {chain.done && (
          <span className={chain.ok ? "text-ok" : "text-danger"}>
            {chain.ok ? "complete" : "finished with failures"}
          </span>
        )}
        {chain.stale && !chain.done && (
          <span className="text-warn">stalled — check the chain log</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {STEPS.map((s, i) => {
          const st = steps[s.key] || {};
          const status = st.status || "queued";
          return (
            <div key={s.key} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-dim text-[10px]">{i === 1 ? "→" : "·"}</span>}
              <div
                className={
                  "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 " +
                  (status === "running"
                    ? "border-primary/60 bg-primary/10"
                    : status === "failed"
                      ? "border-danger/50"
                      : "border-line")
                }
                title={st.note || s.sub}
              >
                <Dot status={status} />
                <div>
                  <div className="text-[11px] leading-tight">{s.label}</div>
                  <div className="text-[9px] text-dim leading-tight">
                    {status === "queued" ? s.sub : status}
                    {st.note && status !== "running" ? ` · ${String(st.note).slice(0, 42)}` : ""}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
