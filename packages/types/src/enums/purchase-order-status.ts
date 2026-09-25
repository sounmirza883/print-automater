/** 31 -- purchase order lifecycle. Mirrors the Prisma enum. */
export const PurchaseOrderStatus = {
  DRAFT: "DRAFT",
  ORDERED: "ORDERED",
  RECEIVED: "RECEIVED",
  CANCELLED: "CANCELLED",
} as const;

export type PurchaseOrderStatus = (typeof PurchaseOrderStatus)[keyof typeof PurchaseOrderStatus];

/** 31 -- payment status of a purchase order. Mirrors the Prisma enum. */
export const PurchaseOrderPaymentStatus = {
  UNPAID: "UNPAID",
  PARTIALLY_PAID: "PARTIALLY_PAID",
  PAID: "PAID",
} as const;

export type PurchaseOrderPaymentStatus =
  (typeof PurchaseOrderPaymentStatus)[keyof typeof PurchaseOrderPaymentStatus];
