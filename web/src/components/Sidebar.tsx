import { NavLink } from "react-router-dom";
import { IconDashboard, IconClients, IconOnboard, IconMonitor, IconAds, IconSocial, IconClose, IconShield, IconBolt, IconResearch } from "./icons";
import { useSystem } from "../lib/system";
import { useSidebar } from "../lib/sidebar";

// Grouped so nine flat items read as a product: Grow = the work, Guard = the watchdogs.
const NAV: Array<
  | { group: string }
  | { to: string; label: string; Icon: any; end: boolean }
> = [
  { to: "/", label: "Home", Icon: IconShield, end: true },
  { to: "/dashboard", label: "Dashboard", Icon: IconDashboard, end: false },
  { group: "Grow" },
  { to: "/clients", label: "Clients", Icon: IconClients, end: false },
  { to: "/onboard", label: "Onboard", Icon: IconOnboard, end: false },
  { to: "/social", label: "Social", Icon: IconSocial, end: false },
  { to: "/market-gaps", label: "Market Gaps", Icon: IconBolt, end: false },
  { to: "/research", label: "Research", Icon: IconResearch, end: false },
  { to: "/ads", label: "Ads", Icon: IconAds, end: false },
  { group: "Guard" },
  { to: "/mail-audit", label: "Mail Audit", Icon: IconShield, end: false },
  { to: "/monitor", label: "Monitor", Icon: IconMonitor, end: false },
];

export function Sidebar() {
  const { sys } = useSystem();
  const { open, setOpen } = useSidebar();
  const path = sys?.claude?.prefers === "cli-subscription" ? "subscription" : sys?.claude?.prefers || "—";
  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex h-full w-[264px] max-w-[80vw] shrink-0 flex-col border-r border-line bg-surface transition-transform duration-200 ease-out md:relative md:z-10 md:w-[228px] md:max-w-none md:translate-x-0 ${
        open ? "translate-x-0 shadow-2xl" : "-translate-x-full"
      }`}
    >
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="grid h-8 w-8 place-items-center rounded-xl bg-primary/20 text-primary-light shadow-glow">
          <div className="h-3.5 w-3.5 rounded-[5px] bg-primary" />
        </div>
        <div className="leading-tight">
          <div className="text-[13px] font-bold tracking-[0.16em] text-ink">GEO</div>
          <div className="text-[10px] font-semibold tracking-[0.28em] text-primary-light">COCKPIT</div>
        </div>
        {/* close button on mobile */}
        <button
          className="ml-auto grid h-9 w-9 place-items-center rounded-lg text-dim hover:bg-white/5 hover:text-ink md:hidden"
          onClick={() => setOpen(false)}
          aria-label="Close menu"
        >
          <IconClose size={18} />
        </button>
      </div>

      <nav className="mt-2 flex flex-col gap-1 px-3">
        {NAV.map((item) => {
          if ("group" in item) {
            return (
              <div key={item.group} className="label mt-4 px-3 pb-1">
                {item.group}
              </div>
            );
          }
          const { to, label, Icon, end } = item;
          return (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              `group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all ${
                isActive
                  ? "bg-primary/15 text-ink shadow-[inset_0_0_0_1px_rgba(124,92,255,0.3)]"
                  : "text-muted hover:bg-white/5 hover:text-ink"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span className={isActive ? "text-primary-light" : "text-dim group-hover:text-muted"}>
                  <Icon size={18} />
                </span>
                {label}
              </>
            )}
          </NavLink>
          );
        })}
      </nav>

      {/* Footer carries the trust line, not the plumbing. "AI compute: subscription" and the
          role string were engine internals sitting in the demo frame; both are still on the
          Monitor page, where someone actually debugging goes looking. The DEV MODE banner
          stays: that one is a safety signal, not a status readout. */}
      <div className="mt-auto space-y-2 px-5 py-4 text-[11px]">
        <div
          className="flex items-center gap-1.5 text-dim"
          title={`${sys?.user?.email || "local owner"} · AI compute: ${path}`}
        >
          <IconShield size={12} className="shrink-0 text-ok" />
          <span>Runs locally</span>
        </div>
        {sys?.dev && (
          <div className="rounded-lg border border-warn/30 bg-warn/10 px-2 py-1 text-center text-[10px] font-semibold text-warn">
            DEV MODE (auth bypass)
          </div>
        )}
      </div>
    </aside>
  );
}
