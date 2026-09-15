import { z } from "zod";
import { baseEnvSchema } from "./base.js";

export const webEnvSchema = baseEnvSchema.extend({
  NEXT_PUBLIC_API_BASE_URL: z.string().url(),
});

export type WebEnv = z.infer<typeof webEnvSchema>;
