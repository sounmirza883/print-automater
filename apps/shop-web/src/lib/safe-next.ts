/** The post-sign-in destination from `?next=`. Only a same-origin,
 * absolute PATH is honoured: anything else (`https://evil.example`,
 * `//evil.example`, `/\evil.example`, `javascript:`) falls back to the
 * dashboard, so the sign-in page can never be turned into an open
 * redirect. */
export function safeNextPath(next: string | null | undefined, fallback = "/dashboard"): string {
  if (typeof next !== "string" || !next.startsWith("/")) {
    return fallback;
  }
  if (next.startsWith("//") || next.startsWith("/\\") || /[\r\n\0]/.test(next)) {
    return fallback;
  }
  return next;
}
