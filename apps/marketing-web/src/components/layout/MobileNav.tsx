"use client";

import { Menu, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { headerCtas, primaryNav } from "@/content/navigation";
import { Button } from "@/components/ui/Button";

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    toggleRef.current?.focus();
  }, []);

  // Esc closes, Tab is trapped in the dialog, body scroll is locked while open.
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  // Close if the viewport grows past the mobile breakpoint.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => {
      if (mq.matches) setOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return (
    <div className="lg:hidden">
      <button
        ref={toggleRef}
        type="button"
        aria-expanded={open}
        aria-controls="mobile-nav-dialog"
        aria-label="Open menu"
        onClick={() => setOpen(true)}
        className="inline-flex size-10 items-center justify-center rounded-lg text-white hover:bg-white/10"
      >
        <Menu aria-hidden="true" className="size-6" />
      </button>
      {open ? (
        <div
          id="mobile-nav-dialog"
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Site menu"
          className="fixed inset-0 z-[60] flex flex-col bg-ink-950 px-4 pb-8 pt-3 text-white"
        >
          <div className="flex h-12 items-center justify-end">
            <button
              type="button"
              aria-label="Close menu"
              onClick={close}
              className="inline-flex size-10 items-center justify-center rounded-lg hover:bg-white/10"
            >
              <X aria-hidden="true" className="size-6" />
            </button>
          </div>
          <nav aria-label="Mobile" className="mt-4 flex-1 overflow-y-auto">
            <ul className="flex flex-col">
              {primaryNav.map((l) => (
                <li key={l.href}>
                  <a
                    href={l.href}
                    onClick={() => setOpen(false)}
                    className="block border-b border-white/10 py-4 text-lg font-medium"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="mt-6 flex flex-col gap-3">
            <Button href={headerCtas.login.href} variant="secondary" tone="dark" fullWidth>
              {headerCtas.login.label}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
