import { z } from "zod";

/** §20/§80/18.7. `reason` is required -- every manual reassignment is
 * audited (16.6's own pattern) with a human-readable "why," the same
 * "a picker/free-text reason, never optional" precedent §36's shop-
 * rejection reason already established. */
export const reassignJobSchema = z.object({
  printerId: z.string().uuid(),
  reason: z.string().min(1).max(500),
});

export type ReassignJobInput = z.infer<typeof reassignJobSchema>;
