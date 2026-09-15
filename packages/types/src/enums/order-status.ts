/** Order lifecycle (§25). Payment and print status are tracked
 * separately (§26) — this enum never encodes payment outcome. */
export const OrderStatus = {
  DRAFT: "DRAFT",
  UPLOADED: "UPLOADED",
  PAYMENT_PENDING: "PAYMENT_PENDING",
  PAID: "PAID",
  WAITING_FOR_SHOP: "WAITING_FOR_SHOP",
  SHOP_ACCEPTED: "SHOP_ACCEPTED",
  QUEUED_FOR_PRINT: "QUEUED_FOR_PRINT",
  PRINTING: "PRINTING",
  PRINTED: "PRINTED",
  READY_FOR_COLLECTION: "READY_FOR_COLLECTION",
  COMPLETED: "COMPLETED",
  PAYMENT_FAILED: "PAYMENT_FAILED",
  SHOP_REJECTED: "SHOP_REJECTED",
  PRINT_FAILED: "PRINT_FAILED",
  PRINT_STATUS_UNKNOWN: "PRINT_STATUS_UNKNOWN",
  CANCELLED: "CANCELLED",
  EXPIRED: "EXPIRED",
} as const;

export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];
