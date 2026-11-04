import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";

const GRID = "#241f36";
const axis = { stroke: "#4a4468", fontSize: 10, tickLine: false, axisLine: false } as const;
const fmtTick = (v: any) => (typeof v === "string" ? v.slice(5) : v);

export const PALETTE = { primary: "#7C5CFF", ok: "#10B981", warn: "#F59E0B", teal: "#38BDF8", pink: "#F472B6" };

function TrendTooltip({ active, payload, label, money }: any) {
  if (!active || !payload?.length) return null;
  const v = payload[0].value;
  return (
    <div className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-xs shadow-card">
      <div className="text-dim">{label}</div>
      <div className="font-semibold text-ink">
        {money ? "$" + Number(v).toLocaleString() : Number(v).toLocaleString()}
      </div>
    </div>
  );
}

function NoData({ height }: { height: number }) {
  return (
    <div className="flex items-center justify-center text-xs text-dim" style={{ height }}>
      no data yet
    </div>
  );
}

export function AreaTrend({ data, color = PALETTE.primary, height = 180, money = false }: {
  data: { ts: string; value: number }[]; color?: string; height?: number; money?: boolean;
}) {
  if (!data?.length) return <NoData height={height} />;
  const id = "g" + color.replace("#", "");
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="ts" tickFormatter={fmtTick} minTickGap={28} {...axis} />
        <YAxis width={40} tickFormatter={(v) => (money ? "$" + v : v)} {...axis} />
        <Tooltip content={<TrendTooltip money={money} />} cursor={{ stroke: color, strokeOpacity: 0.3 }} />
        <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill={`url(#${id})`} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function LineTrend({ data, color = PALETTE.ok, height = 180 }: {
  data: { ts: string; value: number }[]; color?: string; height?: number;
}) {
  if (!data?.length) return <NoData height={height} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="ts" tickFormatter={fmtTick} minTickGap={28} {...axis} />
        <YAxis width={40} {...axis} />
        <Tooltip content={<TrendTooltip />} cursor={{ stroke: color, strokeOpacity: 0.3 }} />
        <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function Sparkline({ data, color = PALETTE.primary, height = 40 }: {
  data: { ts: string; value: number }[]; color?: string; height?: number;
}) {
  if (!data?.length) return <div style={{ height }} />;
  const id = "s" + color.replace("#", "");
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.4} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="value" stroke={color} strokeWidth={1.5} fill={`url(#${id})`} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
