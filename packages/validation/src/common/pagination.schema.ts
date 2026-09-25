import { z } from "zod";

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 100;
/** 23.11: deep OFFSET paging makes Postgres walk and discard that many rows per request, so it
 * is capped (400 beyond it). Narrow the filters, or use `q`, to reach older rows. */
export const MAX_PAGE_OFFSET = 10_000;

/** Shared `?limit=&offset=` for list endpoints (Phase 20+). Query-string
 * values arrive as strings, hence the coercion; the cap keeps a list request
 * bounded whatever the client sends. Responses echo `{items,total,limit,offset}`. */
export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
  offset: z.coerce.number().int().min(0).max(MAX_PAGE_OFFSET).default(0),
});

export type PaginationQueryInput = z.infer<typeof paginationQuerySchema>;

/** `?flag=true|false` -> boolean | undefined. (z.coerce.boolean() would turn the
 * string "false" into true.) */
export const queryBooleanSchema = z.enum(["true", "false"]).transform((value) => value === "true");

/** 23.6: the most rows an UNPAGED legacy list call may return. Lists that predate
 * pagination returned a bare array to existing clients (customer-web, shop-mobile);
 * that shape is kept when neither `limit` nor `offset` is sent, but bounded here so no
 * list is ever unbounded. Sending either param opts into the `{items,total,limit,offset}`
 * envelope. */
export const LEGACY_LIST_CAP = 500;

/** `?limit=&offset=` for lists that must stay backwards compatible: BOTH are optional and
 * carry no default, so a request without them is recognisably a legacy call. Once either
 * is present the other defaults (limit 50, offset 0) and the response is the envelope. */
export const optionalPaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).optional(),
  offset: z.coerce.number().int().min(0).max(MAX_PAGE_OFFSET).optional(),
});
export type OptionalPaginationQueryInput = z.infer<typeof optionalPaginationQuerySchema>;
