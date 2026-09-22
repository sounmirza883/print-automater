import { z } from "zod";

/**
 * A boolean env var that's actually safe against the literal string
 * "false". `z.coerce.boolean()` runs `Boolean(value)` under the hood,
 * and `Boolean("false")` is `true` in JS -- so any env var written as
 * `FOO=false` (exactly what every .env.example in this repo does)
 * silently coerces to `true`. Found via code review on SMTP_SECURE
 * (14.5), which is the first boolean field whose *documented default*
 * is `false` and therefore the first one where the bug isn't
 * accidentally harmless. `CLAMAV_ENABLED`/`S3_FORCE_PATH_STYLE` carry
 * the same latent bug -- fixed here too since it's the same one-line
 * cause, even though both are always set to the literal `true` today.
 *
 * Only the strings "true"/"1" parse as `true`; "false"/"0"/"" parse as
 * `false`; anything else is a validation error rather than a silent
 * guess, matching this schema layer's own fail-fast philosophy.
 */
export function zBooleanString(defaultValue: boolean) {
  return z.preprocess((value) => {
    if (typeof value !== "string") return value;
    if (value === "true" || value === "1") return true;
    if (value === "false" || value === "0" || value === "") return false;
    return value; // let z.boolean() below reject anything else with a normal Zod issue
  }, z.boolean().default(defaultValue));
}

export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "staging", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;
