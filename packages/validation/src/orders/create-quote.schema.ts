import { z } from "zod";
import { printConfigurationSchema } from "../print-configuration.schema.js";

/** §19 `POST /orders/quote`. Deliberately has no `total` (or any other
 * price) field: §19's own requirement -- "never accept a
 * client-calculated total as authoritative" -- is enforced structurally
 * here, not just by convention. Zod's default `.strip()` behavior
 * additionally drops any unrecognized field a client sends (a `total`
 * included anyway), so there's no code path where one could leak
 * through even by accident. */
export const createQuoteSchema = z.object({
  documentId: z.string().uuid(),
  shopId: z.string().uuid(),
  printConfiguration: printConfigurationSchema,
});

export type CreateQuoteInput = z.infer<typeof createQuoteSchema>;
