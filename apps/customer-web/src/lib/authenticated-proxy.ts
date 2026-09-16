import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { webEnv } from "@/env";
import { ACCESS_TOKEN_COOKIE } from "@/lib/cookie-names";

/** The shared plumbing behind every `/api/documents*` route handler:
 * read the httpOnly access-token cookie server-side, forward the
 * request to the real backend as `Authorization: Bearer <token>`, and
 * relay whatever it says back verbatim -- including a 401. This
 * deliberately does NOT try to refresh an expired token itself: the
 * browser's own `CookieAuthStrategy` (packages/api-client, 3.1) already
 * owns that single-flight refresh-and-retry logic, keyed off exactly
 * this 401, via `/api/auth/refresh` (3.3). Duplicating it here would
 * just be a second, easier-to-desync copy of the same behavior. */
export async function proxyAuthenticatedRequest(
  backendPath: string,
  init: { method: string; body?: unknown; headers?: Record<string, string> },
): Promise<NextResponse> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
  if (accessToken === undefined) {
    return NextResponse.json(
      {
        error_code: "UNAUTHENTICATED",
        message: "Not signed in.",
        retryable: false,
        request_id: "web",
      },
      { status: 401 },
    );
  }

  const backendResponse = await fetch(`${webEnv.NEXT_PUBLIC_API_BASE_URL}${backendPath}`, {
    method: init.method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  const payload: unknown = await backendResponse.json().catch(() => undefined);
  return NextResponse.json(payload, { status: backendResponse.status });
}
