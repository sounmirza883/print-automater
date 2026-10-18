import { z } from "zod";
import { optionalPaginationQuerySchema } from "../common/pagination.schema.js";

export const SHOP_ORDER_GROUPS = [
  "needsAttention",
  "printing",
  "ready",
  "completed",
  "failed",
] as const;

/** §32/8.2 `GET /shop/orders?shopId=`. `shopId` is required, not
 * inferred from "whichever shop this staff member belongs to" -- a
 * user can be active staff at more than one shop (shop_staff has no
 * uniqueness constraint on user_id alone), so there is no single
 * implicit answer to default to.
 *
 * 23.6: with neither `limit`/`offset` nor `group` the response is the legacy grouped
 * object (live groups whole up to a cap, completed/failed the newest 200 each). `group`
 * and/or `limit`/`offset` return ONE flat `{items,total,limit,offset}` page, newest first,
 * of that group (or of every visible order when no group is named). For search and
 * richer filters see `GET /shop/orders/search`. */
export const listShopOrdersQuerySchema = z
  .object({
    shopId: z.string().uuid(),
    group: z.enum(SHOP_ORDER_GROUPS).optional(),
    // Narrow to one branch. A branch-bound caller is pinned to their own (naming another is 403).
    branchId: z.string().uuid().optional(),
  })
  .merge(optionalPaginationQuerySchema);

export type ListShopOrdersQueryInput = z.infer<typeof listShopOrdersQuerySchema>;
