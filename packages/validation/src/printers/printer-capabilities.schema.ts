import { z } from "zod";

/** Mirrors packages/types' `PrinterCapabilities` exactly -- all four
 * booleans together or not at all, the same "null means not yet
 * declared" convention Shop.capabilities already uses. A partial
 * declaration (e.g. just `color`) would be indistinguishable from
 * "duplex/a4/a3 are false", which is a claim about the physical
 * printer this endpoint has no basis for making. */
export const printerCapabilitiesSchema = z.object({
  color: z.boolean(),
  duplex: z.boolean(),
  a4: z.boolean(),
  a3: z.boolean(),
});

export type PrinterCapabilitiesInput = z.infer<typeof printerCapabilitiesSchema>;
