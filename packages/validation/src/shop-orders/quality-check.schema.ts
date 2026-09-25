import { z } from "zod";
import { ReprintReason } from "@print-automated/types";

/** 21.3 (§68). The three verdicts the PRD names: Passed, Failed, Needs reprint.
 * `jobIds` (NEEDS_REPRINT only) names which printed jobs to reprint; omitted
 * means every printed job of the order. */
export const QUALITY_CHECK_RESULTS = ["PASSED", "FAILED", "NEEDS_REPRINT"] as const;

export const qualityCheckSchema = z
  .object({
    result: z.enum(QUALITY_CHECK_RESULTS),
    note: z.string().trim().min(1).max(500).optional(),
    jobIds: z.array(z.string().uuid()).min(1).max(50).optional(),
    /** NEEDS_REPRINT only: recorded on the reprint (default POOR_QUALITY: the
     * check found the output wanting) and the extra cost, if any. */
    reprintReason: z.nativeEnum(ReprintReason).optional(),
    additionalCostMinor: z.number().int().min(0).max(1_000_000_000).optional(),
  })
  .refine(
    (input) =>
      input.result === "NEEDS_REPRINT" ||
      (input.jobIds === undefined &&
        input.reprintReason === undefined &&
        input.additionalCostMinor === undefined),
    {
      message: "jobIds, reprintReason and additionalCostMinor are only valid with NEEDS_REPRINT.",
      path: ["jobIds"],
    },
  );

export type QualityCheckInput = z.infer<typeof qualityCheckSchema>;
