import { z } from "zod";

export const authenticateChallengeSchema = z.object({
  deviceId: z.string().uuid(),
});

export type AuthenticateChallengeInput = z.infer<typeof authenticateChallengeSchema>;
