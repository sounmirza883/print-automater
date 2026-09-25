"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import type { ShopOrderResponse } from "@print-automated/api-client";
import { Permission } from "@print-automated/types";
import { BlockedNote } from "@/components/blocked-note";
import { OrderDialogs, type DialogState } from "@/components/orders/action-dialogs";
import {
  JobCard,
  OrderActionBar,
  type JobActionKind,
  type OrderActionKind,
} from "@/components/orders/action-bars";
import { DeliveryPanel } from "@/components/orders/delivery-panel";
import { useActionRunner } from "@/components/orders/use-action-runner";
import { RequirePermission, ResourceBoundary } from "@/components/resource-boundary";
import { useSession } from "@/components/session-provider";
import { EmptyState, LiveStatus, PageHeader, Panel, Pill } from "@/components/ui";
import { getApi } from "@/lib/api";
import { formatDateTime, formatMoney, humanizeEnum } from "@/lib/format";
import { shouldSteerToReprint } from "@/lib/order-actions";
import {
  blockedReasonsOf,
  configurationSummary,
  orderStatusTone,
  paymentStatusTone,
} from "@/lib/orders-view";
import { useResource } from "@/lib/use-resource";

const POLL_MS = 15_000;

/** PRD 108. One order end to end: what was ordered and paid, its live
 * jobs (with why any is parked or failed), quality check, delivery, and
 * every action this role may take, each behind a confirmation where it
 * cannot be undone. Deep links from dashboards and alerts arrive as
 * `?job=<id>`, which highlights that job. */
export function OrderDetail({ orderId }: { orderId: string }): ReactNode {
  return (
    <RequirePermission permission={Permission.VIEW_ORDERS} what="orders">
      <OrderDetailBody orderId={orderId} />
    </RequirePermission>
  );
}

function OrderDetailBody({ orderId }: { orderId: string }): ReactNode {
  const { business, can } = useSession();
  const focusJob = useSearchParams().get("job");
  const state = useResource(() => getApi().shopOrders.get(orderId), [orderId], {
    intervalMs: POLL_MS,
  });
  const runner = useActionRunner(state.reload);
  const [dialog, setDialog] = useState<DialogState | null>(null);

  useEffect(() => {
    if (focusJob !== null && state.data !== null) {
      document
        .getElementById(`job-${focusJob}`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    // Scroll once when the order first arrives, not on every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusJob, state.data === null]);

  const order = state.data;
  const shopId = business?.id ?? "";

  function openDialog(next: DialogState): void {
    runner.clearError();
    setDialog(next);
  }

  async function downloadInvoice(current: ShopOrderResponse): Promise<void> {
    await runner.run(async () => {
      const blob = await getApi().shopOrders.invoice(current.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${current.publicOrderNumber}-invoice.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    });
  }

  function handleOrderAction(kind: OrderActionKind, current: ShopOrderResponse): void {
    switch (kind) {
      case "accept":
        void runner.run(() => getApi().shopOrders.accept(current.id));
        return;
      case "invoice":
        void downloadInvoice(current);
        return;
      default:
        openDialog({ kind });
    }
  }

  function handleJobAction(kind: JobActionKind, job: ShopOrderResponse["printJobs"][number]): void {
    openDialog({ kind, job });
  }

  return (
    <>
      <p className="mb-3 text-sm">
        <Link href="/orders" className="underline underline-offset-2">
          &larr; Orders
        </Link>
      </p>
      <PageHeader
        title={order?.publicOrderNumber ?? "Order"}
        subtitle={order !== null ? order.customerName : undefined}
        actions={
          <LiveStatus
            lastUpdated={state.lastUpdated}
            refreshing={state.refreshing}
            onRefresh={state.reload}
          />
        }
      />
      <ResourceBoundary state={state} what="this order">
        {(current) => (
          <div className="grid gap-4">
            <Panel>
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={orderStatusTone(current.orderStatus)}>
                  {humanizeEnum(current.orderStatus)}
                </Pill>
                <Pill tone={paymentStatusTone(current.paymentStatus)}>
                  Payment: {humanizeEnum(current.paymentStatus)}
                </Pill>
                {current.qualityCheckStatus !== null &&
                  current.qualityCheckStatus !== "NOT_REQUIRED" && (
                    <Pill tone={current.qualityCheckStatus === "PASSED" ? "good" : "caution"}>
                      Quality check: {humanizeEnum(current.qualityCheckStatus)}
                    </Pill>
                  )}
              </div>
              {runner.error !== null && dialog === null && (
                <p
                  role="alert"
                  className="mt-3 rounded-md border border-danger/50 bg-danger-soft px-3 py-2 text-danger-fg"
                >
                  {runner.error}
                </p>
              )}
              <div className="mt-3">
                <OrderActionBar
                  order={current}
                  can={can}
                  busy={runner.busy}
                  onAction={(kind) => handleOrderAction(kind, current)}
                />
              </div>
              {shouldSteerToReprint(current) && (
                <p
                  role="note"
                  className="mt-3 rounded-md border border-caution/50 bg-caution-soft px-3 py-2 text-sm"
                >
                  A quality check failed on this order. Retrying will not print it again; use{" "}
                  <strong>Reprint</strong> on the job that needs to be printed again.
                </p>
              )}
            </Panel>

            <OrderSummary order={current} />

            <Panel title="Print jobs" aside={`${current.printJobs.length} live`} id="jobs">
              {current.printJobs.length === 0 ? (
                <EmptyState title="No print job yet">
                  A job is created when the business accepts the order.
                </EmptyState>
              ) : (
                <ul className="grid gap-3">
                  {current.printJobs.map((job) => (
                    <JobCard
                      key={job.id}
                      job={job}
                      order={current}
                      can={can}
                      busy={runner.busy}
                      highlighted={job.id === focusJob}
                      onAction={handleJobAction}
                    />
                  ))}
                </ul>
              )}
            </Panel>

            <DeliveryPanel
              orderId={current.id}
              orderStatus={current.orderStatus}
              delivery={current.delivery}
              currency={current.pricingSnapshot?.quote?.currency ?? "PKR"}
              runner={runner}
            />

            <OrderDialogs
              dialog={dialog}
              order={current}
              shopId={shopId}
              runner={runner}
              close={() => setDialog(null)}
              open={openDialog}
            />
          </div>
        )}
      </ResourceBoundary>
    </>
  );
}

function OrderSummary({ order }: { order: ShopOrderResponse }): ReactNode {
  const quote = order.pricingSnapshot?.quote;
  const reasons = blockedReasonsOf(order);
  return (
    <Panel title="Order" id="summary">
      <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <Item label="Customer">{order.customerName}</Item>
        <Item label="Document">
          <span className="break-all">{order.documentFilename}</span>
        </Item>
        <Item label="Print settings">{configurationSummary(order.printConfiguration)}</Item>
        <Item label="Total">
          {quote !== undefined ? (
            <span className="num font-semibold">
              {formatMoney(quote.totalMinor, quote.currency)}
            </span>
          ) : (
            "Not available"
          )}
        </Item>
        <Item label="Placed">{formatDateTime(order.createdAt)}</Item>
        <Item label="Printer">{order.printerName ?? "None assigned yet"}</Item>
      </dl>
      {reasons.length > 0 && (
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {reasons.map((reason) => (
            <BlockedNote key={reason} reason={reason} />
          ))}
        </div>
      )}
    </Panel>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
