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
  switch (orderStatus) {
    case "DRAFT":
    case "UPLOADED":
    case "PAYMENT_PENDING":
      return { kind: "steps", doneCount: 1, currentIndex: 1 };
    case "PAID":
    case "WAITING_FOR_SHOP":
      return { kind: "steps", doneCount: 2, currentIndex: 2 };
    case "SHOP_ACCEPTED":
    case "QUEUED_FOR_PRINT":
    case "PRINTING":
      return { kind: "steps", doneCount: 3, currentIndex: 3 };
    case "PRINTED":
      return { kind: "steps", doneCount: 4, currentIndex: 4 };
    case "READY_FOR_COLLECTION":
      return { kind: "steps", doneCount: 5, currentIndex: 5 };
    case "COMPLETED":
      return { kind: "steps", doneCount: 6, currentIndex: null };
    case "PAYMENT_FAILED":
      return { kind: "message", text: "Payment could not be completed for this order." };
    case "SHOP_REJECTED":
      return { kind: "message", text: "The shop was unable to accept this order." };
    case "PRINT_FAILED":
      return {
        kind: "message",
        text: "There was a problem printing this order. The shop has been notified and will follow up with you.",
      };
    case "PRINT_STATUS_UNKNOWN":
      return { kind: "message", text: "We're checking on the status of this order's printing." };
    case "CANCELLED":
      return { kind: "message", text: "This order was cancelled." };
    case "EXPIRED":
      return { kind: "message", text: "This order expired before payment was completed." };
    default:
      return { kind: "message", text: "Order status unavailable." };
  }
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
