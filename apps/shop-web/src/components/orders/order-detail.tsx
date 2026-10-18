"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import type { ShopOrderDetail, ShopOrderResponse } from "@print-automated/api-client";
import { Permission } from "@print-automated/types";
import { BlockedNote } from "@/components/blocked-note";
import { OrderDialogs, type DialogState } from "@/components/orders/action-dialogs";
import {
  JobCard,
  OrderActionBar,
  QrAwaitingPaymentPill,
  type JobActionKind,
  type OrderActionKind,
} from "@/components/orders/action-bars";
import { DeliveryPanel } from "@/components/orders/delivery-panel";
import { OrderHistoryPanel } from "@/components/orders/order-history";
import { useActionRunner } from "@/components/orders/use-action-runner";
import { RequirePermission, ResourceBoundary } from "@/components/resource-boundary";
import { useSession } from "@/components/session-provider";
import {
  BackLink,
  DetailGrid,
  EmptyState,
  LiveStatus,
  Notice,
  PageHeader,
  Panel,
  Pill,
} from "@/components/ui";
import { getApi } from "@/lib/api";
import { formatDateTime, formatMoney, humanizeEnum, priorityLabel } from "@/lib/format";
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
  const { business, can, branchMode } = useSession();
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
      <BackLink href="/orders">Orders</BackLink>
      <PageHeader
        title={order?.publicOrderNumber ?? "Order"}
        subtitle={
          order !== null
            ? // Someone who can work at several branches is told which one this order belongs to,
              // whichever branch the console is narrowed to (a link from an alert can lead to any).
              [order.customerName, branchMode === "choice" ? order.branchName : undefined]
                .filter((part) => part !== undefined && part !== "")
                .join(" · ")
            : undefined
        }
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
          <>
            <DetailGrid
              main={
                <>
                  <Panel>
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill tone={orderStatusTone(current.orderStatus)}>
                        {humanizeEnum(current.orderStatus)}
                      </Pill>
                      <Pill tone={paymentStatusTone(current.paymentStatus)}>
                        Payment: {humanizeEnum(current.paymentStatus)}
                      </Pill>
                      <QrAwaitingPaymentPill order={current} />
                      {current.qualityCheckStatus !== null &&
                        current.qualityCheckStatus !== "NOT_REQUIRED" && (
                          <Pill tone={current.qualityCheckStatus === "PASSED" ? "good" : "caution"}>
                            Quality check: {humanizeEnum(current.qualityCheckStatus)}
                          </Pill>
                        )}
                    </div>
                    {runner.error !== null && dialog === null && (
                      <Notice tone="danger" role="alert" className="mt-3">
                        {runner.error}
                      </Notice>
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
                      <Notice tone="caution" role="note" className="mt-3">
                        A quality check failed on this order. Retrying will not print it again; use{" "}
                        <strong>Reprint</strong> on the job that needs to be printed again.
                      </Notice>
                    )}
                  </Panel>

                  <OrderItems order={current} />

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

                  <OrderHistoryPanel orderId={current.id} currency={currencyOf(current)} />
                </>
              }
              aside={
                <>
                  <OrderSummary order={current} />

                  <DeliveryPanel
                    orderId={current.id}
                    orderStatus={current.orderStatus}
                    delivery={current.delivery}
                    currency={current.pricingSnapshot?.quote?.currency ?? "PKR"}
                    runner={runner}
                  />
                </>
              }
            />

            <OrderDialogs
              dialog={dialog}
              order={current}
              shopId={shopId}
              runner={runner}
              close={() => setDialog(null)}
              open={openDialog}
            />
          </>
        )}
      </ResourceBoundary>
    </>
  );
}

/** The order's money is in its quote's currency; the payment's is the fallback. */
function currencyOf(order: ShopOrderDetail): string {
  return order.pricingSnapshot?.quote?.currency ?? order.payment?.currency ?? "PKR";
}

