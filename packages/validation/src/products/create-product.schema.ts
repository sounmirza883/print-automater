import { z } from "zod";
import {
  productPaperRequirementsSchema,
  productPrinterRequirementsSchema,
} from "./product-requirements.schema.js";

/** §13/17.1's own "create" action. `available` defaults to true, the
 * same default `Product.available` itself has, so an omitted body
 * field and an explicit `true` behave identically. */
export const createProductSchema = z.object({
  shopId: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  category: z.string().max(100).optional(),
  unit: z.string().max(50).optional(),
  taxRateBasisPoints: z.number().int().min(0).max(10_000).optional(),
  printerRequirements: productPrinterRequirementsSchema.optional(),
  paperRequirements: productPaperRequirementsSchema.optional(),
  available: z.boolean().optional(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
