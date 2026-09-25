import { z } from "zod";

/** 21.1 (§65). Pausing is a deliberate operator hold; the optional reason is
 * free text kept in the audit row (a picker is only required for FAILURES, §66). */
export const pauseJobSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional(),
});

export type PauseJobInput = z.infer<typeof pauseJobSchema>;
