export const money = (v: number | null | undefined) =>
  v == null ? "—" : "$" + Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 });

export const num = (v: number | null | undefined) =>
  v == null ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 });

export const pct = (v: number | null | undefined) => (v == null ? "—" : `${Number(v).toFixed(1)}%`);

export const shortDate = (ts?: string) => {
  if (!ts) return "—";
  const d = new Date(ts);
  return isNaN(+d) ? ts.slice(0, 10) : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

export const ago = (ts?: string) => {
  if (!ts) return "never";
  const d = new Date(ts);
  if (isNaN(+d)) return ts;
  const s = (Date.now() - +d) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

export const titleCase = (s: string) =>
  (s || "").replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }
}
