import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "@/lib/cookie-names";

/** Presence-only gate: keeps an unauthenticated browser off the console
 * shell. The access cookie lives 15 minutes, so a person who returns
 * after a coffee has only the refresh cookie; that still counts as a
 * session here (the first data call 401s, the client refreshes, and a
 * refresh that fails sends them to /login). Validity is enforced where
 * it matters: the API's own guards on every real request.
 *
 * `/login`, `/accept-invite` (an invitee cannot sign in until they have
 * accepted), `/set-up-account` (fix wave 1: a new business owner has no
 * password until they use their emailed code there), `/api/*` and static
 * assets are excluded by the matcher; the API routes answer 401 themselves. */
export function middleware(request: NextRequest): NextResponse {
  const hasSession =
    request.cookies.has(ACCESS_TOKEN_COOKIE) || request.cookies.has(REFRESH_TOKEN_COOKIE);
  if (!hasSession) {
    const loginUrl = new URL("/login", request.url);
    const target = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    if (target !== "/") {
      loginUrl.searchParams.set("next", target);
    }
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/|_next/|login|accept-invite|set-up-account|favicon.ico).*)"],
};
