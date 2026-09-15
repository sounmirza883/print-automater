import { z } from "zod";
import { baseEnvSchema } from "./base.js";

export const agentEnvSchema = baseEnvSchema.extend({
  API_BASE_URL: z.string().url(),
});

export type AgentEnv = z.infer<typeof agentEnvSchema>;
