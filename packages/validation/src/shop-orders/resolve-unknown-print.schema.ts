import { z } from "zod";
import { JobFailureReason } from "@print-automated/types";

/** §47/10.3. Maps onto order-state-machine.ts's own
 * RESOLVE_UNKNOWN_PRINTED/RETRY/FAILED events -- "change printer" is
 * deliberately not a resolution offered here, since it needs 10.4's
 * own job-reassignment mechanism (creating a new job id linked to the
 * original), which doesn't exist yet; staff can already fall back to
 * MARK_FAILED followed by 10.1's own Retry once that lands.
 *
 * 21.2 (§66): MARK_FAILED may carry the operator's failure-reason pick (and
 * note) so it is recorded in the same write that fails the job. Offering one
 * with any other resolution is a 400: it would land on a job that did not fail. */
export const resolveUnknownPrintSchema = z
  .object({
    resolution: z.enum(["CONFIRMED_PRINTED", "RETRY", "MARK_FAILED"]),
    /** 18.26: which UNKNOWN job the resolution is about. Required (409 otherwise)
     * when the order has more than one UNKNOWN job. */
    jobId: z.string().min(1).optional(),
    failureReason: z.nativeEnum(JobFailureReason).optional(),
    failureNote: z.string().trim().min(1).max(500).optional(),
  })
  .refine(
    (input) =>
      input.resolution === "MARK_FAILED" ||
      (input.failureReason === undefined && input.failureNote === undefined),
    {
      message: "failureReason/failureNote are only valid with MARK_FAILED.",
      path: ["failureReason"],
    },
  );

export type ResolveUnknownPrintInput = z.infer<typeof resolveUnknownPrintSchema>;
