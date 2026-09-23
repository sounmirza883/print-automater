import { z } from "zod";
import { UserRole } from "@print-automated/types";

/** §54/16.4: only the shop-facing roles are assignable via this
 * endpoint -- CUSTOMER, ADMIN and SUPPLIER are never a `ShopStaff.role`
 * (a supplier portal, if it ever needs shop-scoped staff, gets its own
 * endpoint, not this one). Direct add-by-existing-user-id, not an
 * invite-by-email flow -- see shop-staff.service.ts's own comment for
 * why that's this sub-phase's deliberate scope. */
export const SHOP_STAFF_ASSIGNABLE_ROLES = [
  UserRole.SHOP_OWNER,
  UserRole.SHOP_MANAGER,
  UserRole.SHOP_COUNTER,
  UserRole.OPERATOR,
  UserRole.PRINTER_MANAGER,
] as const;

export const addShopStaffSchema = z.object({
  shopId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.enum(SHOP_STAFF_ASSIGNABLE_ROLES),
});

export type AddShopStaffInput = z.infer<typeof addShopStaffSchema>;

export const changeShopStaffRoleSchema = z.object({
  role: z.enum(SHOP_STAFF_ASSIGNABLE_ROLES),
});

export type ChangeShopStaffRoleInput = z.infer<typeof changeShopStaffRoleSchema>;
