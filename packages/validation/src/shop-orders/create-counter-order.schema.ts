import { z } from "zod";
import { printConfigurationSchema } from "../print-configuration.schema.js";

/** §4.2/§11/17.5 `POST /shop/orders`. Same "no price field, ever"
 * shape createQuoteSchema already establishes -- plus `customerRecordId`,
 * REQUIRED (not optional): a counter order is always placed against a
 * specific, already-created walk-in Customer (17.4) -- staff create
 * that record first if the customer is new, exactly as the plan's own
 * flow describes, rather than this endpoint silently creating one. */
export const createCounterOrderSchema = z.object({
  shopId: z.string().uuid(),
  documentId: z.string().uuid(),
  customerRecordId: z.string().uuid(),
  printConfiguration: printConfigurationSchema,
});

export type CreateCounterOrderInput = z.infer<typeof createCounterOrderSchema>;
