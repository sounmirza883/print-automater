"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, type ReactNode } from "react";
import { useSession } from "@/components/session-provider";
import { NavIcon } from "@/components/shell/icons";
import { activeNavItem, groupedNav, visibleNavItems } from "@/lib/nav";

/** The grouped navigation, used by the sidebar and by the phone's "More"
 * sheet. What it lists is a pure function of the person's role AT THE
 * SELECTED BUSINESS (`lib/nav.ts`); the API remains the real gate. Exactly
 * one entry is current: the longest matching path, so `/admin/businesses/1`
 * lights "Businesses" and not also the platform "Overview" at `/admin`. */
export function NavList({ onNavigate }: { onNavigate?: () => void }): ReactNode {
  const pathname = usePathname();
  const { user, businessRole, permissions } = useSession();
  const items = useMemo(
    () => visibleNavItems({ userRole: user.role, businessRole, permissions }),
    [user.role, businessRole, permissions],
  );
  const currentId = activeNavItem(pathname, items)?.id;

  return (
    <nav aria-label="Main" className="grid gap-4">
      {groupedNav(items).map((group) => (
        <div key={group.id}>
          {group.label !== null && (
            <p className="px-2.5 pb-1 text-xs font-medium text-muted">{group.label}</p>
          )}
          <ul className="grid gap-0.5">
            {group.items.map((item) => {
              const current = item.id === currentId;
              return (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={current ? "page" : undefined}
                    className={`flex min-h-9 items-center gap-2.5 rounded-md px-2.5 text-sm max-lg:min-h-11 ${
                      current
                        ? "bg-inv font-semibold text-inv-ink"
                        : "font-medium text-side-ink hover:bg-panel-2 hover:text-ink"
                    }`}
                  >
                    <NavIcon id={item.id} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
