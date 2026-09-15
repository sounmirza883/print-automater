/** Deliberately the only thing `middleware.ts` imports from this app's
 * auth code: middleware runs on Next's Edge runtime, which has no
 * `process.exit` -- importing `session.ts` (which pulls in `env.ts`'s
 * `loadEnvOrExit`) from there would crash middleware at the module-load
 * step, not just fail gracefully. This module has zero dependencies so
 * it's safe on both the Edge and Node runtimes. */
export const ACCESS_TOKEN_COOKIE = "access_token";
export const REFRESH_TOKEN_COOKIE = "refresh_token";
