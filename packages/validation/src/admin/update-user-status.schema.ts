import { z } from "zod";
import { UserStatus } from "@print-automated/types";

/** Workstream B (admin panel user management): `PATCH /admin/users/:id/status`
 * (ADMIN only). Setting `SUSPENDED`/`DELETED` also revokes the target's
 * refresh tokens (services/api/src/admin/admin.service.ts). */
export const updateUserStatusSchema = z.object({
  status: z.nativeEnum(UserStatus),
});

export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>;
