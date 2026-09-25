"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Permission } from "@print-automated/types";
import { firstAllowedDashboard } from "@/components/dashboard/dashboard-tabs";
import { OwnerDashboard } from "@/components/dashboard/owner-dashboard";
import { useSession } from "@/components/session-provider";
import { Skeleton } from "@/components/ui";

/** `/dashboard`: the business dashboard for owners and managers; anyone
 * else is sent to the first thing they can open (an operator to
 * Production, counter staff to the order queue, a platform admin to the
 * platform page), so the landing page is never a dead end. */
export function DashboardHome(): ReactNode {
  const router = useRouter();
  const { can, business, isAdmin } = useSession();
  const showOwner = business !== null && can(Permission.VIEW_DASHBOARD);
  const redirectTo = showOwner
    ? null
    : business === null
      ? isAdmin
        ? "/admin"
        : null
      : (firstAllowedDashboard(can) ?? (can(Permission.VIEW_ORDERS) ? "/orders" : null));

  useEffect(() => {
    if (redirectTo !== null) {
      router.replace(redirectTo);
    }
  }, [redirectTo, router]);

  if (showOwner) {
    return <OwnerDashboard />;
  }
  return redirectTo !== null ? (
    <div role="status" aria-busy="true">
      <span className="sr-only">Opening your dashboard…</span>
      <Skeleton className="h-24" />
    </div>
  ) : null;
}
