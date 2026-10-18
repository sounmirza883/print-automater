import { z } from "zod";
import { createQuoteSchema } from "./create-quote.schema.js";

/** `POST /orders`: a quote's inputs plus the branch the customer is ordering from (the one on the
 * QR code they scanned). Still no price field, ever. Omitted means the business's oldest branch,
 * so links and codes created before branches existed keep working. A quote does not take a
 * branch: it prices the business's catalogue, which is shared. */
export const createOrderSchema = createQuoteSchema.extend({
  branchId: z.string().uuid().optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
