import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { webEnv } from "@/env";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  accessTokenCookieOptions,
  refreshTokenCookieOptions,
} from "@/lib/session";

/** What `CookieAuthStrategy.refresh()` (packages/api-client) calls when
 * a request from this app's own client-side code 401s. */
export async function POST(): Promise<NextResponse> {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get(REFRESH_TOKEN_COOKIE)?.value;
  if (!refreshToken) {
    return NextResponse.json(
      {
        error_code: "UNAUTHENTICATED",
        message: "No session to refresh.",
        retryable: false,
        request_id: "web",
      },
      { status: 401 },
    );
  }

  const backendResponse = await fetch(`${webEnv.NEXT_PUBLIC_API_BASE_URL}/v1/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });

  if (!backendResponse.ok) {
    // Mirrors BearerTokenAuthStrategy (packages/api-client): a rejected
    // refresh means the whole session is gone, not "try later" -- clear
    // both cookies so the next request is cleanly unauthenticated
    // rather than retrying a token that will never work again.
    cookieStore.delete(ACCESS_TOKEN_COOKIE);
    cookieStore.delete(REFRESH_TOKEN_COOKIE);
    const payload: unknown = await backendResponse.json();
    return NextResponse.json(payload, { status: backendResponse.status });
  }

  const { accessToken, refreshToken: newRefreshToken } = (await backendResponse.json()) as {
    accessToken: string;
    refreshToken: string;
  };
  cookieStore.set(ACCESS_TOKEN_COOKIE, accessToken, accessTokenCookieOptions());
  cookieStore.set(REFRESH_TOKEN_COOKIE, newRefreshToken, refreshTokenCookieOptions());

  return NextResponse.json({ ok: true });
}
