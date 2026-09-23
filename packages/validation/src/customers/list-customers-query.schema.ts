import { z } from "zod";

/** §33/34/17.4: `q` is a plain partial match against name/phone/email
 * (CustomersService's own case-insensitive `contains` filter, not a
 * search engine -- this codebase has no full-text search anywhere yet,
 * per the earlier survey). Optional -- an omitted `q` just lists every
 * one of the shop's customers. */
export const listCustomersQuerySchema = z.object({
  shopId: z.string().uuid(),
  q: z.string().min(1).max(200).optional(),
});

export type ListCustomersQueryInput = z.infer<typeof listCustomersQuerySchema>;
