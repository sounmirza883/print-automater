import { z } from "zod";
import { UserRole } from "@print-automated/types";
import { registerSchema } from "../auth/register.schema.js";

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

/** §54/16.4 + 23.15: name the person EITHER by an existing account's `userId` (a direct add) OR
 * by `email` (add that account if it exists, otherwise send an invitation; the response is
 * the same either way, so the endpoint never says whether an address has an account).
 * Exactly one of the two. */
export const addShopStaffSchema = z
  .object({
    shopId: z.string().uuid(),
    userId: z.string().uuid().optional(),
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    role: z.enum(SHOP_STAFF_ASSIGNABLE_ROLES),
  })
  .refine((value) => (value.userId === undefined) !== (value.email === undefined), {
    message: "Provide exactly one of userId or email.",
    path: ["userId"],
  });

export type AddShopStaffInput = z.infer<typeof addShopStaffSchema>;

export const changeShopStaffRoleSchema = z.object({
  role: z.enum(SHOP_STAFF_ASSIGNABLE_ROLES),
});

export type ChangeShopStaffRoleInput = z.infer<typeof changeShopStaffRoleSchema>;

/** 23.15: accepting an emailed invitation. The token is opaque (base64url, 43 chars today). */
export const acceptStaffInviteSchema = z.object({
  token: z.string().trim().min(20).max(200),
});

export type AcceptStaffInviteInput = z.infer<typeof acceptStaffInviteSchema>;

/** Fix wave 1: `POST /shop/staff-invites/activate` (unauthenticated). The owner of an
 * admin-created business has an account with no password yet; the emailed invitation
 * code (proof of the mailbox) plus the invited address lets them choose one. Same
 * email normalisation and password rules as account sign-up (`registerSchema`), same
 * token shape as accepting an invitation. */
export const activateStaffInviteSchema = z.object({
  email: registerSchema.shape.email,
  token: acceptStaffInviteSchema.shape.token,
  password: registerSchema.shape.password,
});

export type ActivateStaffInviteInput = z.infer<typeof activateStaffInviteSchema>;
