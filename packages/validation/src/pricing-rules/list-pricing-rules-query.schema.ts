import { z } from "zod";
import { optionalPaginationQuerySchema } from "../common/pagination.schema.js";

/** `GET /shop/pricing-rules` (newest version first). 23.6: `limit`/`offset` opt into the
 * envelope (else the legacy array, capped). */
export const listPricingRulesQuerySchema = z
  .object({
    shopId: z.string().uuid(),
  })
  .merge(optionalPaginationQuerySchema);

export type ListPricingRulesQueryInput = z.infer<typeof listPricingRulesQuerySchema>;
