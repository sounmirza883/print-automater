import { loadEnvOrExit, webEnvSchema, type WebEnv } from "@print-automated/config";

/** Next.js loads `.env*` files into `process.env` itself before any
 * app code runs, so this is a plain module-load-time parse (no
 * `dotenv/config` needed, unlike services/api's main.ts) -- validated
 * once, reused everywhere via ES module caching, same pattern as
 * services/api/src/config/config.module.ts. Route handlers import this
 * (server-only); nothing in `src/app` reads `process.env` directly. */
export const webEnv: WebEnv = loadEnvOrExit(webEnvSchema);
