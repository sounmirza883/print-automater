import { z } from "zod";
import { JobFailureReason } from "@print-automated/types";

/** 21.2 (§66). The operator picks from the fixed list (not free text, the
 * ShopRejectionReason precedent); the note is optional colour beside it. */
export const recordFailureReasonSchema = z.object({
  reason: z.nativeEnum(JobFailureReason),
  note: z.string().trim().min(1).max(500).optional(),
});

export type RecordFailureReasonInput = z.infer<typeof recordFailureReasonSchema>;
