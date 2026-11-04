import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Page } from "../components/Page";
import { Card, Section, Banner, Chip, Spinner } from "../components/ui";
import { IconAlert, IconCheck, IconOnboard, IconBolt, IconExternal } from "../components/icons";
import { api } from "../lib/api";
import { titleCase } from "../lib/format";

function ChannelCol({ title, tone, items }: { title: string; tone: "ok" | "dim"; items: any[] }) {
  return (
    <div className="rounded-xl border border-line bg-surface/40 p-3">
      <div className={"label mb-2 " + (tone === "ok" ? "!text-ok" : "")}>{title}</div>
      {items?.length ? (
        <div className="space-y-1.5">
          {items.map((c: any, i: number) => (
            <div key={i} className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium text-ink">{titleCase(c.type || c.name || "channel")}</span>
              <span className="mono truncate text-dim" title={c.handle || c.target || c.post_url || c.channel || ""}>
                {c.handle || c.target || c.channel || (c.post_url ? "linked" : "")}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-xs text-dim">none</div>
      )}
    </div>
  );
}

export default function Onboard() {
  const nav = useNavigate();
  const [domain, setDomain] = useState("");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [skipAI, setSkipAI] = useState(false);

  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function runPreview() {
    if (!domain.trim()) return;
    setBusy(true);
    setErr(null);
    setPreview(null);
    try {
      const r = await api.onboardPreview({
        domain: domain.trim(),
        name: name.trim() || undefined,
        slug: slug.trim() || undefined,
        use_llm: !skipAI,
      });
      setPreview(r);
    } catch (e: any) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!preview) return;
    setSaving(true);
    setErr(null);
    try {
      const r = await api.onboardSave({
        domain: domain.trim(),
        name: name.trim() || undefined,
        slug: slug.trim() || undefined,
        use_llm: !skipAI,
        overwrite: !!preview.exists,
      });
      nav(`/clients/${r.slug || preview.slug}`);
    } catch (e: any) {
      setErr(String(e.message || e));
      setSaving(false);
    }
  }

  const p = preview?.profile;
  const brand = p?.brand || {};

  return (
    <Page title="Onboard a brand" crumb="Domain → preview → save">
      {err && <Banner tone="danger"><IconAlert size={14} /> {err}</Banner>}

      {/* form */}
      <Card className="p-5">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="md:col-span-1">
            <label className="label mb-1 block">Domain <span className="text-danger">*</span></label>
            <input
              className="input"
              placeholder="acme.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runPreview()}
            />
          </div>
          <div>
            <label className="label mb-1 block">Brand name <span className="text-dim">(optional)</span></label>
            <input className="input" placeholder="inferred from site" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label mb-1 block">Slug <span className="text-dim">(optional)</span></label>
            <input className="input mono" placeholder="acme" value={slug} onChange={(e) => setSlug(e.target.value)} />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={skipAI} onChange={(e) => setSkipAI(e.target.checked)} className="accent-primary" />
            Skip AI inference <span className="text-dim">(use_llm=false — faster, defaults only)</span>
          </label>
          <button className="btn-primary" disabled={!domain.trim() || busy} onClick={runPreview}>
            {busy ? <><Spinner size={15} /> Reading site…</> : <><IconOnboard size={15} /> Preview</>}
          </button>
        </div>

        {busy && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-primary-light">
            <IconBolt size={13} /> Fetching the live site and inferring the brand profile{skipAI ? "" : " with Haiku"} — this can take 10–20s.
          </div>
        )}
      </Card>

      {/* preview */}
      {preview && (
        <Section
          title="Proposed profile"
          sub={preview.inferred ? "AI-inferred from the live site — review before saving" : "Built from defaults"}
          right={
            <button className="btn-primary" disabled={saving} onClick={save}>
              {saving ? <><Spinner size={15} /> Saving…</> : <><IconCheck size={15} /> Save profile</>}
            </button>
          }
        >
          {/* validation / reachability banners */}
          {(preview.errors || []).map((e: string, i: number) => (
            <Banner key={i} tone="danger"><IconAlert size={14} /> {e}</Banner>
          ))}
          {!preview.homepage_ok && (
            <Banner tone="warn"><IconAlert size={14} /> Homepage was not reachable — the profile falls back to defaults. You can still save and refine later.</Banner>
          )}
          {preview.exists && (
            <Banner tone="warn"><IconAlert size={14} /> A client with slug <b className="mx-1 mono">{preview.slug}</b> already exists — saving will overwrite it.</Banner>
          )}

          <Card className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-lg font-semibold text-ink">{brand.name || preview.slug}</h3>
                  <Chip tone="primary">{preview.slug}</Chip>
                  {preview.inferred ? <Chip tone="ok">AI-inferred</Chip> : <Chip tone="dim">defaults</Chip>}
                </div>
                <a href={`https://${brand.domain || domain}`} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted hover:text-primary-light">
                  {brand.domain || domain} <IconExternal size={11} />
                </a>
              </div>
            </div>

            {brand.voice && (
              <div className="mt-4">
                <div className="label mb-1">Voice</div>
                <p className="text-sm text-muted">{brand.voice}</p>
              </div>
            )}
            {brand.services_pitch && (
              <div className="mt-3">
                <div className="label mb-1">Pitch</div>
                <p className="text-sm text-muted">{brand.services_pitch}</p>
              </div>
            )}
            {brand.author && (
              <div className="mt-3">
                <div className="label mb-1">Author / E-E-A-T</div>
                <p className="text-sm text-ink">{brand.author.name}{brand.author.title ? ` · ${brand.author.title}` : ""}</p>
                {brand.author.eeat && <p className="mt-0.5 text-xs text-muted">{brand.author.eeat}</p>}
              </div>
            )}

            {/* buyer clusters */}
            {(p?.buyer_clusters || []).length > 0 && (
              <div className="mt-4">
                <div className="label mb-1.5">Buyer questions ({p.buyer_clusters.length})</div>
                <div className="flex flex-wrap gap-1.5">
                  {p.buyer_clusters.map((c: string, i: number) => <Chip key={i} tone="primary">{c}</Chip>)}
                </div>
              </div>
            )}

            {/* channels */}
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <ChannelCol title="Auto channels (posted for you)" tone="ok" items={p?.channels?.auto || []} />
              <ChannelCol title="Draft channels (copy-only)" tone="dim" items={p?.channels?.draft || []} />
            </div>

            {/* pages fetched */}
            {(preview.pages_fetched || []).length > 0 && (
              <div className="mt-4">
                <div className="label mb-1.5">Pages read ({preview.pages_fetched.length})</div>
                <div className="flex flex-wrap gap-1.5">
                  {preview.pages_fetched.map((u: string, i: number) => (
                    <span key={i} className="mono rounded-lg border border-line bg-surface/50 px-2 py-1 text-[11px] text-dim">{u}</span>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </Section>
      )}
    </Page>
  );
}
