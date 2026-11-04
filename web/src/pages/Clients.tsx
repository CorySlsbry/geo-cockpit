import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Page } from "../components/Page";
import { Card, Chip, Dot, Banner, Skeleton, Empty } from "../components/ui";
import { Modal } from "../components/Modal";
import { COPY } from "../lib/copy";
import { ConnectModal } from "../components/ConnectModal";
import { IconAlert, IconPlay, IconShield, IconClients, IconChevron } from "../components/icons";
import { api } from "../lib/api";

const PLATFORMS = ["instagram", "facebook", "youtube", "email", "gbp", "tiktok", "linkedin"];
const PLAT_SHORT: Record<string, string> = { instagram: "IG", facebook: "FB", youtube: "YT", email: "Email", gbp: "GBP", tiktok: "TikTok", linkedin: "LinkedIn" };

// per-platform CONNECT buttons — click opens the connect wizard for that social
function ConnButtons({ status, onConnect }: { status: Record<string, any>; onConnect: (p: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {PLATFORMS.map((p) => {
        const s = status?.[p] || {};
        const tone = !s.connected ? "dim" : s.missing_to_post?.length ? "warn" : "ok";
        const tip = !s.connected ? "not connected — click to connect" : s.missing_to_post?.length ? `connected, missing ${s.missing_to_post.join(", ")}` : s.handle || "connected";
        const cls = tone === "ok" ? "bg-ok/12 text-ok" : tone === "warn" ? "bg-warn/12 text-warn" : "bg-white/5 text-muted hover:text-ink";
        return (
          <button key={p} onClick={() => onConnect(p)} title={`${p}: ${tip}`} className={`chip transition-all hover:brightness-125 ${cls}`}>
            <Dot tone={tone as any} /> {PLAT_SHORT[p]}
          </button>
        );
      })}
    </div>
  );
}

export default function Clients() {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [armTarget, setArmTarget] = useState<any>(null);
  const [armOk, setArmOk] = useState(false);
  const [connect, setConnect] = useState<{ slug: string; platform: string } | null>(null);
  const nav = useNavigate();

  const load = () => api.clients().then(setData).catch((e) => setErr(String(e.message || e)));

  // ON/OFF for the whole lane. Deliberately separate from arm/disarm: arm decides whether a run
  // publishes, this decides whether the lane runs at all. Onboarding or pausing a client is now a
  // click here instead of a code edit to LANE_TASKS.
  // reuses the component's existing `busy` slug-lock, so the switch, "Run audit" and arm/disarm
  // can't fire concurrently on the same client
  const toggleEnabled = async (slug: string, next: boolean) => {
    setBusy(slug);
    try {
      const r: any = await api.setClientEnabled(slug, next);
      if (r && r.task_synced === false) {
        setErr(`Switched ${slug} ${next ? "on" : "off"}, but the scheduled task did not sync: ${r.task_error || "unknown"}`);
      }
      await load();
    } catch (e: any) {
      setErr(String(e.message || e));
    } finally {
      setBusy(null);
    }
  };
  useEffect(() => { load(); }, []);

  async function runAudit(slug: string) {
    setBusy(slug);
    try {
      const r = await api.startAudit({ slug, max_draft: 3 });
      nav(`/audit/${r.job_id}`);
    } catch (e: any) { setErr(String(e.message || e)); } finally { setBusy(null); }
  }

  async function doArm() {
    if (!armTarget) return;
    setBusy(armTarget.slug);
    try {
      if (armTarget.armed) await api.disarm(armTarget.slug);
      else await api.arm(armTarget.slug);
      setArmTarget(null); setArmOk(false); await load();
    } catch (e: any) { setErr(String(e.message || e)); } finally { setBusy(null); }
  }

  if (err && !data) return <Page title="Clients"><Banner tone="danger"><IconAlert size={14} /> {err}</Banner></Page>;
  if (!data)
    return (
      <Page title="Clients">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-56" />)}
        </div>
      </Page>
    );

  const clients = data.clients || [];
  const connClient = connect ? clients.find((x: any) => x.slug === connect.slug) : null;

  return (
    <Page title="Clients" crumb="Run audits · connect socials · review · arm">
      {err && <Banner tone="danger"><IconAlert size={14} /> {err}</Banner>}
      {(data.bad || []).map((b: any) => (
        <Banner key={b.slug}><IconAlert size={14} /> <b className="mr-1">{b.slug}</b> failed to load: {b.error}</Banner>
      ))}

      {clients.length === 0 ? (
        <Empty icon={<IconClients size={30} />} title="No clients yet" sub="Onboard your first brand to start."
          action={<button className="btn-primary mt-2" onClick={() => nav("/onboard")}>Onboard a brand</button>} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {clients.map((c: any) => (
            <Card key={c.slug} className="flex flex-col p-4">
              {/* header — click into the client hub (audits + review/approvals + connect + arm) */}
              <button onClick={() => nav(`/clients/${c.slug}`)} className="group flex items-start justify-between gap-2 text-left">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-semibold text-ink group-hover:text-primary-light">{c.name}</span>
                    <IconChevron size={14} className="text-dim transition-transform group-hover:translate-x-0.5 group-hover:text-primary-light" />
                  </div>
                  <div className="truncate text-xs text-muted">{c.domain}</div>
                </div>
                {c.enabled === false
                  ? <Chip tone="dim">○ OFF</Chip>
                  : c.armed ? <Chip tone="ok">● {COPY.live}</Chip> : <Chip tone="dim">● {COPY.preview}</Chip>}
              </button>

              {/* On/off switch. Off = the dispatcher never fires this lane, so it costs nothing.
                  Nothing is deleted: config, cadence ledger and history are all preserved. */}
              <div className="mt-2 flex items-center justify-between rounded-lg border border-line/60 px-2.5 py-1.5">
                <span className="text-xs text-muted">
                  {c.enabled === false ? "Lane is off" : "Lane is running"}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={c.enabled !== false}
                  aria-label={`Turn ${c.name} ${c.enabled === false ? "on" : "off"}`}
                  disabled={busy === c.slug}
                  onClick={() => toggleEnabled(c.slug, c.enabled === false)}
                  className={`relative h-5 w-9 shrink-0 rounded-full p-0 transition-colors disabled:opacity-50 ${
                    c.enabled === false ? "bg-line" : "bg-primary"
                  }`}
                >
                  {/* left-0.5 is REQUIRED. Without an explicit left, an absolutely-positioned child
                      resolves to its STATIC position (18px here, since a button centers its
                      content), and the transform then adds on top of that: 18 + 18 = 36px in a
                      36px track, so the knob sat fully outside the pill. Pin left, let only the
                      transform move it: 2px off -> 18px on, knob ends at 34 of 36. */}
                  <span
                    className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                      c.enabled === false ? "translate-x-0" : "translate-x-4"
                    }`}
                  />
                </button>
              </div>

              {/* connect socials — each a button */}
              <div className="mt-3">
                <div className="label mb-1">Connect socials</div>
                <ConnButtons status={c.connect} onConnect={(p) => setConnect({ slug: c.slug, platform: p })} />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {(c.magnets || []).filter((m: any) => m.enabled).map((m: any) => <Chip key={m.keyword} tone="primary">{m.keyword}</Chip>)}
                <Chip tone="dim">{c.auto?.length || 0} auto</Chip>
                <Chip tone="dim">{c.draft?.length || 0} draft</Chip>
                {c.recurring && <Chip tone="dim">{c.cadence?.blog_posts ? `${c.cadence.blog_posts.count}/${c.cadence.blog_posts.per}` : "recurring"}</Chip>}
              </div>

              <div className="mt-4 flex items-center gap-2 border-t border-line pt-3">
                <button className="btn-primary flex-1" disabled={busy === c.slug} onClick={() => runAudit(c.slug)}>
                  <IconPlay size={15} /> {busy === c.slug ? "Starting…" : "Run audit"}
                </button>
                <button className="btn-ghost" title="Open client — audits, reports & approvals" onClick={() => nav(`/clients/${c.slug}`)}>
                  Audits
                </button>
                <button className={c.armed ? "btn-ghost !text-warn" : "btn-ghost"} title={c.armed ? COPY.pausePublishing : COPY.goLive} onClick={() => { setArmTarget(c); setArmOk(false); }}>
                  <IconShield size={15} />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* connect wizard */}
      {connect && (
        <ConnectModal slug={connect.slug} platform={connect.platform} status={connClient?.connect}
          onClose={() => setConnect(null)} onSaved={load} />
      )}

      {/* arm / disarm confirm */}
      <Modal open={!!armTarget} onClose={() => setArmTarget(null)} title={armTarget?.armed ? `Pause publishing for ${armTarget?.name}?` : `Take ${armTarget?.name} live?`}>
        {armTarget && (armTarget.armed ? (
          <div className="space-y-4 text-sm text-muted">
            <p>This returns <b className="text-ink">{armTarget.name}</b> to <b className="text-ink">preview mode</b>. Automatic posting and replies stop immediately, and nothing goes live. Work still gets produced.</p>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setArmTarget(null)}>Cancel</button>
              <button className="btn-primary" disabled={busy === armTarget.slug} onClick={doArm}>{COPY.pausePublishing}</button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            <p className="text-muted">{COPY.goLiveExplain} Once live:</p>
            <div className="space-y-2">
              <div className="rounded-xl border border-warn/25 bg-warn/5 p-3">
                <div className="label mb-1 !text-warn">Auto-posts to owned channels</div>
                <div className="text-xs text-ink">{(armTarget.auto || []).join(", ") || "none"}</div>
              </div>
              <div className="rounded-xl border border-line bg-surface/50 p-3">
                <div className="label mb-1">Stays manual (never auto-posted)</div>
                <div className="text-xs text-muted">{(armTarget.draft || []).join(", ") || "none"} — the community guardrail holds</div>
              </div>
              <div className="text-xs text-muted">DM / email auto-replies: <b className="text-ink">{armTarget.responder?.enabled ? "ON" : "off"}</b> ({armTarget.responder?.model || "—"}) · blog schedule: {armTarget.cadence?.blog_posts ? `${armTarget.cadence.blog_posts.count}/${armTarget.cadence.blog_posts.per}` : "—"}</div>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted">
              <input type="checkbox" checked={armOk} onChange={(e) => setArmOk(e.target.checked)} className="accent-primary" />
              I understand these post to live accounts.
            </label>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setArmTarget(null)}>Cancel</button>
              <button className="btn-danger" disabled={!armOk || busy === armTarget.slug} onClick={doArm}>Take {armTarget.name} live</button>
            </div>
          </div>
        ))}
      </Modal>
    </Page>
  );
}
