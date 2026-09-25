"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { NotificationItem } from "@print-automated/types";
import { useSession } from "@/components/session-provider";
import {
  Button,
  EmptyState,
  ErrorState,
  LiveStatus,
  LoadingGrid,
  PageHeader,
  Pill,
  StaleBanner,
} from "@/components/ui";
import { describeError, getApi } from "@/lib/api";
import { formatAge, formatDateTime, humanizeEnum } from "@/lib/format";
import {
  NOTIFICATIONS_CHANGED_EVENT,
  notificationHref,
  notificationLinkLabel,
} from "@/lib/notification-links";
import { useResource } from "@/lib/use-resource";

const PAGE_SIZE = 20;
const POLL_MS = 30_000;

const TYPE_TONE: Record<string, "danger" | "caution" | "accent"> = {
  JOB_FAILED: "danger",
  JOB_HELD_LATE_PRINT: "danger",
  JOB_BLOCKED: "caution",
  LOW_STOCK: "caution",
};

/** PRD 111. The signed-in person's STAFF alerts (customer order notices
 * belong to customer-web) across every business they belong to, with an
 * unread filter, mark read / mark all read, and a deep link from each
 * alert to the order, job, printer, stock item or purchase order it is
 * about. Unread items are marked three ways (dot, bold title, "Unread"
 * text for screen readers), never by colour alone. */
export function NotificationCentre(): ReactNode {
  const { memberships, selectBusiness } = useSession();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [businessId, setBusinessId] = useState("");
  const [offset, setOffset] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const scope = businessId === "" ? {} : { shopId: businessId };
  const state = useResource(
    () =>
      getApi().notifications.list({
        audience: "staff",
        ...scope,
        unread: unreadOnly ? true : undefined,
        limit: PAGE_SIZE,
        offset,
      }),
    [unreadOnly, businessId, offset],
    { intervalMs: POLL_MS },
  );

  const businessName = (id: string | null): string | null =>
    memberships.length > 1 && id !== null
      ? (memberships.find((membership) => membership.id === id)?.name ?? null)
      : null;

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
      state.reload();
    } catch (error) {
      setActionError(describeError(error));
    } finally {
      setBusy(false);
    }
  }

  const items = state.data?.items ?? [];
  const total = state.data?.total ?? 0;
  const hasUnreadOnPage = items.some((item) => !item.read);

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="Alerts about jobs, printers and stock"
        actions={
          <>
            <LiveStatus
              lastUpdated={state.lastUpdated}
              refreshing={state.refreshing}
              onRefresh={state.reload}
            />
            <Button
              disabled={busy || !hasUnreadOnPage}
              onClick={() =>
                void run(() => getApi().notifications.markAllRead({ audience: "staff", ...scope }))
              }
            >
              Mark all read
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label="Filter"
          className="flex rounded-md border border-line bg-panel p-0.5"
        >
          {[
            { label: "All", value: false },
            { label: "Unread", value: true },
          ].map((option) => (
            <button
              key={option.label}
              type="button"
              aria-pressed={unreadOnly === option.value}
              onClick={() => {
                setUnreadOnly(option.value);
                setOffset(0);
              }}
              className={`rounded px-3 py-1 text-sm font-medium ${
                unreadOnly === option.value ? "bg-accent text-white" : "text-muted hover:text-ink"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        {memberships.length > 1 && (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">Business</span>
            <select
              value={businessId}
              onChange={(event) => {
                setBusinessId(event.target.value);
                setOffset(0);
              }}
              className="rounded-md border border-line bg-panel px-2 py-1.5"
            >
              <option value="">All my businesses</option>
              {memberships.map((membership) => (
                <option key={membership.id} value={membership.id}>
                  {membership.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {actionError !== null && (
        <p
          role="alert"
          className="mb-4 rounded-md border border-danger/50 bg-danger-soft px-3 py-2 text-danger-fg"
        >
          {actionError}
        </p>
      )}

      {state.data === null ? (
        state.error !== null ? (
          <ErrorState error={state.error} onRetry={state.reload} what="notifications" />
        ) : (
          <LoadingGrid label="Loading notifications" />
        )
      ) : (
        <>
          <StaleBanner error={state.error} lastUpdated={state.lastUpdated} onRetry={state.reload} />
          {items.length === 0 ? (
            <EmptyState title={unreadOnly ? "You are all caught up" : "No notifications yet"}>
              {unreadOnly
                ? "There is nothing unread."
                : "Alerts about blocked or failed jobs, held prints and low stock appear here."}
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line bg-panel">
              {items.map((item) => (
                <NotificationRow
                  key={item.id}
                  item={item}
                  businessName={businessName(item.shopId)}
                  busy={busy}
                  onMarkRead={() => void run(() => getApi().notifications.markRead(item.id))}
                  onOpen={() => {
                    if (item.shopId !== null) {
                      selectBusiness(item.shopId);
                    }
                    if (!item.read) {
                      void getApi()
                        .notifications.markRead(item.id)
                        .then(() => window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT)))
                        .catch(() => undefined);
                    }
                  }}
                />
              ))}
            </ul>
          )}
          {total > PAGE_SIZE && (
            <nav aria-label="Pages" className="mt-4 flex items-center justify-between text-sm">
              <Button
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                Newer
              </Button>
              <span className="num text-muted">
                {offset + 1}&ndash;{Math.min(offset + PAGE_SIZE, total)} of {total}
              </span>
              <Button
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Older
              </Button>
            </nav>
          )}
        </>
      )}
    </>
  );
}

function NotificationRow({
  item,
  businessName,
  busy,
  onMarkRead,
  onOpen,
}: {
  item: NotificationItem;
  businessName: string | null;
  busy: boolean;
  onMarkRead: () => void;
  onOpen: () => void;
}): ReactNode {
  const href = notificationHref(item.target);
  const linkLabel = notificationLinkLabel(item.target);
  return (
    <li className={`flex gap-3 px-4 py-3 ${item.read ? "" : "bg-accent-soft"}`}>
      <span className="mt-1.5 w-2 shrink-0">
        {!item.read && <span aria-hidden="true" className="block size-2 rounded-full bg-accent" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {!item.read && <span className="sr-only">Unread: </span>}
          <p className={item.read ? "font-medium" : "font-semibold"}>{item.title}</p>
          <Pill tone={TYPE_TONE[item.type] ?? "accent"}>{humanizeEnum(item.type)}</Pill>
          {businessName !== null && <span className="text-xs text-muted">{businessName}</span>}
        </div>
        <p className="mt-0.5 text-muted">{item.body}</p>
        <p className="mt-1 text-xs text-muted">
          <time dateTime={item.createdAt} title={formatDateTime(item.createdAt)}>
            {formatAge(item.createdAt)}
          </time>
          {item.read && item.readAt !== null && <> &middot; read {formatAge(item.readAt)}</>}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-start">
        {href !== null && linkLabel !== null && (
          <Link
            href={href}
            onClick={onOpen}
            className="rounded-md border border-line bg-panel px-3 py-1.5 text-sm font-medium hover:border-accent"
          >
            {linkLabel}
          </Link>
        )}
        {!item.read && (
          <Button variant="ghost" disabled={busy} onClick={onMarkRead}>
            Mark read
          </Button>
        )}
      </div>
    </li>
  );
}