export function OrderSummary({ order }: { order: ShopOrderDetail }): ReactNode {
  const quote = order.pricingSnapshot?.quote;
  const reasons = blockedReasonsOf(order);
  const contact = order.customerContact;
  const payment = order.payment;
  const refunds = order.refunds;
  return (
    <Panel title="Order" id="summary">
      <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 xl:grid-cols-1">
        <Item label="Customer">
          {contact.name}
          <span className="ml-1 text-xs text-muted">
            ({contact.kind === "WALK_IN" ? "walk-in" : "online account"})
          </span>
        </Item>
        <Item label="Contact">
          {contact.contactRedacted === true ? (
            <span className="text-muted italic">Hidden for your role</span>
          ) : contact.phone === null && contact.email === null ? (
            <span className="text-muted">None on record</span>
          ) : (
            <span className="break-all">
              {[contact.phone, contact.email].filter((part) => part !== null).join(" · ")}
            </span>
          )}
        </Item>
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
          {order.pricingRuleVersion !== undefined && (
            <span className="block text-xs text-muted">
              {order.pricingRuleVersion === null
                ? "Priced before price lists were versioned"
                : `Priced with price list version ${order.pricingRuleVersion}`}
            </span>
          )}
        </Item>
        <Item label="Payment">
          {payment === null ? (
            <span className="text-muted">No payment on record</span>
          ) : (
            <>
              <span className="num">{formatMoney(payment.amountMinor, payment.currency)}</span>{" "}
              {humanizeEnum(payment.status).toLowerCase()} via {payment.provider}
              {payment.paidAt !== null && (
                <span className="block text-xs text-muted">
                  Paid {formatDateTime(payment.paidAt)}
                </span>
              )}
            </>
          )}
          {refunds.count > 0 && (
            <span className="block text-xs">
              Refunds: {formatMoney(refunds.refundedMinor, refunds.currency ?? currencyOf(order))}{" "}
              returned
              {refunds.pendingMinor > 0 &&
                `, ${formatMoney(refunds.pendingMinor, refunds.currency ?? currencyOf(order))} pending`}
            </span>
          )}
        </Item>
        <Item label="Placed">{formatDateTime(order.createdAt)}</Item>
        <Item label="Printer">{order.printerName ?? "None assigned yet"}</Item>
        {order.priority !== undefined && order.priority > 0 && (
          <Item label="Priority">{priorityLabel(order.priority)}</Item>
        )}
      </dl>
      {reasons.length > 0 && (
        <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-1">
          {reasons.map((reason) => (
            <BlockedNote key={reason} reason={reason} />
          ))}
        </div>
      )}
    </Panel>
  );
}

/** 23.13: the order's lines. A single line is shown too: it says what was ordered even
 * before the order is accepted (its id is null until then). */
export function OrderItems({ order }: { order: ShopOrderDetail }): ReactNode {
  if (order.items.length === 0) {
    return null;
  }
  const currency = currencyOf(order);
  return (
    <Panel
      title="Items"
      aside={`${order.items.length} ${order.items.length === 1 ? "line" : "lines"}`}
      id="items"
    >
      <ul className="grid gap-2 text-sm">
        {order.items.map((item) => (
          <li
            key={item.id ?? `line-${item.sequence}`}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
          >
            <span className="font-medium break-all">{item.documentName}</span>
            <span className="text-muted">
              {itemConfigurationSummary(item.printConfiguration)}
              {item.quantity > 1 && ` · ${item.quantity} sets`}
            </span>
            {item.status !== null && <Pill tone="neutral">{humanizeEnum(item.status)}</Pill>}
            {!item.required && <span className="text-xs text-muted">optional</span>}
            {item.priceMinor !== null && (
              <span className="num ml-auto">{formatMoney(item.priceMinor, currency)}</span>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** An item's configuration is stored loosely; summarise it only when it has the usual shape. */
function itemConfigurationSummary(config: unknown): string {
  return typeof config === "object" && config !== null
    ? configurationSummary(config as ShopOrderResponse["printConfiguration"])
    : "";
}

function Item({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
