import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { webEnv } from "@/env";
import { isBackOfficeRole } from "@/lib/permissions";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  SESSION_USER_COOKIE,
  accessTokenCookieOptions,
  refreshTokenCookieOptions,
  sessionUserCookieOptions,
} from "@/lib/session";

interface AuthResultPayload {
  user: { id: string; name: string; email: string; role: string };
  accessToken: string;
  refreshToken: string;
}

/** Calls the API's login endpoint and converts its JSON token pair into
 * this app's own httpOnly cookies; only `{ user }` reaches the browser.
 *
 * Unlike customer-web, sign-in is limited to back-office roles: a valid
 * CUSTOMER (or SUPPLIER) account is refused HERE, its just-issued refresh
 * token revoked, and no cookie is set, so a customer who wanders onto
 * the staff site learns where they belong instead of getting a shell with
 * nothing in it. (This is a UX gate; the API's own guards are what stop
 * a customer token from reading any business data.) */
export async function proxyLoginAndEstablishSession(body: unknown): Promise<NextResponse> {
  let backendResponse: Response;
  try {
    backendResponse = await fetch(`${webEnv.NEXT_PUBLIC_API_BASE_URL}/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return jsonError(502, "UPSTREAM_UNREACHABLE", "The service is unreachable right now.");
  }
  const payload: unknown = await backendResponse.json().catch(() => undefined);

  if (!backendResponse.ok) {
    return NextResponse.json(payload ?? {}, { status: backendResponse.status });
  }

  const { user, accessToken, refreshToken } = payload as AuthResultPayload;
  if (!isBackOfficeRole(user.role)) {
    await fetch(`${webEnv.NEXT_PUBLIC_API_BASE_URL}/v1/auth/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => undefined);
    return jsonError(
      403,
      "NOT_BACK_OFFICE_ACCOUNT",
      "This account is not part of a business. Customers sign in on the customer site.",
    );
  }

  const cookieStore = await cookies();
  cookieStore.set(ACCESS_TOKEN_COOKIE, accessToken, accessTokenCookieOptions());
  cookieStore.set(REFRESH_TOKEN_COOKIE, refreshToken, refreshTokenCookieOptions());
  cookieStore.set(SESSION_USER_COOKIE, JSON.stringify(user), sessionUserCookieOptions());
  return NextResponse.json({ user });
}

export function jsonError(status: number, errorCode: string, message: string): NextResponse {
  return NextResponse.json(
    { error_code: errorCode, message, retryable: false, request_id: "web" },
    { status },
  );
}
