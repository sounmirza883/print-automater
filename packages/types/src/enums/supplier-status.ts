/** 29 -- supplier lifecycle. Mirrors the Prisma enum. */
export const SupplierStatus = {
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
} as const;

export type SupplierStatus = (typeof SupplierStatus)[keyof typeof SupplierStatus];
