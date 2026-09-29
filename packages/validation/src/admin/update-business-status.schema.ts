import { z } from "zod";
import { ShopStatus } from "@print-automated/types";

/** 23.7/Workstream A: `PATCH /admin/businesses/:id/status` (ADMIN only).
 * The one field an admin may change through this route -- everything
 * else about a business is edited by its own staff via shop settings. */
export const updateBusinessStatusSchema = z.object({
  status: z.nativeEnum(ShopStatus),
});

export type UpdateBusinessStatusInput = z.infer<typeof updateBusinessStatusSchema>;
