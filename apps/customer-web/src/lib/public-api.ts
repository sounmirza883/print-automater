/** Fix wave 1: the QR guest flow's browser code calls the API's own public
 * routes (`/v1/public/shops/:shopId/*`) directly, cross-origin -- there is no
 * same-origin proxy on this app's server any more. Those routes take no auth at
 * all, so a proxy protected nothing, and it made every guest on every shop reach
 * the API from ONE address (this app's server): a single per-IP rate-limit
 * bucket that a few dozen junk requests could exhaust platform-wide. Called
 * directly, the API keys each guest by their own IP (its TRUST_PROXY_HOPS), and
 * admits this app's origin through its CORS_ALLOWED_ORIGINS.
 *
 * `NEXT_PUBLIC_API_BASE_URL` is inlined into the client bundle at build time;
 * Next.js only replaces the literal `process.env.NEXT_PUBLIC_API_BASE_URL`
 * expression, so it stays spelled out in full here. The same variable is
 * validated server-side by `src/env.ts` (loaded by the root layout), so a
 * `next build` without a real URL fails there instead of shipping a bundle
 * that quietly calls relative paths on this app's own origin. */
export function publicApiUrl(path: string): string {
  const base = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/+$/, "");
  return `${base}${path}`;
}

/** What a guest sees when a call got no answer at all: `fetch` rejects rather
 * than resolving when the network is down or the API's CORS headers refuse
 * this origin, and that must end in a message, not a spinner that never stops. */
export const UNREACHABLE_MESSAGE =
  "Could not reach the print service. Check your connection and try again.";

/** Words for a failed public API call. A 429 is the API's per-IP rate limit:
 * its `Retry-After` (seconds; exposed to browser code by the API's CORS
 * config) says when this guest's budget refills, which beats the backend's
 * generic "try again later". Anything else is the backend's own message, or
 * `fallback` when the body has none. */
export async function publicErrorMessage(response: Response, fallback: string): Promise<string> {
  if (response.status === 429) {
    return rateLimitedMessage(response.headers.get("Retry-After"));
  }
  const body = (await response.json().catch(() => undefined)) as { message?: unknown } | undefined;
  return typeof body?.message === "string" ? body.message : fallback;
}

export function rateLimitedMessage(retryAfter: string | null): string {
  const lead = "Too many attempts from this connection.";
  const seconds = retryAfter === null || retryAfter.trim() === "" ? NaN : Number(retryAfter);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return `${lead} Please wait a while and try again.`;
  }
  if (seconds < 60) {
    const whole = Math.ceil(seconds);
    return `${lead} Please try again in ${whole} second${whole === 1 ? "" : "s"}.`;
  }
  const minutes = Math.ceil(seconds / 60);
  return `${lead} Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}
