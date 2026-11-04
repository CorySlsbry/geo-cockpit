import { ReactNode } from "react";

export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`card ${className}`}>{children}</div>;
}

export function Section({ title, sub, right, children }: {
  title: string; sub?: string; right?: ReactNode; children: ReactNode;
}) {
  return (
    <section className="animate-fade-up">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-wide text-ink">{title}</h2>
          {sub && <p className="text-xs text-muted">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Dot({ tone = "dim", pulse = false }: { tone?: "ok" | "warn" | "danger" | "dim" | "primary"; pulse?: boolean }) {
  const c = { ok: "bg-ok", warn: "bg-warn", danger: "bg-danger", dim: "bg-dim", primary: "bg-primary" }[tone];
  return <span className={`inline-block h-2 w-2 rounded-full ${c} ${pulse ? "animate-pulse2" : ""}`} />;
}

export function Chip({ tone = "dim", title, children }: { tone?: "ok" | "warn" | "danger" | "dim" | "primary"; title?: string; children: ReactNode }) {
  const map = {
    ok: "bg-ok/12 text-ok",
    warn: "bg-warn/12 text-warn",
    danger: "bg-danger/15 text-danger",
    dim: "bg-white/5 text-muted",
    primary: "bg-primary/15 text-primary-light",
  } as const;
  return <span className={`chip ${map[tone]}`} title={title}>{children}</span>;
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "ok" | "warn" | "danger" }) {
  const c = tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : "text-ink";
  return (
    <div className="card p-4">
      <div className="label">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${c}`}>{value}</div>
      {sub != null && <div className="mt-0.5 text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin text-primary-light">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" fill="none" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-white/5 ${className}`} />;
}

export function Empty({ icon, title, text, sub, action }: { icon?: ReactNode; title?: string; text?: string; sub?: string; action?: ReactNode }) {
  // `text` is an accepted alias for `title` — callers used it and the message silently vanished
  const heading = title || text || "Nothing here yet";
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-14 text-center">
      {icon && <div className="text-dim">{icon}</div>}
      <div className="text-sm font-medium text-ink">{heading}</div>
      {sub && <div className="max-w-sm text-xs text-muted">{sub}</div>}
      {action}
    </div>
  );
}

export function Banner({ tone = "warn", children }: { tone?: "warn" | "danger" | "primary"; children: ReactNode }) {
  const map = {
    warn: "border-warn/30 bg-warn/10 text-warn",
    danger: "border-danger/30 bg-danger/10 text-danger",
    primary: "border-primary/30 bg-primary/10 text-primary-light",
  } as const;
  return <div className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs ${map[tone]}`}>{children}</div>;
}
