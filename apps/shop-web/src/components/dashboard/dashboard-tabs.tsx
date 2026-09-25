"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Permission } from "@print-automated/types";
import { useSession } from "@/components/session-provider";

export const DASHBOARD_TABS: ReadonlyArray<{
  href: string;
  label: string;
  permission: Permission;
}> = [
  { href: "/dashboard", label: "Business", permission: Permission.VIEW_DASHBOARD },
  {
    href: "/dashboard/operator",
    label: "Production",
    permission: Permission.VIEW_OPERATOR_DASHBOARD,
  },
  { href: "/dashboard/printers", label: "Printers", permission: Permission.VIEW_PRINTER_DASHBOARD },
];

/** The dashboards a role can open, as tabs. A role with only one (an
 * operator has Production and Printers; nobody but owner/manager has
 * Business) sees only those; with a single tab the bar is omitted. */
export function DashboardTabs(): ReactNode {
  const pathname = usePathname();
  const { can } = useSession();
  const tabs = DASHBOARD_TABS.filter((tab) => can(tab.permission));
  if (tabs.length < 2) {
    return null;
  }
  return (
    <nav aria-label="Dashboards" className="mb-5 flex gap-1 border-b border-line">
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              active ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** The first dashboard this role may open, or null (counter staff have none). */
export function firstAllowedDashboard(can: (permission: Permission) => boolean): string | null {
  return DASHBOARD_TABS.find((tab) => can(tab.permission))?.href ?? null;
}
