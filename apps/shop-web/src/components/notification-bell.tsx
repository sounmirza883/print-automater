"use client";

import Link from "next/link";
import { useEffect, type ReactNode } from "react";
import { getApi } from "@/lib/api";
import { NOTIFICATIONS_CHANGED_EVENT } from "@/lib/notification-links";
import { useResource } from "@/lib/use-resource";

const POLL_MS = 30_000;

/** PRD 111: unread notifications are "clearly identified". The badge is
 * the count of the person's unread STAFF alerts across every business
 * they belong to (customer order notices belong to customer-web), polled
 * every 30 s while the tab is visible and refreshed the moment the
 * notification centre marks something read. A failed poll keeps the last
 * known count rather than flashing a wrong zero. */
export function NotificationBell(): ReactNode {
  const unread = useResource(() => getApi().notifications.unreadCount({ audience: "staff" }), [], {
    intervalMs: POLL_MS,
  });
  const { reload } = unread;

  useEffect(() => {
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, reload);
    return () => window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, reload);
  }, [reload]);

  const count = unread.data?.count ?? 0;
  const label = count === 0 ? "Notifications, none unread" : `Notifications, ${count} unread`;

  return (
    <Link
      href="/notifications"
      aria-label={label}
      className="relative grid size-9 place-items-center rounded-md border border-line bg-panel hover:border-muted"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9Z" />
        <path d="M10 19a2 2 0 0 0 4 0" />
      </svg>
      {count > 0 && (
        <span
          aria-hidden="true"
          className="num absolute -top-1.5 -right-1.5 grid min-w-5 place-items-center rounded-full bg-danger px-1 text-[11px] leading-5 font-semibold text-white"
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
