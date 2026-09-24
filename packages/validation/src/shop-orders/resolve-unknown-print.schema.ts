import { z } from "zod";

/** §47/10.3. Maps onto order-state-machine.ts's own
 * RESOLVE_UNKNOWN_PRINTED/RETRY/FAILED events -- "change printer" is
 * deliberately not a resolution offered here, since it needs 10.4's
 * own job-reassignment mechanism (creating a new job id linked to the
 * original), which doesn't exist yet; staff can already fall back to
 * MARK_FAILED followed by 10.1's own Retry once that lands. */
export const resolveUnknownPrintSchema = z.object({
  resolution: z.enum(["CONFIRMED_PRINTED", "RETRY", "MARK_FAILED"]),
  /** 18.26: which UNKNOWN job the resolution is about. Required (409 otherwise)
   * when the order has more than one UNKNOWN job. */
  jobId: z.string().min(1).optional(),
});

export type ResolveUnknownPrintInput = z.infer<typeof resolveUnknownPrintSchema>;
