import { z } from "zod";
import { UserRole } from "@print-automated/types";

/** Workstream B (admin panel user management): `PATCH /admin/users/:id/role`
 * (ADMIN only). `SYSTEM` does not exist as of this task (Task 4 adds it) --
 * that value is simply not in `UserRole` yet, so it cannot be requested. */
export const updateUserRoleSchema = z.object({
  role: z.nativeEnum(UserRole),
});

export type UpdateUserRoleInput = z.infer<typeof updateUserRoleSchema>;
