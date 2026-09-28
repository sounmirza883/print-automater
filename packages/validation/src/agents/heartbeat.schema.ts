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
      // 15.6/§16. The agent's printer discovery (EnumPrinters, in
      // apps/printer-agent-cpp/src/printing/discovery.cpp) already
      // discovers these two -- this is the wire contract catching up
      // to data the agent was silently dropping, not new hardware
      // access. Both optional for two independent reasons: an agent
      // built before 15.6 sends neither at all (must not be treated
      // as "clear the value"), and the agent itself omits either one
      // on a given beat when it's unchanged since the last beat it
      // sent, the same "don't resend/reclobber what hasn't moved"
      // rule 15.2 established for `capabilities`.
      //
      // Deliberately NOT added here: page counters or consumable
      // (toner/ink) state. Neither `Get-Printer` nor
      // `Get-PrintConfiguration` -- the only two calls
      // discovery.ts actually makes -- exposes either one; a
      // driver-specific WMI class (e.g. `Win32_Printer`'s own
      // counters are unreliable/driver-dependent, and toner level
      // has no standard WMI/PowerShell surface at all) would be
      // needed, and none is wired up. Adding fields for data the
      // agent can't actually produce would freeze a wire contract
      // (this sub-phase's whole point) around a lie every future
      // beat would silently satisfy with an absent/empty value.
      driverName: z.string().min(1).optional(),
      portName: z.string().min(1).optional(),
    }),
  ),
});

export type HeartbeatInput = z.infer<typeof heartbeatSchema>;
