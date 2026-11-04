import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Page } from "../components/Page";
import { Card, Stat, Section, Skeleton, Banner, Chip } from "../components/ui";
import { AreaTrend, LineTrend, Sparkline, PALETTE } from "../components/Charts";
import { IconAlert, IconChevron } from "../components/icons";
import { api } from "../lib/api";
import { money, num, pct } from "../lib/format";

const AC_STATUS_TONE: Record<string, string> = { working: "warn", prepared: "primary", sent: "ok", hold: "dim", todo: "dim" };

function ActionCenter() {
  const [ac, setAc] = useState<any>(null);
  const nav = useNavigate();
  useEffect(() => {
    const load = () => api.actionCenter().then(setAc).catch(() => setAc({ clients: [], jobs: [] }));
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);
  if (!ac) return null;
  const clients = ac.clients || [];
  const jobs = ac.jobs || [];
  const nothing = !clients.length && !jobs.length && !ac.ads_pending;
  return (
    <Section title="Action Center" sub="Everything waiting on you or in flight, across every client">
      {nothing ? (
        <Card className="p-4 text-xs text-muted">All clear — no pending actions, no running jobs, no ads analysis waiting.</Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {ac.ads_pending && (
            <button onClick={() => nav("/ads")} className="card card-hover p-4 text-left">
              <div className="flex items-center justify-between">
                <span className="font-medium text-ink">Ads analysis pending</span>
                <Chip tone="warn">{ac.ads_pending.proposals} proposal{ac.ads_pending.proposals === 1 ? "" : "s"}</Chip>
              </div>
              <div className="mt-1 text-xs text-muted">Perform or decline — analyzed {ac.ads_pending.at}</div>
            </button>
          )}
          {jobs.map((j: any) => (
            <button key={j.id} onClick={() => nav(j.kind === "audit" ? `/audit/${j.id}` : `/clients/${j.slug}`)}
              className="card card-hover p-4 text-left">
              <div className="flex items-center justify-between">
                <span className="font-medium text-ink">{j.slug}</span>
                <Chip tone="warn">{j.kind || "job"} · {j.status}</Chip>
              </div>
              <div className="mt-1 text-xs text-muted">started {j.created_at}</div>
            </button>
          ))}
          {clients.map((c: any) => (
            <button key={c.slug} onClick={() => nav(`/clients/${c.slug}`)} className="card card-hover p-4 text-left">
              <div className="flex items-center justify-between">
                <span className="font-medium text-ink">{c.name}</span>
                <Chip tone={c.counts.working ? "warn" : "primary"}>{c.open} open action{c.open === 1 ? "" : "s"}</Chip>
              </div>
              <div className="mt-2 grid gap-1">
                {c.top.map((a: any) => (
                  <div key={a.id} className="flex items-center gap-2 text-xs text-muted">
                    <Chip tone={(AC_STATUS_TONE[a.status] || "dim") as any}>{a.status}</Chip>
                    <span className="truncate">{a.title}</span>
                  </div>
                ))}
              </div>
            </button>
          ))}
        </div>
      )}
    </Section>
  );
}

export default function Dashboard() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const nav = useNavigate();

  useEffect(() => {
    api.dashboard().then(setD).catch((e) => setErr(String(e.message || e)));
  }, []);

  if (err) return <Page title="Dashboard"><Banner tone="danger"><IconAlert size={14} /> {err}</Banner></Page>;
  if (!d)
    return (
      <Page title="Dashboard" crumb="Overview">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64" />
      </Page>
    );

  const c = d.company || {};
  const clients = d.clients || [];
  const totalAudits = clients.reduce((a: number, x: any) => a + (x.kpis?.audits_run || 0), 0);
  // Latest point of each brand's citation series, summed — the same figure Home's proof band shows.
  const citedLatest = clients.reduce((a: number, x: any) => {
    const s = x.geo?.cited;
    return a + (Array.isArray(s) && s.length ? Number(s[s.length - 1]?.v ?? s[s.length - 1]) || 0 : 0);
  }, 0);

  return (
    <Page title="Dashboard" crumb="Overview · all platforms + clients">
      {!d.bridge_available && (
        <Banner><IconAlert size={14} /> Bridge metrics.db not found — charts populate once the Bridge collectors run.</Banner>
      )}

      {/* cross-client roll-up: the day starts here */}
      <ActionCenter />

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Revenue · 30d" value={money(c.revenue_30d)} sub={`${num(c.orders_30d)} orders`} />
        <Stat label="Ad spend · 30d" value={c.ad_spend_30d == null ? "—" : money(c.ad_spend_30d)} sub="Meta" />
        <Stat label="Site uptime" value={c.uptime == null ? "—" : pct(c.uptime)} tone={c.uptime >= 99 ? "ok" : c.uptime ? "warn" : undefined} sub="Sentinel" />
        <Stat label="Clients" value={num(clients.length)} sub="active brands" />
        <Stat label="Audits run" value={num(totalAudits)} sub="all time" />
        {/* Was "AI compute: Max / subscription" — internal plumbing in the demo money shot.
            Citations held is the number this product exists to move. */}
        <Stat label="Citations held" value={num(citedLatest)} sub="across all brands" tone="ok" />
      </div>

      {/* company charts */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-primary-light">Revenue · all brands (Stripe)</h3>
            <span className="text-[11px] text-dim">daily</span>
          </div>
          <AreaTrend data={c.revenue_series || []} money height={230} />
        </Card>
        <Card className="p-4">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-primary-light">Site uptime %</h3>
          <LineTrend data={c.uptime_series || []} color={PALETTE.ok} height={230} />
        </Card>
      </div>

      {/* per-client analytics */}
      <Section title="Per-client performance" sub="GEO citation share, revenue, and channel growth — click a card to open the client">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {clients.map((cl: any) => (
            <button
              key={cl.slug}
              onClick={() => nav(`/clients/${cl.slug}`)}
              className="card card-hover group p-4 text-left"
            >
              <div className="flex items-center justify-between">
                <div className="font-semibold text-ink">{cl.name}</div>
                <IconChevron size={16} className="text-dim transition-transform group-hover:translate-x-0.5" />
              </div>
              <div className="mt-3 flex items-end gap-4">
                <div>
                  <div className="label">Citation share</div>
                  <div className="text-2xl font-semibold text-primary-light">
                    {cl.geo?.share_latest == null ? "—" : pct(cl.geo.share_latest)}
                  </div>
                </div>
                <div className="ml-auto text-right">
                  <div className="label">Revenue 30d</div>
                  <div className="text-lg font-semibold text-ink">{money(cl.kpis?.revenue_30d)}</div>
                </div>
              </div>
              <div className="mt-2 -mx-1">
                <Sparkline data={cl.revenue?.length ? cl.revenue : cl.geo?.cited || []} color={PALETTE.primary} />
              </div>
              <div className="mt-2 flex items-center gap-2 text-[11px] text-muted">
                <Chip tone="dim">{num(cl.youtube?.subs_latest)} subs</Chip>
                <Chip tone="dim">{cl.kpis?.audits_run || 0} audits</Chip>
              </div>
            </button>
          ))}
        </div>
      </Section>
    </Page>
  );
}
