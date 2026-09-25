import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { webEnv } from "@/env";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  SESSION_USER_COOKIE,
  accessTokenCookieOptions,
  refreshTokenCookieOptions,
} from "@/lib/session";

type RefreshOutcome =
  | { ok: true; accessToken: string; refreshToken: string }
  | { ok: false; status: number; payload: unknown };

/** The API rotates refresh tokens and treats a REUSED one as theft
 * (revokes the whole family). Two browser tabs whose access cookie lapsed
 * together each fire a refresh carrying the SAME old token; without this
 * the second one would trip reuse detection and sign the person out. So
 * concurrent refreshes for one token share one backend call, and every
 * caller then sets the cookies from that single result. (Per Node
 * process; a multi-instance deployment would need sticky sessions or a
 * short server-side grace window -- noted as a carry-forward.) */
const inFlight = new Map<string, Promise<RefreshOutcome>>();

function refreshOnce(refreshToken: string): Promise<RefreshOutcome> {
  const existing = inFlight.get(refreshToken);
  if (existing) {
    return existing;
  }
  const started = (async (): Promise<RefreshOutcome> => {
    try {
      const response = await fetch(`${webEnv.NEXT_PUBLIC_API_BASE_URL}/v1/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          payload: await response.json().catch(() => ({})),
        };
      }
      const tokens = (await response.json()) as { accessToken: string; refreshToken: string };
      return { ok: true, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
    } catch {
      return { ok: false, status: 502, payload: unavailablePayload() };
    }
  })().finally(() => {
    // Keep the settled result briefly so a tab that arrives a beat late
    // (same old token) still gets the new pair instead of a reuse alarm.
    setTimeout(() => inFlight.delete(refreshToken), 10_000).unref?.();
  });
  inFlight.set(refreshToken, started);
  return started;
}

function unavailablePayload(): unknown {
  return {
    error_code: "UPSTREAM_UNREACHABLE",
    message: "The service is unreachable right now.",
    retryable: true,
    request_id: "web",
  };
}

/** What `CookieAuthStrategy.refresh()` (packages/api-client) calls when a
 * request from this app's client-side code 401s. */
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

  const outcome = await refreshOnce(refreshToken);
  if (!outcome.ok) {
    // A rejected refresh (401/403) means the session is gone: clear it so
    // the next request is cleanly unauthenticated. A transient failure
    // (5xx / unreachable) keeps the cookies so a retry can still succeed.
    if (outcome.status === 401 || outcome.status === 403) {
      cookieStore.delete(ACCESS_TOKEN_COOKIE);
      cookieStore.delete(REFRESH_TOKEN_COOKIE);
      cookieStore.delete(SESSION_USER_COOKIE);
    }
    return NextResponse.json(outcome.payload, { status: outcome.status });
  }

  cookieStore.set(ACCESS_TOKEN_COOKIE, outcome.accessToken, accessTokenCookieOptions());
  cookieStore.set(REFRESH_TOKEN_COOKIE, outcome.refreshToken, refreshTokenCookieOptions());
  return NextResponse.json({ ok: true });
}
