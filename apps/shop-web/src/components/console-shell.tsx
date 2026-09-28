"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { PlanBanner } from "@/components/plan-banner";
import { useSession } from "@/components/session-provider";
import { Button } from "@/components/ui";
import { visibleNavItems, type NavItem } from "@/lib/nav";
import { roleLabel } from "@/lib/permissions";

const NAV_ICONS: Record<string, string> = {
  dashboard: "M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z",
  orders: "M5 4h14v4H5V4Zm0 6h14v4H5v-4Zm0 6h14v4H5v-4Z",
  printers: "M7 9V4h10v5M7 17H5v-6h14v6h-2M7 14h10v6H7v-6Z",
  inventory: "M4 8l8-4 8 4v8l-8 4-8-4V8Zm0 0 8 4m0 0 8-4m-8 4v8",
  suppliers:
    "M3 7h11v9H3V7Zm11 3h4l3 3v3h-7v-6ZM7 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm11 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z",
  "purchase-orders": "M6 3h9l4 4v14H6V3Zm8 0v5h5M9 12h7M9 16h7",
  products: "M4 4h7l9 9-7 7-9-9V4Zm4 4h.01",
  customers:
    "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9c0-3.3 2.7-6 6-6s6 2.7 6 6M17 6a3 3 0 0 1 0 6m1 2c2 .6 3 2.4 3 5",
  staff: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-8 8c0-4.4 3.6-8 8-8s8 3.6 8 8",
  reports: "M5 20V10m5 10V4m5 16v-7m5 7H3",
  settings: "M4 6h10m4 0h2M4 12h4m4 0h8M4 18h12m4 0h0M14 4v4M8 10v4m8 2v4",
  notifications: "M6 9a6 6 0 1 1 12 0c0 5 2 6.500 2 6.500H4S6 14 6 9Zm4 10a2 2 0 0 0 4 0",
  admin: "M12 3l8 3v6c0 5-3.400 8-8 9-4.600-1-8-4-8-9V6l8-3Zm-3 9 2 2 4-4",
};

function NavIcon({ id }: { id: string }): ReactNode {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-[18px] shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={NAV_ICONS[id] ?? NAV_ICONS.dashboard} />
    </svg>
  );
}

function NavList({
  items,
  pathname,
  onNavigate,
}: {
  items: NavItem[];
  pathname: string;
  onNavigate?: () => void;
}): ReactNode {
  return (
    <nav aria-label="Main">
      <ul className="grid gap-0.5">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.id}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={`relative flex items-center gap-3 rounded-md px-3 py-2 text-sm ${
                  active
                    ? "bg-white/10 font-semibold text-white"
                    : "text-side-ink hover:bg-white/5 hover:text-white"
                }`}
              >
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-accent"
                  />
                )}
                <NavIcon id={item.id} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function BusinessSwitcher(): ReactNode {
  const { memberships, business, selectBusiness } = useSession();
  if (memberships.length === 0) {
    return null;
  }
  if (memberships.length === 1 && business !== null) {
    return (
      <div className="min-w-0 truncate rounded-md border border-line bg-panel px-3 py-1.5 text-sm font-medium">
        {business.name}
      </div>
    );
  }
  return (
    <label className="flex min-w-0 items-center gap-2 text-sm">
      <span className="sr-only sm:not-sr-only sm:text-muted">Business</span>
      <select
        value={business?.id ?? ""}
        onChange={(event) => selectBusiness(event.target.value)}
        className="min-w-0 max-w-[16rem] rounded-md border border-line bg-panel px-2 py-1.5 font-medium"
      >
        {memberships.map((membership) => (
          <option key={membership.id} value={membership.id}>
            {membership.name} ({roleLabel(membership.role)})
          </option>
        ))}
      </select>
    </label>
  );
}

function UserMenu(): ReactNode {
  const router = useRouter();
  const { user, businessRole } = useSession();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut(): Promise<void> {
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <div className="flex items-center gap-3">
      <div className="hidden text-right leading-tight sm:block">
        <p className="text-sm font-medium">{user.name}</p>
        <p className="text-xs text-muted">{roleLabel(businessRole ?? user.role)}</p>
      </div>
      <Button onClick={() => void signOut()} disabled={signingOut}>
        {signingOut ? "Signing out…" : "Sign out"}
      </Button>
    </div>
  );
}

/** The permission-aware frame around every signed-in screen: a dark rail
 * (a slide-over drawer below `lg`), and a top bar with the business
 * switcher and the person's menu. What the rail lists is a pure function
 * of the person's role AT THE SELECTED BUSINESS (`lib/nav.ts`); the API
 * remains the real gate. */
export function ConsoleShell({
  children,
  topBarExtras,
}: {
  children: ReactNode;
  /** Extra controls in the top bar (the notification bell, from 23.7). */
  topBarExtras?: ReactNode;
}): ReactNode {
  const pathname = usePathname();
  const { user, businessRole, permissions } = useSession();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const items = useMemo(
    () => visibleNavItems({ userRole: user.role, businessRole, permissions }),
    [user.role, businessRole, permissions],
  );

  useEffect(() => {
    if (!drawerOpen) {
      return;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setDrawerOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const brand = (
    <Link href="/" className="flex items-center gap-2.5 px-3 py-4 text-white">
      <span className="grid size-8 place-items-center rounded-md bg-accent text-sm font-bold">
        PA
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold tracking-tight">Print Automated</span>
        <span className="block text-[11px] tracking-widest text-side-ink uppercase">Business</span>
      </span>
    </Link>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-panel focus:px-3 focus:py-2"
      >
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-screen flex-col overflow-y-auto border-r border-side-line bg-side lg:flex">
        {brand}
        <div className="px-2 pb-4">
          <NavList items={items} pathname={pathname} />
        </div>
      </aside>

      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
        >
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/50"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="relative flex h-full w-64 max-w-[85vw] flex-col overflow-y-auto bg-side">
            {brand}
            <div className="px-2 pb-4">
              <NavList items={items} pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
            </div>
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-col">
        <div className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-panel/95 px-4 py-2 backdrop-blur sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              aria-label="Open menu"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
              className="grid size-9 place-items-center rounded-md border border-line lg:hidden"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="size-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              >
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
            <BusinessSwitcher />
          </div>
          <div className="flex items-center gap-3">
            {topBarExtras}
            <UserMenu />
          </div>
        </div>
        <PlanBanner />
        <main id="main" className="mx-auto w-full max-w-[90rem] flex-1 px-4 py-5 sm:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}
