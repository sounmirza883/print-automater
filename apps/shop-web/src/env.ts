import { loadEnvOrExit, webEnvSchema, type WebEnv } from "@print-automated/config";

/** Validated once at module load (Next.js has already loaded `.env*`
 * into `process.env`), server-only: route handlers import this; nothing
 * under `src/app` reads `process.env` directly. Same pattern as
 * customer-web's env.ts. */
export const webEnv: WebEnv = loadEnvOrExit(webEnvSchema);
