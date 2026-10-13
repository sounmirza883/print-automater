"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useSession } from "@/components/session-provider";
import { Icon } from "@/components/shell/icons";
import { Kbd } from "@/components/ui";
import { movePaletteIndex, paletteEntries, type PaletteEntry } from "@/lib/command-palette";
import { visibleNavItems, type NavItem } from "@/lib/nav";

/** "Search or jump to": one button in the top bar (a search-shaped bar on a
 * desktop, an icon on a phone) and Ctrl/Cmd+K anywhere. It lists the screens
 * this person may open and, for roles that can see orders, an orders search.
 * It never lists anything `visibleNavItems` would not. */
export function CommandPalette(): ReactNode {
  const { user, businessRole, permissions } = useSession();
  const [open, setOpen] = useState(false);
  const items = useMemo(
    () => visibleNavItems({ userRole: user.role, businessRole, permissions }),
    [user.role, businessRole, permissions],
  );

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        // Not over an open dialog: Enter in the palette would navigate away from
        // whatever that dialog was in the middle of.
        if (document.querySelector("dialog[open]") !== null) {
          return;
        }
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="flex min-h-9 items-center gap-2.5 rounded-md border border-line bg-panel text-muted hover:border-line-strong max-lg:size-11 max-lg:justify-center lg:w-full lg:max-w-[26rem] lg:px-2.5"
      >
        <Icon name="search" className="size-4 shrink-0 max-lg:size-5" />
        <span className="flex-1 text-left text-sm max-lg:sr-only">Search or jump to…</span>
        <span className="max-lg:hidden">
          <Kbd>Ctrl K</Kbd>
        </span>
      </button>
      {open && (
        <PaletteDialog
          items={items}
          canSearchOrders={items.some((item) => item.id === "orders")}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function PaletteDialog({
  items,
  canSearchOrders,
  onClose,
}: {
  items: readonly NavItem[];
  canSearchOrders: boolean;
  onClose: () => void;
}): ReactNode {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const entries = paletteEntries(query, items, canSearchOrders);
  const active = Math.min(index, Math.max(0, entries.length - 1));
  // A local, because the project's noUncheckedIndexedAccess types every
  // indexed read as possibly undefined and does not narrow `entries[active]`.
  const activeEntry = entries[active];

  useEffect(() => {
    const dialog = ref.current;
    if (dialog !== null && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  function go(entry: PaletteEntry | undefined): void {
    if (entry === undefined) {
      return;
    }
    onClose();
    router.push(entry.href);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (entries.length > 0) {
        const next = movePaletteIndex(active, entries.length, event.key === "ArrowDown" ? 1 : -1);
        setIndex(next);
        // Keep the chosen option on screen when the list scrolls.
        const nextEntry = entries[next];
        if (nextEntry !== undefined) {
          document.getElementById(`palette-${nextEntry.id}`)?.scrollIntoView({ block: "nearest" });
        }
      }
    } else if (event.key === "Enter") {
      // Enter confirms an input-method candidate (IME); it is not a choice here.
      if (event.nativeEvent.isComposing) {
        return;
      }
      event.preventDefault();
      go(activeEntry);
    }
  }

  return (
    <dialog
      ref={ref}
      aria-label="Search or jump to"
      onClose={onClose}
      onClick={(event) => {
        // A click on the backdrop targets the dialog itself: its content fills its box.
        if (event.target === event.currentTarget) {
          ref.current?.close();
        }
      }}
      className="m-auto mt-[12vh] w-[36rem] max-w-[94vw] rounded-lg border border-line bg-panel p-0 text-ink shadow-2xl backdrop:bg-black/60 max-sm:mt-3"
    >
      <div className="flex items-center gap-2.5 border-b border-line px-4">
        <Icon name="search" className="size-4 shrink-0 text-muted" />
        <input
          role="combobox"
          aria-label="Search or jump to"
          aria-expanded={entries.length > 0}
          aria-controls={entries.length > 0 ? "palette-results" : undefined}
          aria-activedescendant={
            activeEntry !== undefined ? `palette-${activeEntry.id}` : undefined
          }
          autoFocus
          data-quiet-focus
          autoComplete="off"
          spellCheck={false}
          maxLength={100}
          placeholder="Search or jump to…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setIndex(0);
          }}
          onKeyDown={onKeyDown}
          className="min-h-12 min-w-0 flex-1 bg-transparent text-base placeholder:text-muted"
        />
        <span className="max-sm:hidden">
          <Kbd>Esc</Kbd>
        </span>
        <button
          type="button"
          onClick={() => ref.current?.close()}
          className="min-h-11 shrink-0 px-1 text-sm font-medium text-muted sm:hidden"
        >
          Close
        </button>
      </div>
      {entries.length === 0 ? (
        <p className="px-4 py-6 text-center text-muted">Nothing matches.</p>
      ) : (
        <ul
          id="palette-results"
          role="listbox"
          aria-label="Results"
          className="max-h-[50vh] overflow-y-auto p-1.5"
        >
          {entries.map((entry, position) => (
            <li
              key={entry.id}
              id={`palette-${entry.id}`}
              role="option"
              aria-selected={position === active}
              // Follow the pointer only when it really moves. A list that re-renders
              // under a resting pointer also fires hover events, and those must not
              // move the selection away from what the keyboard chose.
              onMouseMove={(event) => {
                if (event.movementX !== 0 || event.movementY !== 0) {
                  setIndex(position);
                }
              }}
              onClick={() => go(entry)}
              className={`cursor-pointer rounded-md px-3 py-2 ${position === active ? "bg-panel-2" : ""}`}
            >
              <p className="text-sm font-medium">{entry.label}</p>
              <p className="truncate text-xs text-muted">{entry.hint}</p>
            </li>
          ))}
        </ul>
      )}
    </dialog>
  );
}
