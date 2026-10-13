"use client";

import Link from "next/link";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** A button that opens a small popover (business switcher, account menu). The
 * popover is a `role="dialog"`, not an ARIA menu, because it may hold mixed
 * content (details, a toggle group, links) and so has no arrow-key navigation:
 * Tab moves through it. Opening moves focus to its first focusable element.
 * Choosing an item (the `close` handed to `children`) and Escape close it and
 * return focus to the button that opened it. A pointer press outside, or focus
 * moving to something outside, close it without moving focus. */
export function Menu({
  label,
  trigger,
  children,
  align = "start",
  side = "bottom",
  className = "",
}: {
  /** Names the popover for assistive tech. */
  label: string;
  /** Renders the opening button; spread `props` onto it. */
  trigger: (props: {
    onClick: (event: ReactMouseEvent<HTMLElement>) => void;
    "aria-expanded": boolean;
    "aria-haspopup": "dialog";
    "aria-controls": string;
  }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "start" | "end";
  side?: "bottom" | "top";
  className?: string;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  // The element focus returns to on a deliberate close: whichever button opened it. Held in
  // state rather than a ref because the render-prop callbacks below read and write it.
  const [opener, setOpener] = useState<HTMLElement | null>(null);

  function closeAndRestoreFocus(): void {
    setOpen(false);
    opener?.focus();
  }

  useEffect(() => {
    if (!open) {
      return;
    }
    popover.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onPointer = (event: PointerEvent): void => {
      if (root.current !== null && !root.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (open && event.key === "Escape") {
      closeAndRestoreFocus();
    }
  }

  function onBlur(event: FocusEvent<HTMLDivElement>): void {
    const next = event.relatedTarget;
    // A null relatedTarget (a click on nothing focusable) is the pointer listener's job.
    if (next instanceof Node && root.current !== null && !root.current.contains(next)) {
      setOpen(false);
    }
  }

  return (
    <div ref={root} onKeyDown={onKeyDown} onBlur={onBlur} className={`relative ${className}`}>
      {trigger({
        onClick: (event) => {
          setOpener(event.currentTarget);
          setOpen((value) => !value);
        },
        "aria-expanded": open,
        "aria-haspopup": "dialog",
        "aria-controls": id,
      })}
      {open && (
        <div
          ref={popover}
          id={id}
          role="dialog"
          aria-label={label}
          tabIndex={-1}
          className={`absolute z-40 max-h-[min(70vh,28rem)] min-w-60 overflow-y-auto rounded-lg border border-line bg-panel p-1 shadow-xl ${
            side === "bottom" ? "top-full mt-1.5" : "bottom-full mb-1.5"
          } ${align === "start" ? "left-0" : "right-0"}`}
        >
          {children(closeAndRestoreFocus)}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  onSelect,
  href,
  children,
  tone = "default",
}: {
  onSelect?: () => void;
  href?: string;
  children: ReactNode;
  tone?: "default" | "danger";
}): ReactNode {
  const look = `flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-panel-2 max-sm:min-h-11 ${
    tone === "danger" ? "text-danger-fg" : "text-ink"
  }`;
  return href !== undefined ? (
    <Link href={href} onClick={onSelect} className={look}>
      {children}
    </Link>
  ) : (
    <button type="button" onClick={onSelect} className={look}>
      {children}
    </button>
  );
}
