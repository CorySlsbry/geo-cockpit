import { useEffect, useMemo, useState } from "react";
import { Page } from "../components/Page";
import { Card, Section, Banner, Dot, Chip, Skeleton, Empty } from "../components/ui";
import { IconAlert, IconRefresh, IconBolt } from "../components/icons";
import { api } from "../lib/api";
import { titleCase } from "../lib/format";

const TABS = ["dm", "email", "social", "cockpit"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { dm: "DMs", email: "Email", social: "Social", cockpit: "Cockpit" };

// render a scalar-ish value compactly for the details column
function val(v: any): string {
  if (v == null) return "—";
  if (Array.isArray(v)) return v.length ? `${v.length} item${v.length > 1 ? "s" : ""}` : "none";
  if (typeof v === "object") {
    try { const s = JSON.stringify(v); return s.length > 80 ? s.slice(0, 79) + "…" : s; } catch { return "{…}"; }
  }
  return String(v);
}

function DeliveryTable({ rows }: { rows: any[] }) {
  const sorted = useMemo(() => [...(rows || [])].sort((a, b) => String(b.ts || "").localeCompare(String(a.ts || ""))), [rows]);
  if (!sorted.length) return <Empty title="No deliveries yet" sub="Rows appear here as the engine ships." />;
  return (
    <Card className="overflow-hidden p-0">
      <div className="max-h-[26rem] overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card">
            <tr className="border-b border-line text-left text-[10px] uppercase tracking-wider text-dim">
              <th className="px-4 py-2 font-semibold">Time</th>
              <th className="px-4 py-2 font-semibold">Kind</th>
              <th className="px-4 py-2 font-semibold">Detail</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => {
              const entries = Object.entries(r).filter(([k]) => k !== "ts" && k !== "kind");
              const bad = r.ok === false || r.error || String(r.kind || "").includes("unavailable") || String(r.kind || "").includes("fail");
              return (
                <tr key={i} className="border-b border-line/50 align-top last:border-0">
                  <td className="whitespace-nowrap px-4 py-2 mono text-dim">{String(r.ts || "").slice(5, 19).replace("T", " ")}</td>
                  <td className="whitespace-nowrap px-4 py-2">
                    <Chip tone={bad ? "danger" : r.ok === true ? "ok" : "dim"}>{titleCase(r.kind || "event")}</Chip>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted">
                      {entries.length === 0 ? (
                        <span className="text-dim">—</span>
                      ) : (
                        entries.map(([k, v]) => (
                          <span key={k} className="mono">
                            <span className="text-dim">{k}:</span> <span className={k === "error" ? "text-danger" : "text-ink"}>{val(v)}</span>
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function Monitor() {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("dm");

  useEffect(() => {
    let stop = false;
    const load = () => api.monitor().then((d) => !stop && setData(d)).catch((e) => !stop && setErr(String(e.message || e)));
    load();
    const t = setInterval(load, 15000); // auto-refresh (task/delivery state changes on a minutes scale)
    return () => { stop = true; clearInterval(t); };
  }, []);

  if (err && !data) return <Page title="Monitor"><Banner tone="danger"><IconAlert size={14} /> {err}</Banner></Page>;
  if (!data)
    return (
      <Page title="Monitor">
        <Skeleton className="h-28" />
        <Skeleton className="h-48" />
        <Skeleton className="h-72" />
      </Page>
    );

  const caps = data.capabilities || {};
  const claude = data.claude || {};
  const tasks = data.tasks || [];
  const deliveries = data.deliveries || {};
  const prefers = claude.prefers === "cli-subscription" ? "subscription" : claude.prefers || "—";

  return (
    <Page title="Monitor" crumb="Engine health · deliveries · task schedule">
      {/* What's live */}
      <Section title="What's live" sub="Providers, credentials, and the Claude path in use">
        <Card className="p-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {Object.entries(caps).map(([k, v]) => (
              <div key={k} className="flex items-center gap-2 rounded-xl border border-line bg-surface/40 px-3 py-2 text-xs">
                <Dot tone={v ? "ok" : "dim"} pulse={!!v} />
                <span className="text-ink">{titleCase(k)}</span>
                <span className="ml-auto mono text-[10px] text-dim">{v ? "on" : "off"}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs">
            <IconBolt size={14} className="text-primary-light" />
            <span className="text-muted">Claude path</span>
            <Chip tone="ok">{prefers}</Chip>
            <span className="text-dim">·</span>
            <span className="text-muted">CLI</span> <Dot tone={claude.cli_available ? "ok" : "dim"} />
            <span className="text-muted">API</span> <Dot tone={claude.api_available ? "ok" : "dim"} />
            {data.last_path?.model && (
              <span className="ml-auto mono text-[11px] text-dim">last: {data.last_path.model} · {data.last_path.ok ? "ok" : "err"}{data.last_path.ms ? ` · ${data.last_path.ms}ms` : ""}</span>
            )}
          </div>
        </Card>
      </Section>

      {/* Scheduled tasks */}
      <Section title="Scheduled tasks" sub="Windows Task Scheduler registrations — red means not registered">
        {tasks.length === 0 ? (
          <Empty title="No tasks registered" />
        ) : (
          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-dim">
                    <th className="px-4 py-2.5 font-semibold">Task</th>
                    <th className="px-4 py-2.5 font-semibold">State</th>
                    <th className="px-4 py-2.5 font-semibold">Last run</th>
                    <th className="px-4 py-2.5 font-semibold">Next run</th>
                    <th className="px-4 py-2.5 font-semibold">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((t: any, i: number) => {
                    const reg = t.registered;
                    return (
                      <tr key={i} className="border-b border-line/60 last:border-0">
                        <td className="px-4 py-2.5 font-medium text-ink">{t.name}</td>
                        <td className="px-4 py-2.5">
                          {reg ? (
                            <span className="inline-flex items-center gap-1.5"><Dot tone={t.state === "Enabled" ? "ok" : "warn"} /> <span className="text-muted">{t.status || t.state || "registered"}</span></span>
                          ) : (
                            <Chip tone="danger">not registered</Chip>
                          )}
                        </td>
                        <td className="px-4 py-2.5 mono text-xs text-muted">{t.last_run || "—"}</td>
                        <td className="px-4 py-2.5 mono text-xs text-muted">{t.next_run || "—"}</td>
                        <td className="px-4 py-2.5">
                          {t.last_result_label == null && t.last_result == null ? <span className="text-dim">—</span> : (
                            <span title={t.last_result != null ? `code ${t.last_result}` : undefined}>
                              <Chip tone={t.last_result_ok === true ? "ok" : t.last_result_ok === false ? "danger" : "warn"}>
                                {t.last_result_label || (String(t.last_result) === "0" ? "Success" : `code ${t.last_result}`)}
                              </Chip>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </Section>

      {/* Deliveries */}
      <Section
        title="Deliveries"
        sub="Newest first · auto-refreshing every 5s"
        right={<span className="flex items-center gap-1.5 text-[11px] text-dim"><IconRefresh size={12} /> live</span>}
      >
        <div className="mb-3 flex flex-wrap gap-1.5">
          {TABS.map((t) => {
            const n = (deliveries[t] || []).length;
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={
                  "chip transition-colors " +
                  (tab === t ? "bg-primary/15 text-primary-light shadow-[inset_0_0_0_1px_rgba(124,92,255,0.3)]" : "bg-white/5 text-muted hover:text-ink")
                }
              >
                {TAB_LABEL[t]} <span className="mono text-[10px] opacity-70">{n}</span>
              </button>
            );
          })}
        </div>
        <DeliveryTable rows={deliveries[tab] || []} />
      </Section>
    </Page>
  );
}
