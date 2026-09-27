"use client";

import { useState, type ReactNode } from "react";
import { Pager } from "@/components/form-kit";
import { ResourceBoundary } from "@/components/resource-boundary";
import { EmptyState, Panel } from "@/components/ui";
import { getApi } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { historyDetails, historyTitle } from "@/lib/order-history-view";
import { useResource } from "@/lib/use-resource";

const PAGE = 20;

/** 23.13/23.19: the order's timeline -- the order itself, every job it ever had (including
 * replaced ones), its payments, refunds and delivery -- oldest first. The API shows only
 * allowlisted details and hides staff-typed notes from roles that may not see customer
 * contact; this screen says so where it happens. */
export function OrderHistoryPanel({
  orderId,
  currency,
}: {
  orderId: string;
  currency: string;
}): ReactNode {
  const [page, setPage] = useState(0);
  const state = useResource(
    () => getApi().shopOrders.history(orderId, { limit: PAGE, offset: page * PAGE }),
    [orderId, page],
    { intervalMs: 60_000 },
  );
  return (
    <Panel title="History" id="history">
      <ResourceBoundary state={state} what="this order's history">
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState title="Nothing recorded yet">
              Events appear here as the order moves along.
            </EmptyState>
          ) : (
            <>
              <ol className="grid gap-3">
                {data.items.map((event) => {
                  const details = historyDetails(event.metadata, currency);
                  return (
                    <li key={event.id} className="grid gap-1 border-l-2 border-line pl-3 text-sm">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-medium">{historyTitle(event.action)}</span>
                        <span className="text-xs text-muted">
                          {formatDateTime(event.at)} &middot; {event.actor?.name ?? "System"}
                        </span>
                      </div>
                      {details.length > 0 && (
                        <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
                          {details.map((detail) => (
                            <div key={detail.label} className="flex gap-1">
                              <dt className="text-muted">{detail.label}:</dt>
                              <dd className={detail.hidden ? "text-muted italic" : undefined}>
                                {detail.value}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </li>
                  );
                })}
              </ol>
              <Pager page={page} pageSize={PAGE} total={data.total} onPage={setPage} />
            </>
          )
        }
      </ResourceBoundary>
    </Panel>
  );
}
