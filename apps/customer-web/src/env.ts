import { loadEnvOrExit, webEnvSchema, type WebEnv } from "@print-automated/config";

/** Next.js loads `.env*` files into `process.env` itself before any
 * app code runs, so this is a plain module-load-time parse (no
 * `dotenv/config` needed, unlike services/api's main.ts) -- validated
 * once, reused everywhere via ES module caching, same pattern as
 * services/api/src/config/config.module.ts. Server-only: the root layout
 * imports it (fix wave 1 -- see the note there) so the build and the
 * server both refuse to run without a valid NEXT_PUBLIC_API_BASE_URL.
 * The browser reads that same inlined value in `lib/public-api.ts`. */
export const webEnv: WebEnv = loadEnvOrExit(webEnvSchema);
