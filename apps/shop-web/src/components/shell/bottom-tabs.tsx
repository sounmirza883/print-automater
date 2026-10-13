"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { Modal } from "@/components/modal";
import { useSession } from "@/components/session-provider";
import { Icon, NavIcon } from "@/components/shell/icons";
import { NavList } from "@/components/shell/nav-list";
import { activeNavItem, bottomTabs, visibleNavItems } from "@/lib/nav";

function tabLook(current: boolean): string {
  return `flex min-h-[50px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] leading-[14px] ${
    current ? "font-semibold text-ink" : "font-medium text-muted"
  }`;
}

function pillLook(current: boolean): string {
  return `grid h-7 w-[52px] place-items-center rounded-full ${current ? "bg-inv text-inv-ink" : ""}`;
}

/** The phone and tablet navigation: up to four tabs this role can open, plus
 * "More", which holds the whole grouped list. Hidden from `lg` up, where the
 * sidebar is on screen. "More" is marked current when the open screen is not
 * one of the tabs, so the bar always shows where you are. Its height is
 * published as `--bottom-nav` in `globals.css`; the two must change together. */
export function BottomTabs(): ReactNode {
  const pathname = usePathname();
  const { user, businessRole, permissions } = useSession();
  const [moreOpen, setMoreOpen] = useState(false);
  const items = useMemo(
    () => visibleNavItems({ userRole: user.role, businessRole, permissions }),
    [user.role, businessRole, permissions],
  );
  const tabs = bottomTabs(items);
  const currentId = activeNavItem(pathname, items)?.id;
  const currentIsTab = tabs.some((tab) => tab.id === currentId);

  return (
    <>
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-side-line bg-side px-1 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:hidden"
      >
        {tabs.map((tab) => {
          const current = tab.id === currentId;
          return (
            <Link
              key={tab.id}
              href={tab.href}
              aria-current={current ? "page" : undefined}
              className={tabLook(current)}
            >
              <span className={pillLook(current)}>
                <NavIcon id={tab.id} className="size-5" />
              </span>
              <span>{tab.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(true)}
          className={tabLook(currentId !== undefined && !currentIsTab)}
        >
          <span className={pillLook(currentId !== undefined && !currentIsTab)}>
            <Icon name="more" className="size-5" />
          </span>
          <span>More</span>
        </button>
      </nav>
      {moreOpen && (
        <Modal title="Menu" onClose={() => setMoreOpen(false)} dismissOnBackdrop>
          <div className="max-h-[70vh] overflow-y-auto p-3">
            <NavList onNavigate={() => setMoreOpen(false)} />
          </div>
        </Modal>
      )}
    </>
  );
}
