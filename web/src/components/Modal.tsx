import { ReactNode, useEffect, useRef } from "react";
import { IconClose } from "./icons";

export function Modal({ open, onClose, title, children, width = "max-w-lg" }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; width?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const FOCUSABLE =
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), ' +
      'select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      // ⛔ TRAP TAB INSIDE THE DIALOG. Escape + focus-restore were already here, but Tab walked
      // straight out into the page behind the overlay: a keyboard user landed on controls they
      // could not see, still covered by the backdrop. aria-modal alone does not stop Tab.
      if (e.key !== "Tab" || !boxRef.current) return;
      const nodes = Array.from(
        boxRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)
      ).filter((n) => n.offsetParent !== null || n === document.activeElement);
      if (!nodes.length) {
        e.preventDefault();
        boxRef.current.focus();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || active === boxRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", h);
    // move focus into the dialog so keyboard/screen-reader users land in it
    const prev = document.activeElement as HTMLElement | null;
    boxRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", h);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div ref={boxRef} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
        className={`card animate-fade-up relative z-10 w-full ${width} p-5 outline-none`}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold text-ink">{title}</h3>
          <button onClick={onClose} aria-label="Close dialog" className="text-dim transition-colors hover:text-ink">
            <IconClose size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
