import { z } from "zod";
import {
  productPaperRequirementsSchema,
  productPrinterRequirementsSchema,
} from "./product-requirements.schema.js";

/** §13/17.1's own "edit" action. Every field optional (a PATCH), same
 * "at least one field" refinement `updatePrinterSchema` already
 * established -- an empty body is a client error, not a silent no-op. */
export const updateProductSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    category: z.string().max(100).optional(),
    unit: z.string().max(50).optional(),
    taxRateBasisPoints: z.number().int().min(0).max(10_000).optional(),
    printerRequirements: productPrinterRequirementsSchema.optional(),
    paperRequirements: productPaperRequirementsSchema.optional(),
    available: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided.",
  });

export type UpdateProductInput = z.infer<typeof updateProductSchema>;
