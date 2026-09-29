import { NextResponse } from "next/server";
import { webEnv } from "@/env";

/** The shared plumbing behind every `/api/public/shops/:shopId/*` route
 * handler -- the QR guest-ordering surface's own equivalent of
 * `authenticated-proxy.ts`, deliberately much simpler: there is no
 * session cookie to read, no bearer token to attach, and no 401/refresh
 * case to special-case, because the real backend routes this forwards
 * to (`PublicOrdersController`, 24.1) take no auth at all -- the
 * `:shopId` route param alone decides the shop. This just relays the
 * request and whatever the backend says back, verbatim. */
export async function proxyPublicRequest(
  backendPath: string,
  init: { method: string; body?: unknown; headers?: Record<string, string> },
): Promise<NextResponse> {
  const backendResponse = await fetch(`${webEnv.NEXT_PUBLIC_API_BASE_URL}${backendPath}`, {
    method: init.method,
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  // Same 204 gotcha `authenticated-proxy.ts` documents: NextResponse.json()
  // throws if handed a body-less status. None of this surface's own
  // routes return 204 today, but the guard costs nothing and keeps this
  // helper safe if one ever does.
  if (backendResponse.status === 204) {
    return new NextResponse(null, { status: 204 });
  }

  const payload: unknown = await backendResponse.json().catch(() => undefined);
  return NextResponse.json(payload, { status: backendResponse.status });
}
