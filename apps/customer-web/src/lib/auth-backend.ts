import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { webEnv } from "@/env";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  accessTokenCookieOptions,
  refreshTokenCookieOptions,
} from "@/lib/session";

interface AuthResultPayload {
  user: { id: string; name: string; email: string; role: string };
  accessToken: string;
  refreshToken: string;
}

/** Calls a services/api endpoint that returns a fresh session
 * (register/login), then converts its JSON token pair into this app's
 * own httpOnly cookies -- the one place that conversion happens, since
 * register and login are otherwise identical past this point. Only
 * `{ user }` ever reaches the browser; the raw tokens never leave this
 * server. services/api itself is deliberately cookie-agnostic (see
 * packages/validation's refresh.schema.ts) -- turning its JSON tokens
 * into an httpOnly cookie is this app's job, not the backend's. */
export async function proxyAuthAndEstablishSession(
  backendPath: string,
  body: unknown,
): Promise<NextResponse> {
  const backendResponse = await fetch(`${webEnv.NEXT_PUBLIC_API_BASE_URL}${backendPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload: unknown = await backendResponse.json();

  if (!backendResponse.ok) {
    return NextResponse.json(payload, { status: backendResponse.status });
  }

  const { user, accessToken, refreshToken } = payload as AuthResultPayload;
  const cookieStore = await cookies();
  cookieStore.set(ACCESS_TOKEN_COOKIE, accessToken, accessTokenCookieOptions());
  cookieStore.set(REFRESH_TOKEN_COOKIE, refreshToken, refreshTokenCookieOptions());

  return NextResponse.json({ user });
}

export function validationErrorResponse(message: string): NextResponse {
  return NextResponse.json(
    { error_code: "VALIDATION_FAILED", message, retryable: false, request_id: "web" },
    { status: 400 },
  );
}
