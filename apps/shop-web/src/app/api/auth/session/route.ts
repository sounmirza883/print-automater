import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isBackOfficeRole } from "@/lib/permissions";
import { REFRESH_TOKEN_COOKIE, SESSION_USER_COOKIE } from "@/lib/cookie-names";

/** Who the shell should say is signed in. Reads only the display cookie
 * set at sign-in (no backend call, so it is cheap and never 401s from an
 * expired access token); the business list and every permission decision
 * come from the API through the proxy. */
export async function GET(): Promise<NextResponse> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(SESSION_USER_COOKIE)?.value;
  const hasSession = cookieStore.has(REFRESH_TOKEN_COOKIE);
  if (raw === undefined || !hasSession) {
    return unauthenticated();
  }
  try {
    const user = JSON.parse(raw) as {
      id?: unknown;
      name?: unknown;
      email?: unknown;
      role?: unknown;
    };
    if (
      typeof user.id !== "string" ||
      typeof user.name !== "string" ||
      typeof user.email !== "string" ||
      typeof user.role !== "string" ||
      !isBackOfficeRole(user.role)
    ) {
      return unauthenticated();
    }
    return NextResponse.json(
      { user: { id: user.id, name: user.name, email: user.email, role: user.role } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return unauthenticated();
  }
}

function unauthenticated(): NextResponse {
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
