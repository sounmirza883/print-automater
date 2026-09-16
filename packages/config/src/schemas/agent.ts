import { z } from "zod";
import { baseEnvSchema } from "./base.js";

export const agentEnvSchema = baseEnvSchema.extend({
  API_BASE_URL: z.string().url(),
  // §9.9/13.3: bundled alongside the packaged agent in the eventual
  // installer; defaults to bare "SumatraPDF.exe" for dev, relying on
  // PATH, since nothing bundles it yet.
  SUMATRA_PATH: z.string().default("SumatraPDF.exe"),
  // 11.6: how long a *resolved* ledger row (PRINTED or FAILED) survives
  // before the periodic sweep prunes it -- an UNKNOWN row is never
  // pruned by this window at all (see ledger-sweep.ts's own comment),
  // since the agent has no way to learn a human ever resolved it.
  LEDGER_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
});

export type AgentEnv = z.infer<typeof agentEnvSchema>;
