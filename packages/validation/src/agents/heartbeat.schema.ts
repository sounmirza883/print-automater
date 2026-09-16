import { z } from "zod";
import { printerCapabilitiesSchema } from "../printers/printer-capabilities.schema.js";

/** §41/9.4, every 30s. `status` is deliberately narrower than the
 * full `PrinterStatus` enum -- an agent can only ever report ONLINE
 * (reachable, no error) or ERROR (reachable, but something's wrong);
 * OFFLINE is what the *backend* concludes when heartbeats stop
 * arriving at all, never something the agent itself claims about a
 * printer it's actively heartbeating for, and DISABLED is staff's own
 * operator override (8.4) that a heartbeat must never be able to
 * clobber. */
export const heartbeatSchema = z.object({
  printers: z.array(
    z.object({
      name: z.string().min(1),
      status: z.enum(["ONLINE", "ERROR"]),
      capabilities: printerCapabilitiesSchema.optional(),
    }),
  ),
});

export type HeartbeatInput = z.infer<typeof heartbeatSchema>;
