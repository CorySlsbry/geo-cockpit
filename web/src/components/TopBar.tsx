import { useSystem } from "../lib/system";
import { useSidebar } from "../lib/sidebar";
import { BatteryMeter } from "./BatteryMeter";
import { Dot } from "./ui";
import { IconMenu } from "./icons";

const CAPS: { key: string; label: string }[] = [
  { key: "perplexity", label: "PPLX" },
  { key: "openai", label: "OpenAI" },
  { key: "gemini", label: "Gemini" },
  { key: "anthropic", label: "Claude" },
];

export function TopBar({ title, crumb }: { title: string; crumb?: string }) {
  const { sys } = useSystem();
  const { setOpen } = useSidebar();
  const caps = sys?.capabilities || {};
  const claudeOk = sys?.claude_ok;

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-line bg-bg/95 px-4 py-3 sm:px-6">
      <div className="flex min-w-0 items-center gap-2.5">
        <button
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line text-muted hover:bg-white/5 hover:text-ink md:hidden"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
        >
          <IconMenu size={18} />
        </button>
        <div className="min-w-0">
          {crumb && <div className="truncate text-[11px] text-dim">{crumb}</div>}
          <h1 className="truncate text-base font-semibold text-ink sm:text-lg">{title}</h1>
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        {/* what's live */}
        <div className="hidden items-center gap-3 rounded-xl border border-line bg-surface/60 px-3 py-1.5 md:flex">
          <span className="label !text-[9px]">live</span>
          {CAPS.map((c) => (
            <span key={c.key} className="flex items-center gap-1 text-[11px] text-muted" title={c.key}>
              <Dot tone={caps[c.key] ? "ok" : "dim"} />
              {c.label}
            </span>
          ))}
        </div>
        {/* claude path */}
        <div className="hidden items-center gap-1.5 rounded-xl border border-line bg-surface/60 px-3 py-1.5 text-[11px] lg:flex">
          <Dot tone={claudeOk ? "ok" : "danger"} pulse={claudeOk} />
          <span className="text-muted">Claude</span>
          <span className="mono text-ok">{claudeOk ? "subscription" : "offline"}</span>
        </div>

        <BatteryMeter
          percent={sys?.battery?.percent}
          plugged={sys?.battery?.plugged}
          secsLeft={sys?.battery?.secs_left}
        />
      </div>
    </header>
  );
}
