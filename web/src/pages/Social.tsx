import { useEffect, useState } from "react";
import { Page } from "../components/Page";
import { Card, Section, Banner, Chip, Skeleton, Spinner, Empty } from "../components/ui";
import { IconAlert, IconCheck, IconExternal } from "../components/icons";
import { api } from "../lib/api";
import { titleCase } from "../lib/format";

/** Social — post to any brand's accounts on the fly, decoupled from the GEO flywheel. */

type Lock = { ok: boolean; matched_on: string | null; reason: string | null } | null;
type Net = { network: string; handle: string; status: string; has_token: boolean; needs_media: boolean; lock?: Lock };
type LaneAcc = { lane: string; name: string; cadence: any; networks: Net[] };

export default function Social() {
  const [accounts, setAccounts] = useState<LaneAcc[] | null>(null);
  const [recent, setRecent] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [lane, setLane] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [link, setLink] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [override, setOverride] = useState(false);
  const [busy, setBusy] = useState<"" | "preview" | "post">("");
  const [result, setResult] = useState<any>(null);

  const load = () =>
    Promise.all([api.socialAccounts(), api.socialRecent()])
      .then(([a, r]) => {
        setAccounts(a.lanes);
        setRecent(r.posts);
        if (!lane && a.lanes.length) setLane(a.lanes[0].lane);
      })
      .catch((e) => setErr(String(e.message || e)));
  useEffect(() => { load(); }, []);

  const cur = (accounts || []).find((l) => l.lane === lane);
  // A connected network is only postable if its token also passes the account-lock (the token is
  // FOR the account lanes.json expects). A mismatch is excluded so it can never be posted to.
  const postable = (cur?.networks || []).filter(
    (n) => n.has_token && n.status !== "disabled" && !(n.lock && !n.lock.ok));
  const targets = picked.length ? postable.filter((n) => picked.includes(n.network)) : postable;
  const mediaNeeded = targets.some((n) => n.needs_media) && !mediaUrl;

  function toggle(net: string) {
    setPicked((p) => (p.includes(net) ? p.filter((x) => x !== net) : [...p, net]));
  }

  async function send(dry: boolean) {
    setBusy(dry ? "preview" : "post");
    setResult(null);
    try {
      const r = await api.socialPost({
        lane, text, link, media_url: mediaUrl,
        platforms: picked, dry_run: dry, ignore_cadence: override,
      });
      setResult({ ...r, was_dry: dry });
      if (!dry) { setText(""); setLink(""); setMediaUrl(""); setPicked([]); setOverride(false); load(); }
    } catch (e: any) {
      setResult({ error: String(e.message || e), was_dry: dry });
    } finally {
      setBusy("");
    }
  }

  if (err && !accounts) return <Page title="Social"><Banner tone="danger"><IconAlert size={14} /> {err}</Banner></Page>;
  if (!accounts) return <Page title="Social"><Skeleton className="h-24" /><Skeleton className="h-64" /></Page>;

  return (
    <Page title="Social" crumb="post on the fly — separate from the GEO flywheel">
      {err && <Banner tone="danger"><IconAlert size={14} /> {err}</Banner>}

      <Section title="Compose" sub="Announcements, promos, anything — posts natively with each brand's own tokens">
        <Card className="p-5">
          {/* brand picker */}
          <div className="mb-4 flex flex-wrap gap-2">
            {accounts.map((l) => (
              <button key={l.lane}
                className={l.lane === lane ? "btn-primary !px-3.5 !py-2 text-sm" : "btn-ghost !px-3.5 !py-2 text-sm"}
                onClick={() => { setLane(l.lane); setPicked([]); setResult(null); }}>
                {l.name}
              </button>
            ))}
          </div>

          {/* platform toggles */}
          <div className="label mb-1.5">Platforms <span className="text-dim">(none selected = all connected)</span></div>
          <div className="mb-4 flex flex-wrap gap-1.5">
            {(cur?.networks || []).map((n) => {
              const on = picked.includes(n.network);
              const mismatch = !!(n.lock && !n.lock.ok);
              const usable = n.has_token && n.status !== "disabled" && !mismatch;
              const title = !n.has_token ? "no token — connect it on the client page"
                : mismatch ? `account-lock BLOCKED: ${n.lock?.reason || "wrong account"}`
                : n.needs_media ? "needs a media URL (video)" : n.handle;
              return (
                <button key={n.network} disabled={!usable}
                  aria-pressed={on}
                  title={title}
                  onClick={() => toggle(n.network)}
                  className={`rounded-full border px-3 py-1.5 text-xs transition
                    ${mismatch ? "cursor-not-allowed border-danger/60 text-danger opacity-80"
                      : !usable ? "cursor-not-allowed border-line text-dim opacity-50"
                      : on ? "border-primary bg-primary/20 text-ink"
                      : "border-line bg-surface/50 text-muted hover:border-primary/50"}`}>
                  {titleCase(n.network)}{n.needs_media ? " 🎬" : ""}{" "}
                  {n.has_token && (mismatch ? "⚠️" : n.lock?.ok ? "🔒" : "")}{" "}
                  <span className="text-dim">{n.handle}</span>
                </button>
              );
            })}
            {!postable.length && <span className="text-xs text-warn">no connected platforms on this brand</span>}
          </div>

          <div className="grid gap-3">
            <div>
              <label className="label mb-1 block" htmlFor="sp-text">Post text</label>
              <textarea id="sp-text" rows={4} className="input !h-auto w-full" placeholder="What do you want to say?"
                value={text} onChange={(e) => setText(e.target.value)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label mb-1 block" htmlFor="sp-link">Link <span className="text-dim">(optional)</span></label>
                <input id="sp-link" className="input mono w-full" placeholder="https://…" value={link} onChange={(e) => setLink(e.target.value)} />
              </div>
              <div>
                <label className="label mb-1 block" htmlFor="sp-media">Media URL <span className="text-dim">(public https mp4 — required for IG/TikTok)</span></label>
                <input id="sp-media" className="input mono w-full" placeholder="https://storage.googleapis.com/…" value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} />
              </div>
            </div>
          </div>

          {/* cadence + override */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              {cur?.cadence?.governed && (
                <Chip tone={cur.cadence.remaining > 0 ? "ok" : "warn"}>
                  cadence: {cur.cadence.used}/{cur.cadence.limit} used this {cur.cadence.per}
                </Chip>
              )}
              <label className="flex items-center gap-1.5">
                <input type="checkbox" className="accent-primary" checked={override} onChange={(e) => setOverride(e.target.checked)} />
                override the cadence cap for this post
              </label>
            </div>
            <div className="flex items-center gap-2">
              <button className="btn-ghost" disabled={!text.trim() || !!busy} onClick={() => send(true)}>
                {busy === "preview" ? <Spinner size={13} /> : null} Preview (dry run)
              </button>
              <button className="btn-primary" disabled={!text.trim() || !!busy || mediaNeeded}
                title={mediaNeeded ? "a selected platform needs a media URL" : "posts to the live accounts"}
                onClick={() => send(false)}>
                {busy === "post" ? <Spinner size={13} /> : null} Post now
              </button>
            </div>
          </div>
          {mediaNeeded && <p className="mt-2 text-xs text-warn">IG/TikTok are in the target set but there's no media URL — add one or deselect them.</p>}

          {/* result */}
          {result && (
            <div className="mt-4 rounded-xl border border-line bg-surface/60 p-3.5 text-xs" role="status" aria-live="polite">
              {result.error ? (
                <span className="text-danger"><IconAlert size={12} /> {result.error}</span>
              ) : result.exit_code === 3 ? (
                <span className="text-warn">Cadence cap reached — nothing posted. Tick the override to post anyway, or raise the dial on the client page.</span>
              ) : (
                <div className="grid gap-1.5">
                  <div className="text-muted">{result.was_dry ? "DRY RUN — would post to:" : "Posted:"}</div>
                  {(result.was_dry ? result.plan : result.posted)?.map((p: any, i: number) => (
                    <div key={i} className="flex items-center gap-2">
                      <IconCheck size={12} /> <b className="text-ink">{titleCase(p.network)}</b> {p.handle}
                      {p.url && <a className="text-primary-light hover:underline" href={p.url} target="_blank" rel="noreferrer">view <IconExternal size={10} /></a>}
                    </div>
                  ))}
                  {(result.skipped || []).map((s: any, i: number) => (
                    <div key={i} className="text-dim">skipped {titleCase(s.network)}: {s.reason || s.error || "error"}</div>
                  ))}
                  {!result.was_dry && !(result.posted || []).length && !(result.skipped || []).length && (
                    <span className="text-dim">{result.note || "nothing to post"}</span>
                  )}
                </div>
              )}
            </div>
          )}
        </Card>
      </Section>

      <Section title="Recent posts" sub="Everything the poster has sent — flywheel and ad-hoc alike">
        {!recent ? <Skeleton className="h-32" /> : !recent.length ? <Empty text="no posts logged yet" /> : (
          <div className="grid gap-2">
            {recent.map((p: any, i: number) => (
              <Card key={i} className="flex flex-wrap items-center gap-2 p-3 text-xs">
                <Chip tone="primary">{p.lane}</Chip>
                {(p.posted || []).map((x: any, j: number) => <Chip key={j} tone="ok">{titleCase(x.network || "")}</Chip>)}
                {(p.skipped || []).map((x: any, j: number) => <Chip key={j} tone="dim">{titleCase(x.network || "")} ✗</Chip>)}
                {p.dry_run && <Chip tone="warn">dry run</Chip>}
              </Card>
            ))}
          </div>
        )}
      </Section>
    </Page>
  );
}
