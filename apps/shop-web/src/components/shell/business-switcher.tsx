"use client";

import type { ReactNode } from "react";
import { Menu, MenuItem } from "@/components/menu";
import { useSession } from "@/components/session-provider";
import { Icon } from "@/components/shell/icons";
import { Avatar } from "@/components/ui";
import { roleLabel } from "@/lib/permissions";

/** Which business the console is showing. A menu only when there is a choice:
 * with one business it is a plain label, and a platform admin (no business)
 * gets nothing. `compact` is the phone top bar's version. */
export function BusinessSwitcher({ compact = false }: { compact?: boolean }): ReactNode {
  const { memberships, business, selectBusiness } = useSession();
  if (business === null) {
    return null;
  }

  const face = (
    <>
      <Avatar name={business.name} />
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm font-semibold text-ink">{business.name}</span>
        {!compact && (
          <span className="block truncate text-xs text-muted">{roleLabel(business.role)}</span>
        )}
      </span>
    </>
  );
  const shell = compact
    ? "flex min-h-11 max-w-[55vw] min-w-0 items-center gap-2.5 rounded-md pr-1"
    : "flex min-h-[50px] w-full min-w-0 items-center gap-2.5 rounded-lg border border-line bg-panel px-2";

  if (memberships.length < 2) {
    return <div className={shell}>{face}</div>;
  }

  return (
    <Menu
      label="Switch business"
      className="min-w-0"
      trigger={(props) => (
        <button type="button" {...props} className={`${shell} hover:border-line-strong`}>
          {face}
          <Icon name="chevrons" className="size-4 shrink-0 text-muted" />
        </button>
      )}
    >
      {(close) =>
        memberships.map((membership) => (
          <MenuItem
            key={membership.id}
            onSelect={() => {
              selectBusiness(membership.id);
              close();
            }}
          >
            <Avatar name={membership.name} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{membership.name}</span>
              <span className="block truncate text-xs text-muted">
                {roleLabel(membership.role)}
              </span>
            </span>
            {membership.id === business.id && <Icon name="check" className="size-4 shrink-0" />}
          </MenuItem>
        ))
      }
    </Menu>
  );
}
