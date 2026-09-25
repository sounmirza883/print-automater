/** Pure helpers for the `/api/v1/*` BFF proxy (kept free of `next/*` and
 * env imports so they are unit-testable). */

/** What the browser may reach through the proxy: exactly the API areas
 * this console uses. Anything else 404s here without ever reaching the
 * backend, so the proxy is not a general-purpose open relay to every
 * route (auth, agents, payments, documents ...). Server-side guards
 * remain the real authorization. */
const ALLOWED_PREFIXES: readonly string[] = ["shop", "notifications", "admin"];

export type ResolvedPath = { ok: true; backendPath: string } | { ok: false };

/** Turns the catch-all `path` segments (`["shop","dashboard","owner"]`)
 * into `/v1/shop/dashboard/owner`, refusing empty, dot or separator
 * segments (Next decodes `%2e%2e` and `%2f` before we see them) and any
 * area outside the allow-list. */
export function resolveBackendPath(segments: readonly string[]): ResolvedPath {
  if (segments.length === 0) {
    return { ok: false };
  }
  // The route is mounted at /api/v1, so `segments` starts after "v1".
  const [area] = segments;
  if (area === undefined || !ALLOWED_PREFIXES.includes(area)) {
    return { ok: false };
  }
  for (const segment of segments) {
    if (segment.length === 0 || /^\.+$/.test(segment) || /[/\\?#\0]/.test(segment)) {
      return { ok: false };
    }
  }
  return { ok: true, backendPath: `/v1/${segments.map(encodeURIComponent).join("/")}` };
}

/** CSRF hygiene for state-changing calls. Cookies are SameSite=Lax, and
 * `localhost:3001` (customer-web) is same-SITE with `localhost:3002`, so
 * SameSite alone does not stop a sibling app's page from posting here.
 * A mutating request that carries an `Origin` must carry OUR origin.
 * (Non-browser callers send no Origin and have no cookies to abuse.) */
export function isSameOriginMutation(method: string, origin: string | null, host: string): boolean {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return true;
  }
  if (origin === null) {
    return true;
  }
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
