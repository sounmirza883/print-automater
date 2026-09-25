import { z } from "zod";
import { UserRole } from "@print-automated/types";
import { paginationQuerySchema } from "../common/pagination.schema.js";

/** 23.6 `GET /shop/staff?shopId=`: the business's people, paged (this endpoint is new, so
 * it always returns the envelope: limit 1-100, default 50). `q` matches name/email. */
export const listShopStaffQuerySchema = z
  .object({
    shopId: z.string().uuid(),
    q: z.string().min(1).max(100).optional(),
    role: z.nativeEnum(UserRole).optional(),
    status: z.enum(["ACTIVE", "SUSPENDED", "REMOVED"]).optional(),
  })
  .merge(paginationQuerySchema);

export type ListShopStaffQueryInput = z.infer<typeof listShopStaffQuerySchema>;
