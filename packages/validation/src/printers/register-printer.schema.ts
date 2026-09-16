import { z } from "zod";
import { printerCapabilitiesSchema } from "./printer-capabilities.schema.js";

/** §38/8.4's "register" action. Capabilities are optional at
 * registration -- a shop may register a printer before it's sure what
 * it can do; 4.3's shop discovery already treats an undeclared
 * capability as "matches nothing" rather than guessing, and printer
 * capability matching (10.4) will do the same once it exists. */
export const registerPrinterSchema = z.object({
  shopId: z.string().uuid(),
  name: z.string().min(1).max(200),
  capabilities: printerCapabilitiesSchema.optional(),
});

export type RegisterPrinterInput = z.infer<typeof registerPrinterSchema>;
