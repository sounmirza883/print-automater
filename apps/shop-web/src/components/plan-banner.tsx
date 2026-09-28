"use client";

import type { ReactNode } from "react";
import { useSession } from "@/components/session-provider";
import { getApi } from "@/lib/api";
import { useResource } from "@/lib/use-resource";

// Plan status changes rarely (a manual admin action) -- a slow poll is plenty,
// unlike the dashboards' own 15-60s intervals for genuinely live production data.
const POLL_MS = 5 * 60_000;
const WARNING_DAYS = 7;

function daysLeft(expiresAt: string): number {
  return Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000);
}

/** 26.6: the business's own plan status, shown to every signed-in staff member
 * of that business -- informational only. Nothing here disables navigation or
 * any non-print action: the API itself is what actually stops printing (26.3)
 * while login, dashboards and everything else keep working, including this
 * banner. Never shown to platform admin (no single business is selected) or
 * before a business is chosen. A load failure fails silently (null) rather
 * than adding a second error surface on top of every screen's own. */
export function PlanBanner(): ReactNode {
  const { business, isAdmin } = useSession();
  const shopId = business?.id;
  const state = useResource(() => getApi().plan.get(shopId!), [shopId], {
    intervalMs: POLL_MS,
    enabled: !isAdmin && shopId !== undefined,
  });
  const plan = state.data;

  if (isAdmin || shopId === undefined || !plan) {
    return null;
  }

  if (!plan.active) {
    return (
      <div
        role="alert"
        className="border-b border-danger/50 bg-danger-soft px-4 py-2 text-center text-sm font-medium sm:px-6"
      >
        Your business&apos;s plan has expired. Printing is paused until it&apos;s renewed --
        everything else here still works. Contact Print Automated to renew it.
      </div>
    );
  }

  if (plan.expiresAt === null) {
    return null;
  }
  const remaining = daysLeft(plan.expiresAt);
  if (remaining > WARNING_DAYS) {
    return null;
  }
  return (
    <div
      role="status"
      className="border-b border-caution/50 bg-caution-soft px-4 py-2 text-center text-sm sm:px-6"
    >
      Your business&apos;s plan expires in {remaining} {remaining === 1 ? "day" : "days"}. Contact
      Print Automated to renew it.
    </div>
  );
}
