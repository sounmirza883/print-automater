"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { PlanBanner } from "@/components/plan-banner";
import { Segmented } from "@/components/segmented";
import { useSession } from "@/components/session-provider";
import { AccountMenu } from "@/components/shell/account-menu";
import { BottomTabs } from "@/components/shell/bottom-tabs";
import { BusinessSwitcher } from "@/components/shell/business-switcher";
import { CommandPalette } from "@/components/shell/command-palette";
import { Icon } from "@/components/shell/icons";
import { NavList } from "@/components/shell/nav-list";
import { useTheme } from "@/components/theme-provider";

function Brand({ compact = false }: { compact?: boolean }): ReactNode {
  return (
    <Link href="/" className="flex min-h-9 items-center gap-2.5 px-1.5 text-ink max-lg:min-h-11">
      <span className="grid size-[30px] shrink-0 place-items-center rounded-md bg-inv text-xs font-bold text-inv-ink">
        PA
      </span>
      <span
        className={`text-[15px] font-semibold tracking-[-0.01em] ${compact ? "max-sm:sr-only" : ""}`}
      >
        Print Automated
      </span>
    </Link>
  );
}

/** The permission-aware frame around every signed-in screen.
 *
 * From `lg` up: a sidebar (brand, business switcher, grouped navigation,
 * account menu) and a top bar (search-or-jump, theme, notifications). Below
 * `lg`: the business switcher and account menu move into the top bar and
 * navigation becomes a bottom tab bar with a "More" sheet.
 *
 * Only the middle of the sidebar scrolls. The switcher and the account menu
 * open popovers, and a popover inside a scrolling box would be clipped by it. */
export function ConsoleShell({
  children,
  topBarExtras,
}: {
  children: ReactNode;
  /** Extra controls in the top bar (the notification bell, from 23.7). */
  topBarExtras?: ReactNode;
}): ReactNode {
  const { business } = useSession();
  const { resolved, setTheme } = useTheme();

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-panel focus:px-3 focus:py-2"
      >
        Skip to content
      </a>

      <aside className="sticky top-0 z-40 hidden h-screen flex-col gap-3 border-r border-side-line bg-side p-3 lg:flex">
        <Brand />
        <BusinessSwitcher />
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 py-1">
          <NavList />
        </div>
        <div className="border-t border-side-line pt-2">
          <AccountMenu placement="sidebar" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <div className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-surface/90 px-3 py-2 backdrop-blur sm:px-6 lg:gap-3">
          <div className="min-w-0 lg:hidden">
            {business !== null ? <BusinessSwitcher compact /> : <Brand compact />}
          </div>
          <div className="flex-1 lg:hidden" />
          <CommandPalette />
          <div className="flex-1 max-lg:hidden" />
          <Segmented
            value={resolved}
            onChange={setTheme}
            ariaLabel="Theme"
            className="max-lg:hidden"
            options={[
              {
                value: "light",
                label: (
                  <>
                    <Icon name="sun" /> Light
                  </>
                ),
              },
              {
                value: "dark",
                label: (
                  <>
                    <Icon name="moon" /> Dark
                  </>
                ),
              },
            ]}
          />
          {topBarExtras}
          <div className="lg:hidden">
            <AccountMenu placement="topbar" />
          </div>
        </div>
        <PlanBanner />
        <main
          id="main"
          className="mx-auto w-full max-w-[90rem] flex-1 px-4 py-6 max-lg:pb-28 sm:px-6"
        >
          {children}
        </main>
      </div>

      <BottomTabs />
    </div>
  );
}
