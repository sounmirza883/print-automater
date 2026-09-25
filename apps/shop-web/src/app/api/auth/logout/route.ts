import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { webEnv } from "@/env";
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, SESSION_USER_COOKIE } from "@/lib/session";

export async function POST(): Promise<NextResponse> {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get(REFRESH_TOKEN_COOKIE)?.value;

  if (refreshToken) {
    // Best-effort revoke; the cookies are cleared below regardless, so a
    // flaky backend never leaves the browser looking signed in.
    await fetch(`${webEnv.NEXT_PUBLIC_API_BASE_URL}/v1/auth/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => undefined);
  }

  cookieStore.delete(ACCESS_TOKEN_COOKIE);
  cookieStore.delete(REFRESH_TOKEN_COOKIE);
  cookieStore.delete(SESSION_USER_COOKIE);

  return NextResponse.json({ ok: true });
}
