import { z } from "zod";
import { OrderStatus } from "@print-automated/types";
import { optionalPaginationQuerySchema } from "../common/pagination.schema.js";

/** `GET /orders` (a customer's own orders). 23.6: `status` and `q` filter; `limit`/`offset` opt
 * into the `{items,total,limit,offset}` envelope (else the legacy array, capped). */
export const listOrdersQuerySchema = z
  .object({
    status: z.nativeEnum(OrderStatus).optional(),
    /** matches the public order number or a document name (case-insensitive, literal). */
    q: z.string().trim().min(1).max(100).optional(),
  })
  .merge(optionalPaginationQuerySchema);

export type ListOrdersQueryInput = z.infer<typeof listOrdersQuerySchema>;
