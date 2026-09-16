import { z } from "zod";
import { printerCapabilitiesSchema } from "./printer-capabilities.schema.js";

/** §38/8.4's "rename, enable/disable" -- deliberately `enabled:
 * boolean`, not the full 4-value PrinterStatus. ONLINE/ERROR are
 * agent-reported (9.4/9.11), not something a shop operator sets by
 * hand; this endpoint can only ever move a printer to/from DISABLED
 * (enabled: false) or its non-disabled default (enabled: true ->
 * OFFLINE, until an agent's own heartbeat says otherwise). */
export const updatePrinterSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    enabled: z.boolean().optional(),
    capabilities: printerCapabilitiesSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided.",
  });

export type UpdatePrinterInput = z.infer<typeof updatePrinterSchema>;
