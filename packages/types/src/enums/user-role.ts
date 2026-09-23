/** §9 — server-side only; the client is never trusted to enforce this.
 * Mirrors services/api/prisma/schema.prisma's UserRole enum exactly --
 * the two MUST stay in sync. §46/16.1 added OPERATOR, PRINTER_MANAGER,
 * SUPPLIER additively. */
export const UserRole = {
  CUSTOMER: "CUSTOMER",
  SHOP_OWNER: "SHOP_OWNER",
  SHOP_MANAGER: "SHOP_MANAGER",
  SHOP_COUNTER: "SHOP_COUNTER",
  ADMIN: "ADMIN",
  OPERATOR: "OPERATOR",
  PRINTER_MANAGER: "PRINTER_MANAGER",
  SUPPLIER: "SUPPLIER",
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];
