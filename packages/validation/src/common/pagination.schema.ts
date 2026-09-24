import { z } from "zod";

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 100;

/** Shared `?limit=&offset=` for list endpoints (Phase 20+). Query-string
 * values arrive as strings, hence the coercion; the cap keeps a list request
 * bounded whatever the client sends. Responses echo `{items,total,limit,offset}`. */
export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
});

export type PaginationQueryInput = z.infer<typeof paginationQuerySchema>;

/** `?flag=true|false` -> boolean | undefined. (z.coerce.boolean() would turn the
 * string "false" into true.) */
export const queryBooleanSchema = z.enum(["true", "false"]).transform((value) => value === "true");
