import { z } from "zod";

/** 21.1 (§65). Resume re-runs allocation. `printerId` optionally names the
 * printer explicitly (a staff override, like reassign). `acknowledgeLatePrint`
 * must be true to resume a job held because a late PRINTED report suggests the
 * same item's paper may already exist (duplicate printing is the cardinal rule). */
export const resumeJobSchema = z.object({
  printerId: z.string().uuid().optional(),
  acknowledgeLatePrint: z.boolean().optional(),
});

export type ResumeJobInput = z.infer<typeof resumeJobSchema>;
