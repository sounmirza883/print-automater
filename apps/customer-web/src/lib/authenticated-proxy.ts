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

  // §2.5/§71's own DELETE /documents/:id (only discovered missing while
  // building 13.1's golden path) is the first call through this proxy
  // that ever gets a 204 back -- every other route this helper serves
  // returns 200 with a real body. The HTTP spec forbids a body on 204
  // (and 205/304), and NextResponse.json() throws internally if given
  // one anyway, surfacing as an opaque 500 with no error body at all --
  // exactly what a real DELETE call through this exact path produced
  // before this check existed.
  if (backendResponse.status === 204) {
    return new NextResponse(null, { status: 204 });
  }

  const payload: unknown = await backendResponse.json().catch(() => undefined);
  return NextResponse.json(payload, { status: backendResponse.status });
}
