import { Outlet } from "react-router-dom";
import { SystemProvider } from "./lib/system";
import { SidebarProvider, useSidebar } from "./lib/sidebar";
import { Sidebar } from "./components/Sidebar";

function Shell() {
  const { open, setOpen } = useSidebar();
  return (
    <div className="app-bg flex h-screen overflow-hidden">
      {/* backdrop when the drawer is open on mobile */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-[1px] md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}
      {/* Skip link: first tab stop, visually hidden until focused. Without it a keyboard user
          tabs through the whole 11-item nav on every page before reaching the content. */}
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white
          focus:not-sr-only focus:absolute focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <Sidebar />
      <main id="main" className="relative z-10 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

export default function App() {
  return (
    <SystemProvider>
      <SidebarProvider>
        <Shell />
      </SidebarProvider>
    </SystemProvider>
  );
}
