import type { OrderStatus } from "@print-automated/types";

export interface OrderListItem {
  id: string;
  publicOrderNumber: string;
  documentId: string;
  documentFilename: string;
  shopId: string;
  shopName: string;
  printConfiguration: {
    pages: { mode: "all" } | { mode: "range"; from: number; to: number };
    copies: number;
    paperSize: string;
    color: string;
    sides: string;
    orientation: string;
  };
  // Optional, not because a real order can ever legitimately lack a
  // quote (packages/pricing's computeQuote runs unconditionally at
  // creation) -- only because this shared dev database has
  // accumulated orders written directly by test fixtures (bypassing
  // that real path) that don't bother filling one in. A malformed row
  // like that should degrade this one order's own display, not crash
  // the whole page for every other, real order in the list.
  pricingSnapshot?: { quote?: { totalMinor: number; currency: string } };
  paymentStatus: string;
  orderStatus: string;
  createdAt: string;
}

/** Through the authenticated proxy (§64: this is the requester's own
 * order, never anyone else's) -- same pattern configure-quote.ts's
 * `fetchQuote` already established. */
export async function fetchOrders(fetchImpl: typeof fetch = fetch): Promise<OrderListItem[]> {
  const response = await fetchImpl("/api/orders");
  if (!response.ok) {
    throw new Error("Could not load your orders.");
  }
  return (await response.json()) as OrderListItem[];
}

export async function fetchOrder(
  orderId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OrderListItem> {
  const response = await fetchImpl(`/api/orders/${orderId}`);
  if (!response.ok) {
    throw new Error("Could not load this order.");
  }
  return (await response.json()) as OrderListItem;
}

/** §27's six customer-facing milestones -- not the 17 internal
 * `OrderStatus` values. "Order created" is done for every order that
 * exists at all; the rest advance one at a time. */
export const ORDER_PROGRESS_STEPS = [
  "Order created",
  "Payment confirmed",
  "Shop accepted",
  "Printing",
  "Ready for collection",
  "Completed",
] as const;

export type OrderProgress =
  | { kind: "steps"; doneCount: number; currentIndex: number | null }
  | { kind: "message"; text: string };

/** §27/§104: "no internal infrastructure terminology reaches the
 * customer" -- every one of the 17 `OrderStatus` values is mapped
 * here, once, to either a position on the six-step happy-path
 * progress bar or a plain-language message for a state the linear
 * bar can't represent (a failure, a cancellation). Nothing else in
 * customer-web ever needs to know the raw status string. */
export function getOrderProgress(orderStatus: string): OrderProgress {
  if (!isOrderStatus(orderStatus)) {
    // A status the server sent that this build has never heard of: still
    // degrade to a message rather than crash the page.
    return { kind: "message", text: "Order status unavailable." };
  }
  return ORDER_PROGRESS_BY_STATUS[orderStatus];
}

function isOrderStatus(value: string): value is OrderStatus {
  return Object.prototype.hasOwnProperty.call(ORDER_PROGRESS_BY_STATUS, value);
}

const step = (n: number): OrderProgress => ({ kind: "steps", doneCount: n, currentIndex: n });

/** Total on purpose: `Record<OrderStatus, ...>` makes a new status a
 * compile error here, not a blank tracker in production. */
const ORDER_PROGRESS_BY_STATUS: Record<OrderStatus, OrderProgress> = {
  DRAFT: step(1),
  UPLOADED: step(1),
  PAYMENT_PENDING: step(1),
  PAID: step(2),
  WAITING_FOR_SHOP: step(2),
  SHOP_ACCEPTED: step(3),
  QUEUED_FOR_PRINT: step(3),
  // Phase 18 job-derived statuses share the existing shop-side
  // step (the one SHOP_ACCEPTED/QUEUED_FOR_PRINT already use).
  PREPARING: step(3),
  ASSIGNED: step(3),
  PRINTING: step(3),
  // Paused shares the printing step; the wording is in
  // getOrderStatusNote so the bar itself stays six steps.
  PAUSED: step(3),
  PRINTED: step(4),
  // Printed but being quality-checked: same step as PRINTED.
  QUALITY_CHECK: step(4),
  READY_FOR_COLLECTION: step(5),
  COMPLETED: { kind: "steps", doneCount: 6, currentIndex: null },
  PAYMENT_FAILED: { kind: "message", text: "Payment could not be completed for this order." },
  SHOP_REJECTED: { kind: "message", text: "The shop was unable to accept this order." },
  PRINT_FAILED: {
    kind: "message",
    text: "There was a problem printing this order. The shop has been notified and will follow up with you.",
  },
  PRINT_STATUS_UNKNOWN: {
    kind: "message",
    text: "We're checking on the status of this order's printing.",
  },
  CANCELLED: { kind: "message", text: "This order was cancelled." },
  EXPIRED: { kind: "message", text: "This order expired before payment was completed." },
};

/** Plain-language sentence for the statuses that share a step with a
 * different meaning; null where the step name alone says it all.
 * Total over `OrderStatus` for the same reason as the table above. */
const ORDER_STATUS_NOTE: Record<OrderStatus, string | null> = {
  DRAFT: null,
  UPLOADED: null,
  PAYMENT_PENDING: null,
  PAID: null,
  WAITING_FOR_SHOP: null,
  SHOP_ACCEPTED: null,
  QUEUED_FOR_PRINT: null,
  PREPARING: "The shop is preparing your order.",
  ASSIGNED: "The shop has lined your order up for a printer.",
  PRINTING: null,
  PAUSED: "Printing is paused for now. The shop will resume it shortly.",
  PRINTED: null,
  QUALITY_CHECK: "Printed. The shop is quality-checking your order.",
  READY_FOR_COLLECTION: null,
  COMPLETED: null,
  PAYMENT_FAILED: null,
  SHOP_REJECTED: null,
  PRINT_FAILED: null,
  PRINT_STATUS_UNKNOWN: null,
  CANCELLED: null,
  EXPIRED: null,
};

export function getOrderStatusNote(orderStatus: string): string | null {
  return isOrderStatus(orderStatus) ? ORDER_STATUS_NOTE[orderStatus] : null;
}

const PAGE_LABELS: Record<string, string> = {
  BW: "Black & white",
  COLOR: "Color",
  SINGLE: "Single-sided",
  DOUBLE: "Double-sided",
};

/** §28's own "configuration summary" -- plain language, not the raw
 * enum values (`BW`, `SINGLE`, ...) a customer never chose to see
 * spelled that way. */
export function summarizeConfiguration(config: OrderListItem["printConfiguration"]): string {
  const pages =
    config.pages.mode === "all" ? "all pages" : `pages ${config.pages.from}-${config.pages.to}`;
  const color = PAGE_LABELS[config.color] ?? config.color;
  const sides = PAGE_LABELS[config.sides] ?? config.sides;
  return `${config.copies} ${config.copies === 1 ? "copy" : "copies"}, ${pages}, ${config.paperSize}, ${color}, ${sides}`;
}

export function formatMoney(amountMinor: number, currency: string): string {
  return `${currency} ${(amountMinor / 100).toFixed(2)}`;
}
