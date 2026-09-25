"use client";

import type { ReactNode } from "react";
import { useSession } from "@/components/session-provider";
import { EmptyState, ForbiddenState, PageHeader } from "@/components/ui";
import { NAV_ITEMS, visibleNavItems } from "@/lib/nav";

/** A section whose screen is scheduled for a later step. It still runs
 * the same role check as the real screen will, so a role that could not
 * open the section sees "no access" rather than a promise. */
export function PlannedScreen({ itemId }: { itemId: string }): ReactNode {
  const { user, businessRole, permissions } = useSession();
  const item = NAV_ITEMS.find((candidate) => candidate.id === itemId);
  if (item === undefined) {
    return null;
  }
  const allowed = visibleNavItems({ userRole: user.role, businessRole, permissions }).some(
    (candidate) => candidate.id === item.id,
  );
  if (!allowed) {
    return <ForbiddenState what={item.label} />;
  }
  return (
    <>
      <PageHeader title={item.label} subtitle={item.blurb} />
      <EmptyState title="This screen is on its way">
        The {item.label.toLowerCase()} screen is being built. Everything it will show is already
        served by the API and enforced per role.
      </EmptyState>
    </>
  );
}
