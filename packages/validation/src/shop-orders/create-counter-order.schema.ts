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
  // The branch the order is placed at, resolved like a pairing code's: a branch-bound person's own,
  // else the named one, else the business's only branch.
  branchId: z.string().uuid().optional(),
  documentId: z.string().uuid(),
  customerRecordId: z.string().uuid(),
  printConfiguration: printConfigurationSchema,
});

export type CreateCounterOrderInput = z.infer<typeof createCounterOrderSchema>;
