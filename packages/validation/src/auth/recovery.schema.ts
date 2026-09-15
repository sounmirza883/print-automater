import { z } from "zod";

/** §70 POST /auth/recovery. */
export const recoverySchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

export type RecoveryInput = z.infer<typeof recoverySchema>;
