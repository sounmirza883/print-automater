import { webEnv } from "@/env";

export { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, SESSION_USER_COOKIE } from "@/lib/cookie-names";

export interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
}

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Mirrors services/api's token TTLs (15m access / 30d refresh) so a
 * cookie never outlives the token it holds. */
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

/** Same lifetime as the refresh token: the display cookie lives as long
 * as the session can be renewed. */
export function sessionUserCookieOptions(): CookieOptions {
  return cookieOptions(REFRESH_TOKEN_TTL_SECONDS);
}
