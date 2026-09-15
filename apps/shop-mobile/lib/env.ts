/** Expo inlines `EXPO_PUBLIC_`-prefixed vars from `.env`/`.env.local` at
 * bundle time (the RN/Metro equivalent of Next's `NEXT_PUBLIC_`
 * convention, packages/config's `webEnvSchema` for customer-web). No
 * `loadEnvOrExit`-style hard failure here: unlike a Node server
 * process, there is no single "boot" moment to fail fast at -- a
 * misconfigured value is caught the first time a screen tries to reach
 * the API, same as any other mobile app. */
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3000";
