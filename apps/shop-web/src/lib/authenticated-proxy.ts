import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { webEnv } from "@/env";
import { ACCESS_TOKEN_COOKIE } from "@/lib/cookie-names";
import { isSameOriginMutation, resolveBackendPath } from "@/lib/proxy-path";

function errorResponse(status: number, errorCode: string, message: string): NextResponse {
  return NextResponse.json(
    { error_code: errorCode, message, retryable: false, request_id: "web" },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/** Request headers worth forwarding. `Idempotency-Key` matters for the
 * stock-movement / reprint calls later screens make; everything else
 * (cookies, host, origin) is deliberately NOT forwarded. */
const FORWARDED_REQUEST_HEADERS = ["content-type", "accept", "idempotency-key"] as const;
const FORWARDED_RESPONSE_HEADERS = ["content-type", "retry-after", "x-request-id"] as const;

/** The BFF: read the httpOnly access-token cookie server-side, forward
 * the call to the real API as `Authorization: Bearer <token>`, relay the
 * answer verbatim (including 401/403/409 bodies, which the UI branches
 * on). Like customer-web's proxy it does NOT refresh an expired token
 * itself: the browser-side `CookieAuthStrategy` owns single-flight
 * refresh-and-retry, keyed off exactly the 401 this returns, through
 * `/api/auth/refresh`. No access cookie at all also answers 401, which
 * is what triggers that refresh once the 15-minute cookie has lapsed. */
export async function proxyToBackend(
  request: NextRequest,
  segments: readonly string[],
): Promise<NextResponse> {
  const resolved = resolveBackendPath(segments);
  if (!resolved.ok) {
    return errorResponse(404, "NOT_FOUND", "Unknown API route.");
  }
  if (!isSameOriginMutation(request.method, request.headers.get("origin"), requestHost(request))) {
    return errorResponse(403, "CROSS_ORIGIN_BLOCKED", "Cross-origin request refused.");
  }

  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
  if (accessToken === undefined) {
    return errorResponse(401, "UNAUTHENTICATED", "Not signed in.");
  }

  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) {
      headers[name] = value;
    }
  }

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  let backendResponse: Response;
  try {
    backendResponse = await fetch(
      `${webEnv.NEXT_PUBLIC_API_BASE_URL}${resolved.backendPath}${request.nextUrl.search}`,
      {
        method: request.method,
        headers,
        body: hasBody ? await request.text() : undefined,
        cache: "no-store",
      },
    );
  } catch {
    return errorResponse(502, "UPSTREAM_UNREACHABLE", "The service is unreachable right now.");
  }

  // The HTTP spec forbids a body on 204 (see customer-web's proxy).
  const relayed = new Headers({ "Cache-Control": "no-store" });
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = backendResponse.headers.get(name);
    if (value !== null) {
      relayed.set(name, value);
    }
  }
  if (backendResponse.status === 204) {
    return new NextResponse(null, { status: 204, headers: relayed });
  }
  // 27.2: an SSE stream (services/api's `Sse("live")`) never "completes" the way an ordinary
  // response does, so buffering it with .arrayBuffer() below would make the browser's
  // EventSource wait for the connection to CLOSE before seeing anything -- the opposite of what
  // it's for. Passed through as a ReadableStream instead, chunk by chunk, exactly like every
  // other response is passed through byte for byte; ordinary JSON responses are unaffected
  // (still buffered), since streaming them would only add complexity for no benefit.
  if (backendResponse.headers.get("content-type")?.startsWith("text/event-stream")) {
    return new NextResponse(backendResponse.body, {
      status: backendResponse.status,
      headers: relayed,
    });
  }
  return new NextResponse(await backendResponse.arrayBuffer(), {
    status: backendResponse.status,
    headers: relayed,
  });
}

function requestHost(request: NextRequest): string {
  return request.headers.get("host") ?? request.nextUrl.host;
}
