import { z } from "zod";

/** 21.3 (§68). The three verdicts the PRD names: Passed, Failed, Needs reprint.
 * `jobIds` (NEEDS_REPRINT only) names which printed jobs to reprint; omitted
 * means every printed job of the order. */
export const QUALITY_CHECK_RESULTS = ["PASSED", "FAILED", "NEEDS_REPRINT"] as const;

export const qualityCheckSchema = z
  .object({
    result: z.enum(QUALITY_CHECK_RESULTS),
    note: z.string().trim().min(1).max(500).optional(),
    jobIds: z.array(z.string().uuid()).min(1).max(50).optional(),
  })
  .refine((input) => input.result === "NEEDS_REPRINT" || input.jobIds === undefined, {
    message: "jobIds is only valid with NEEDS_REPRINT.",
    path: ["jobIds"],
  });

export type QualityCheckInput = z.infer<typeof qualityCheckSchema>;
