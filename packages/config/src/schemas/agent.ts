import { z } from "zod";
import { baseEnvSchema } from "./base.js";

export const agentEnvSchema = baseEnvSchema.extend({
  API_BASE_URL: z.string().url(),
  // §9.9/13.3: bundled alongside the packaged agent in the eventual
  // installer; defaults to bare "SumatraPDF.exe" for dev, relying on
  // PATH, since nothing bundles it yet.
  SUMATRA_PATH: z.string().default("SumatraPDF.exe"),
});

export type AgentEnv = z.infer<typeof agentEnvSchema>;
