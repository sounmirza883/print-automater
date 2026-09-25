import { z } from "zod";
import { optionalPaginationQuerySchema, queryBooleanSchema } from "../common/pagination.schema.js";

/** §33/34/17.4: `q` is a case-insensitive partial match against name/phone/email/company
 * (trigram-indexed; a literal `%` or `_` matches itself). Optional -- an omitted `q` lists
 * every one of the shop's customers. 23.6: `active` filters by account status, and
 * `limit`/`offset` opt into the `{items,total,limit,offset}` envelope (without them the
 * legacy bare array is returned, capped at LEGACY_LIST_CAP). */
export const listCustomersQuerySchema = z
  .object({
    shopId: z.string().uuid(),
    q: z.string().min(1).max(200).optional(),
    active: queryBooleanSchema.optional(),
  })
  .merge(optionalPaginationQuerySchema);

export type ListCustomersQueryInput = z.infer<typeof listCustomersQuerySchema>;
