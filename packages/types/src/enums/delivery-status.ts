/** §71 -- where an order's optional delivery stands. Hand-mirrors the Prisma
 * `DeliveryStatus` enum (enum-mirror.spec.ts fails on drift). */
export const DeliveryStatus = {
  PENDING: "PENDING",
  OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
  DELIVERED: "DELIVERED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
} as const;

export type DeliveryStatus = (typeof DeliveryStatus)[keyof typeof DeliveryStatus];
