import { IconBolt } from "./icons";

// Laptop battery (read server-side via psutil, so it's the LAPTOP's charge even when viewed remotely).
export function BatteryMeter({ percent, plugged, secsLeft }: {
  percent?: number; plugged?: boolean; secsLeft?: number | null;
}) {
  const p = percent == null ? null : Math.max(0, Math.min(100, percent));
  const color = p == null ? "rgb(var(--text-dim))" : p <= 15 ? "rgb(var(--danger))" : p <= 35 ? "rgb(var(--warn))" : "rgb(var(--ok))";
  const fillW = p == null ? 0 : (p / 100) * 20;
  const eta =
    secsLeft && secsLeft > 0 ? `${Math.floor(secsLeft / 3600)}h ${Math.floor((secsLeft % 3600) / 60)}m left` : plugged ? "charging" : "";

  return (
    <div className="flex items-center gap-2 rounded-xl border border-line bg-surface/60 px-2.5 py-1.5" title={eta || "laptop battery"}>
      <div className="relative">
        <svg width="30" height="16" viewBox="0 0 30 16">
          <rect x="1" y="1.5" width="24" height="13" rx="3" fill="none" stroke="rgb(var(--line))" strokeWidth="1.5" />
          <rect x="26.5" y="5" width="2.5" height="6" rx="1.2" fill="rgb(var(--line))" />
          <rect x="3" y="3.5" width={fillW} height="9" rx="1.5" fill={color} />
        </svg>
        {plugged && (
          <span className="absolute -right-0.5 -top-1 text-primary-light">
            <IconBolt size={11} />
          </span>
        )}
      </div>
      <span className="mono text-xs font-semibold" style={{ color }}>
        {p == null ? "—" : `${p}%`}
      </span>
    </div>
  );
}
