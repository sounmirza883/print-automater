/** §36 -- the shop's reject-reason picker's fixed four options. Not
 * free text: a picker, not an open field, per 8.8's own Build text. */
export const ShopRejectionReason = {
  PRINTER_UNAVAILABLE: "PRINTER_UNAVAILABLE",
  CAPABILITY_UNAVAILABLE: "CAPABILITY_UNAVAILABLE",
  SHOP_UNAVAILABLE: "SHOP_UNAVAILABLE",
  DOCUMENT_ISSUE: "DOCUMENT_ISSUE",
} as const;

export type ShopRejectionReason = (typeof ShopRejectionReason)[keyof typeof ShopRejectionReason];
