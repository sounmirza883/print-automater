import { z } from "zod";

/** §32/8.2 `GET /shop/orders?shopId=`. `shopId` is required, not
 * inferred from "whichever shop this staff member belongs to" -- a
 * user can be active staff at more than one shop (shop_staff has no
 * uniqueness constraint on user_id alone), so there is no single
 * implicit answer to default to. */
export const listShopOrdersQuerySchema = z.object({
  shopId: z.string().uuid(),
});

export type ListShopOrdersQueryInput = z.infer<typeof listShopOrdersQuerySchema>;
