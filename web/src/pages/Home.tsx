import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card, Chip, Skeleton } from "../components/ui";
import { Sparkline, PALETTE } from "../components/Charts";
import { IconShield, IconChevron } from "../components/icons";
import { api } from "../lib/api";
import { num, pct } from "../lib/format";

/** The product front door (BLG anatomy, cockpit data): outcome hero -> proof band ->
 *  how-it-works -> per-client wins -> the three locks as the trust story. Every number on
 *  this page is real engine data; nothing is a mockup. */

const STEPS = [
  {
    n: "01",
    title: "Measure",
    body: "We ask ChatGPT, Perplexity and Gemini your buyers' real questions and record exactly who gets cited, question by question.",
  },
  {
    n: "02",
    title: "Write",
    body: "The engine drafts the fact-dense pages and videos that win those citations, in your voice, with a human approval gate.",
  },
  {
    n: "03",
    title: "Publish, locked",
    body: "Nothing goes out until the channel, account and brand locks all pass. New clients start in preview mode and publish nothing.",
  },
];

const LOCKS = [
  {
    title: "Channel lock",
    body: "A video can only land on the exact YouTube channel configured for that brand. Wrong channel, no upload.",
  },
  {
    title: "Account lock",
    body: "Every social token is verified against the account it claims to be before each post. Mismatch, no post.",
  },
  {
    title: "Preview by default",
    body: "Until you flip a brand live, every run produces drafts and plans only. Going live is an explicit, confirmed step.",
  },
];

export default function Home() {
  const [d, setD] = useState<any>(null);
  const nav = useNavigate();

  useEffect(() => {
    api.dashboard().then(setD).catch(() => setD({ clients: [], company: {} }));
  }, []);

  const clients = d?.clients || [];
  const c = d?.company || {};
  const totalAudits = clients.reduce((a: number, x: any) => a + (x.kpis?.audits_run || 0), 0);
  const citedLatest = clients.reduce((a: number, x: any) => {
    const s = x.geo?.cited;
    return a + (Array.isArray(s) && s.length ? Number(s[s.length - 1]?.v ?? s[s.length - 1]) || 0 : 0);
  }, 0);

  return (
    <div className="relative">
      {/* ============================ HERO ============================ */}
      <section className="hero-grid relative px-6 pb-14 pt-16 md:pt-24">
        <div className="mx-auto max-w-4xl text-center">
          <div className="label mb-5 text-primary-light">The citation engine</div>
          <h1 className="display mx-auto max-w-[24ch] text-balance">
            Get your brands <span className="text-primary-light">cited</span> by ChatGPT, Perplexity
            and Google. On autopilot.
          </h1>
          <p className="mx-auto mt-5 max-w-[52ch] text-base leading-relaxed text-muted">
            The engine measures where AI answers mention each brand, writes what wins the citation,
            and never publishes without a lock check.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link to="/dashboard" className="btn-primary px-6 py-2.5 text-base">
              Open the Action Center
            </Link>
            <Link to="/clients" className="btn-ghost px-6 py-2.5 text-base">
              Run an audit
            </Link>
          </div>
          <div className="mt-5 flex items-center justify-center gap-2 text-xs text-muted">
            <IconShield size={14} className="text-ok" />
            Runs locally. Your data and your tokens never leave this machine.
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl space-y-16 px-6 pb-20">
        {/* ============================ PROOF BAND ============================ */}
        <section aria-label="Live numbers">
          {!d ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-24" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {[
                { label: "Brands live", value: num(clients.length) },
                { label: "AI citations held", value: num(citedLatest) },
                { label: "Audits run", value: num(totalAudits) },
                { label: "Site uptime", value: c.uptime == null ? "—" : pct(c.uptime) },
              ].map((s) => (
                <Card key={s.label} className="p-4 text-center">
                  <div className="stat-num text-3xl font-bold text-ink">{s.value}</div>
                  <div className="label mt-1">{s.label}</div>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* ============================ HOW IT WORKS ============================ */}
        <section aria-label="How it works">
          <div className="label mb-2 text-primary-light">How it works</div>
          <h2 className="mb-6 text-2xl font-bold text-ink">Citations, not vibes</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {STEPS.map((s) => (
              <Card key={s.n} className="p-5">
                <div className="stat-num text-sm font-bold text-primary-light">{s.n}</div>
                <div className="mt-2 font-semibold text-ink">{s.title}</div>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{s.body}</p>
              </Card>
            ))}
          </div>
        </section>

        {/* ============================ PER-CLIENT WINS ============================ */}
        {clients.length > 0 && (
          <section aria-label="Brand results">
            <div className="label mb-2 text-primary-light">The results</div>
            <h2 className="mb-6 text-2xl font-bold text-ink">Every brand, measured weekly</h2>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {clients.map((cl: any) => (
                <button
                  key={cl.slug}
                  onClick={() => nav(`/clients/${cl.slug}`)}
                  className="card card-hover group p-4 text-left"
                >
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-ink">{cl.name}</div>
                    <IconChevron
                      size={16}
                      className="text-dim transition-transform group-hover:translate-x-0.5"
                    />
                  </div>
                  <div className="mt-3">
                    <div className="label">Citation share</div>
                    <div className="stat-num text-3xl font-bold text-primary-light">
                      {cl.geo?.share_latest == null ? "—" : pct(cl.geo.share_latest)}
                    </div>
                  </div>
                  <div className="mt-2 -mx-1">
                    <Sparkline data={cl.geo?.cited || []} color={PALETTE.primary} />
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-[11px] text-muted">
                    <Chip tone="dim">{cl.kpis?.audits_run || 0} audits</Chip>
                    {cl.youtube?.subs_latest != null && (
                      <Chip tone="dim">{num(cl.youtube.subs_latest)} subs</Chip>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* ============================ TRUST BAND ============================ */}
        <section aria-label="Safety locks">
          <div className="label mb-2 text-primary-light">Why nothing can go wrong-channel</div>
          <h2 className="mb-6 text-2xl font-bold text-ink">
            Three locks stand between a draft and the internet
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            {LOCKS.map((l) => (
              <Card key={l.title} className="p-5">
                <IconShield size={18} className="text-ok" />
                <div className="mt-2.5 font-semibold text-ink">{l.title}</div>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{l.body}</p>
              </Card>
            ))}
          </div>
          <p className="mt-4 text-xs text-dim">
            The locks are enforced in code at the moment of posting, not by prompt. A revoked or
            swapped credential fails closed and pages you, instead of publishing to the wrong place.
          </p>
        </section>
      </div>
    </div>
  );
}
