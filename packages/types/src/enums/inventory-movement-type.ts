/** §27 -- why a stock quantity changed. Hand-mirrors the Prisma
 * `InventoryMovementType` enum (enum-mirror.spec.ts fails on drift). */
export const InventoryMovementType = {
  PURCHASE: "PURCHASE",
  ADJUSTMENT: "ADJUSTMENT",
  CONSUMPTION: "CONSUMPTION",
  RETURN: "RETURN",
  TRANSFER: "TRANSFER",
  CORRECTION: "CORRECTION",
} as const;

export type InventoryMovementType =
  (typeof InventoryMovementType)[keyof typeof InventoryMovementType];
