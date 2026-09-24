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
  // 18.2: order-level statuses derived from the order's print jobs
  // (aggregate-order-status.ts) or, for QUALITY_CHECK, exited by staff
  // (QC_PASS/QC_FAIL/QC_REPRINT). PREPARING: jobs exist but are not all
  // allocated to a printer yet. ASSIGNED: a job was claimed by an agent
  // but none is printing. PAUSED: every active job is paused.
  // QUALITY_CHECK: every required job printed and the shop has quality
  // checking on. Added to Prisma in 18.2 but missing here until the
  // Phase 18 review -- every client lookup keyed on OrderStatus must
  // handle them (enum-mirror.spec.ts in services/api now enforces that
  // this file cannot drift from the Prisma enum again).
  PREPARING: "PREPARING",
  ASSIGNED: "ASSIGNED",
  PAUSED: "PAUSED",
  QUALITY_CHECK: "QUALITY_CHECK",
} as const;

export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];
