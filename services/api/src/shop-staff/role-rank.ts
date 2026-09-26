import { UserRole } from "@prisma/client";

/** 23.12: shop-role rank for the hierarchy rules -- owner above manager above every other
 * staff role. Non-staff roles rank 0 (never granted at a shop). */
export function roleRank(role: UserRole): number {
  if (role === UserRole.SHOP_OWNER) return 3;
  if (role === UserRole.SHOP_MANAGER) return 2;
  if (
    role === UserRole.SHOP_COUNTER ||
    role === UserRole.OPERATOR ||
    role === UserRole.PRINTER_MANAGER
  ) {
    return 1;
  }
  return 0;
}
