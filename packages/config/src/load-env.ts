import type { z } from "zod";
import { EnvValidationError, type EnvIssue } from "./errors.js";

/**
 * Parses `source` against `schema`. On failure, collects EVERY invalid or
 * missing key into one EnvValidationError instead of throwing on the first
 * one, so a misconfigured environment fails with a complete, readable list
 * rather than a single opaque error followed by more errors on retry.
 */
export function loadEnv<Schema extends z.ZodType>(
  schema: Schema,
  source: Record<string, string | undefined> = process.env,
): z.infer<Schema> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues: EnvIssue[] = result.error.issues.map((issue) => ({
      path: issue.path.join(".") || "(root)",
      message: issue.message,
    }));
    throw new EnvValidationError(issues);
  }
  return result.data;
}

/**
 * Entry-point wrapper: loads env or prints the full issue list to stderr
 * and exits the process. Use this from service bootstrap files; use
 * loadEnv directly in tests, where a thrown error is preferable to exit().
 */
export function loadEnvOrExit<Schema extends z.ZodType>(
  schema: Schema,
  source: Record<string, string | undefined> = process.env,
): z.infer<Schema> {
  try {
    return loadEnv(schema, source);
  } catch (error) {
    if (error instanceof EnvValidationError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}
