import { z } from "zod";
import { PaperSize, PaperType } from "@print-automated/types";
import { printerCapabilitiesSchema } from "../printers/printer-capabilities.schema.js";

/** 17.1: `Product.printerRequirements` mirrors `PrinterCapabilities`
 * exactly -- reusing printerCapabilitiesSchema rather than a second,
 * parallel shape for "what this product needs a printer to support."
 */
export const productPrinterRequirementsSchema = printerCapabilitiesSchema;

/** 17.1: `Product.paperRequirements` mirrors `PrintConfiguration`'s own
 * paperSize/paperType fields (15.1/§64) -- the same closed vocabulary
 * a print job's own configuration already uses, both optional since a
 * product may only care about one or neither. */
export const productPaperRequirementsSchema = z.object({
  paperSize: z.nativeEnum(PaperSize).optional(),
  paperType: z.nativeEnum(PaperType).optional(),
});

export type ProductPaperRequirementsInput = z.infer<typeof productPaperRequirementsSchema>;
