/** §9 — server-side only; the client is never trusted to enforce this. */
export const UserRole = {
  CUSTOMER: "CUSTOMER",
  SHOP_OWNER: "SHOP_OWNER",
  SHOP_MANAGER: "SHOP_MANAGER",
  SHOP_COUNTER: "SHOP_COUNTER",
  ADMIN: "ADMIN",
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];
