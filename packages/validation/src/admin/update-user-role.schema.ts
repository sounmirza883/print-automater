import { z } from "zod";
import { UserRole } from "@print-automated/types";

/** Workstream B (admin panel user management): `PATCH /admin/users/:id/role`
 * (ADMIN only). 24.1 added `SYSTEM` to `UserRole` -- a shop's synthetic
 * QR-order account, never a person -- so it is refused here explicitly:
 * no admin can turn a real user into one. */
export const updateUserRoleSchema = z.object({
  role: z
    .nativeEnum(UserRole)
    .refine((role) => role !== UserRole.SYSTEM, { message: "SYSTEM cannot be assigned." }),
});

export type UpdateUserRoleInput = z.infer<typeof updateUserRoleSchema>;
