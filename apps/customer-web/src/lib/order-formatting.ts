const PAGE_LABELS: Record<string, string> = {
  BW: "Black & white",
  COLOR: "Color",
  SINGLE: "Single-sided",
  DOUBLE: "Double-sided",
};

export interface OrderFormattingConfiguration {
  pages: { mode: "all" } | { mode: "range"; from: number; to: number };
  copies: number;
  paperSize: string;
  color: string;
  sides: string;
}

/** §28's own "configuration summary" -- plain language, not the raw
 * enum values (`BW`, `SINGLE`, ...) a customer never chose to see
 * spelled that way.
 *
 * Moved out of the old, deleted `lib/orders.ts` (the authenticated
 * order-history flow) because the QR guest-order wizard's confirmation
 * screen (`app/s/[shopId]/upload/page.tsx`) is this function's only
 * remaining caller and has no dependency on that file's
 * fetchOrders/fetchOrder/getOrderProgress proxy calls. */
export function summarizeConfiguration(config: OrderFormattingConfiguration): string {
  const pages =
    config.pages.mode === "all" ? "all pages" : `pages ${config.pages.from}-${config.pages.to}`;
  const color = PAGE_LABELS[config.color] ?? config.color;
  const sides = PAGE_LABELS[config.sides] ?? config.sides;
  return `${config.copies} ${config.copies === 1 ? "copy" : "copies"}, ${pages}, ${config.paperSize}, ${color}, ${sides}`;
}

export function formatMoney(amountMinor: number, currency: string): string {
  return `${currency} ${(amountMinor / 100).toFixed(2)}`;
}
