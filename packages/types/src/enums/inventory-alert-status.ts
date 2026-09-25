/** §32 -- lifecycle of a low-stock alert. Mirrors the Prisma enum. */
export const InventoryAlertStatus = {
  OPEN: "OPEN",
  RESOLVED: "RESOLVED",
} as const;

export type InventoryAlertStatus = (typeof InventoryAlertStatus)[keyof typeof InventoryAlertStatus];
