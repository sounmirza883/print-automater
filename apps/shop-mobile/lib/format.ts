import type { ShopOrderResponse } from "@print-automated/api-client";

const PAGE_LABELS: Record<string, string> = {
  BW: "Black & white",
  COLOR: "Color",
  SINGLE: "Single-sided",
  DOUBLE: "Double-sided",
};

/** §33's order card summary line -- plain language, not the raw enum
 * values a counter employee never chose to see spelled that way.
 * Duplicated from customer-web's own lib/orders.ts rather than shared:
 * the two apps' package boundaries (packages/design-tokens, /types,
 * /validation, /api-client) never included a shared UI-formatting
 * package, and this is a handful of lines, not a real abstraction. */
export function summarizeConfiguration(config: ShopOrderResponse["printConfiguration"]): string {
  const pages =
    config.pages.mode === "all" ? "all pages" : `pages ${config.pages.from}-${config.pages.to}`;
  const color = PAGE_LABELS[config.color] ?? config.color;
  const sides = PAGE_LABELS[config.sides] ?? config.sides;
  return `${config.copies} ${config.copies === 1 ? "copy" : "copies"}, ${pages}, ${config.paperSize}, ${color}, ${sides}`;
}

export function formatMoney(amountMinor: number, currency: string): string {
  return `${currency} ${(amountMinor / 100).toFixed(2)}`;
}

/** `pricingSnapshot` is optional on `ShopOrderResponse` for the same
 * reason customer-web's own `OrderListItem` treats it that way -- a
 * real order's quote always exists, but test-fixture rows in this
 * shared dev database can bypass it. "--" degrades this one order's
 * display, not the whole screen. */
export function formatOrderTotal(order: ShopOrderResponse): string {
  return order.pricingSnapshot?.quote
    ? formatMoney(order.pricingSnapshot.quote.totalMinor, order.pricingSnapshot.quote.currency)
    : "--";
}
