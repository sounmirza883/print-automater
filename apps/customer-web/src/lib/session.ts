import { webEnv } from "@/env";

export { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "@/lib/cookie-names";

/** The subset of `next/headers`' `cookies().set()` options this module
 * needs. Not imported from Next's own types -- there is no stable
 * public export for this shape, only internal compiled paths -- so
 * this is a small structural interface instead, matched by TypeScript
 * against whatever `.set()` actually accepts. */
export interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
}

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Mirrors services/api/src/auth/token.service.ts's own TTLs (15m
 * access / 30d refresh) so the cookie never outlives the token it
 * holds. */
function cookieOptions(maxAgeSeconds: number): CookieOptions {
  return {
    httpOnly: true,
    secure: webEnv.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export function accessTokenCookieOptions(): CookieOptions {
  return cookieOptions(ACCESS_TOKEN_TTL_SECONDS);
}

export function refreshTokenCookieOptions(): CookieOptions {
  return cookieOptions(REFRESH_TOKEN_TTL_SECONDS);
}
