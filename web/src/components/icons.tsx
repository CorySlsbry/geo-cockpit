// Minimal inline icon set (stroke = currentColor) — no icon dependency.
import { ReactNode } from "react";
type P = { className?: string; size?: number };
const svg = (path: ReactNode) => ({ className = "", size = 18 }: P) =>
  (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {path}
    </svg>
  );

export const IconDashboard = svg(
  <>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </>
);
export const IconClients = svg(
  <>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
    <path d="M16 7.5a3 3 0 0 1 0 5.5M18 20a5 5 0 0 0-3-4.6" />
  </>
);
export const IconOnboard = svg(
  <>
    <circle cx="12" cy="8" r="3.4" />
    <path d="M5.5 20a6.5 6.5 0 0 1 10.2-5.3" />
    <path d="M18 15v6M15 18h6" />
  </>
);
export const IconMonitor = svg(
  <>
    <path d="M3 12h4l2 6 4-14 2 8h6" />
  </>
);
export const IconAds = svg(
  <>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="4.5" />
    <circle cx="12" cy="12" r="1" />
  </>
);
export const IconSocial = svg(<><path d="M22 3 11 12" /><path d="M22 3 15 21l-4-9-9-4 20-5Z" /></>);
export const IconMenu = svg(<><path d="M3 6h18" /><path d="M3 12h18" /><path d="M3 18h18" /></>);
export const IconBolt = svg(<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />);
export const IconPlay = svg(<path d="M7 4.5v15l12-7.5-12-7.5Z" />);
export const IconCheck = svg(<path d="m4 12 5 5L20 6" />);
export const IconCopy = svg(
  <>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h8" />
  </>
);
export const IconExternal = svg(
  <>
    <path d="M14 4h6v6M20 4l-9 9" />
    <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
  </>
);
export const IconAlert = svg(
  <>
    <path d="M12 3 2 20h20L12 3Z" />
    <path d="M12 10v4M12 17h.01" />
  </>
);
export const IconChevron = svg(<path d="m9 6 6 6-6 6" />);
export const IconRefresh = svg(
  <>
    <path d="M21 12a9 9 0 1 1-3-6.7M21 4v4h-4" />
  </>
);
export const IconClose = svg(<path d="M6 6l12 12M18 6 6 18" />);
export const IconShield = svg(
  <>
    <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z" />
    <path d="m9 12 2 2 4-4" />
  </>
);
export const IconPlug = svg(
  <>
    <path d="M9 3v6M15 3v6" />
    <path d="M7 9h10v3a5 5 0 0 1-10 0V9ZM12 17v4" />
  </>
);
export const IconResearch = svg(<><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>);
