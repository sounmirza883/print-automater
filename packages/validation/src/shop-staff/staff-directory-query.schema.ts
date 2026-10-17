import { z } from "zod";
import { UserRole } from "@print-automated/types";
import { paginationQuerySchema } from "../common/pagination.schema.js";

/** 23.15 `GET /shop/staff/directory?shopId=`: the minimal "who works here" list (id + name of
 * ACTIVE members) that filters such as the order search's operator picker need. `role` narrows
 * to one role (e.g. OPERATOR). Always a page (limit 1-100, default 50). */
export const staffDirectoryQuerySchema = z
  .object({
    shopId: z.string().uuid(),
    q: z.string().min(1).max(100).optional(),
    role: z.nativeEnum(UserRole).optional(),
  })
  .merge(paginationQuerySchema);

export type StaffDirectoryQueryInput = z.infer<typeof staffDirectoryQuerySchema>;

/** 23.15 `GET /shop/staff/invites?shopId=`: pending invitations, paged; `branchId` narrows to one
 * branch (a branch-bound caller can only ever ask for their own). */
export const listStaffInvitesQuerySchema = z
  .object({ shopId: z.string().uuid(), branchId: z.string().uuid().optional() })
  .merge(paginationQuerySchema);

export type ListStaffInvitesQueryInput = z.infer<typeof listStaffInvitesQuerySchema>;
