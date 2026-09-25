import { z } from "zod";
import { optionalPaginationQuerySchema, queryBooleanSchema } from "../common/pagination.schema.js";

/** `GET /shop/products`. 23.6: `q` matches name/description/category; `category` is an
 * exact (case-insensitive) match; `available` filters the availability flag; `limit`/
 * `offset` opt into the envelope (else the legacy array, capped). */
export const listProductsQuerySchema = z
  .object({
    shopId: z.string().uuid(),
    q: z.string().min(1).max(100).optional(),
    category: z.string().min(1).max(100).optional(),
    available: queryBooleanSchema.optional(),
  })
  .merge(optionalPaginationQuerySchema);

export type ListProductsQueryInput = z.infer<typeof listProductsQuerySchema>;
