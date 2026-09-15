/** §107 — a customer may never submit an order to a shop not currently
 * accepting them. */
export const ShopStatus = {
  OPEN: "OPEN",
  CLOSED: "CLOSED",
  BUSY: "BUSY",
  TEMPORARILY_UNAVAILABLE: "TEMPORARILY_UNAVAILABLE",
  SUSPENDED: "SUSPENDED",
} as const;

export type ShopStatus = (typeof ShopStatus)[keyof typeof ShopStatus];
