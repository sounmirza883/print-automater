import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_TOKEN_COOKIE } from "@/lib/cookie-names";

/** Presence-only check, not a signature/expiry verification -- the
 * access token's actual validity is enforced where it matters, by
 * services/api's own `JwtAuthGuard` on every real request that carries
 * it. This gate exists only to keep an unauthenticated browser off the
 * dashboard shell's pixels; a since-expired cookie still gets past it
 * and then fails for real the first time the page tries to use the
 * token, which the client-side `CookieAuthStrategy` refresh-on-401 flow
 * (packages/api-client, Phase 3.1) already handles. */
export function middleware(request: NextRequest): NextResponse {
  const hasSession = request.cookies.has(ACCESS_TOKEN_COOKIE);
  if (!hasSession) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/upload/:path*"],
};
