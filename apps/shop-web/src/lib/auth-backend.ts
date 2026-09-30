import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { webEnv } from "@/env";
import { isBackOfficeRole } from "@/lib/permissions";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  SESSION_USER_COOKIE,
  accessTokenCookieOptions,
  refreshTokenCookieOptions,
  sessionUserCookieOptions,
} from "@/lib/session";

interface AuthResultPayload {
  user: { id: string; name: string; email: string; role: string };
  accessToken: string;
  refreshToken: string;
}

type LoginOutcome = { ok: true; result: AuthResultPayload } | { ok: false; response: NextResponse };

const NOT_A_MEMBER =
  "This account is not part of a business. If you were invited, use Accept invitation; customers sign in on the customer site.";

const INVITE_INVALID =
  "This invitation code does not work for this account. It may have expired or already been used, or the invitation went to a different email address.";

const ACTIVATION_INVALID =
  "This code does not work with this email address. It may have expired, already been used, or been replaced by a newer code. Use the code from the most recent email, or ask your Print Automated administrator to send a new one. If you have already set your password, sign in instead.";

/** Calls the API's login endpoint and converts its JSON token pair into
 * this app's own httpOnly cookies; only `{ user }` reaches the browser.
 *
 * Unlike customer-web, sign-in is limited to people who work at a business
 * (or run the platform): anyone else is refused HERE, its just-issued refresh
 * token revoked, and no cookie is set, so a customer who wanders onto the
 * staff site learns where they belong instead of getting a shell with
 * nothing in it. (This is a UX gate; the API's own guards are what stop a
 * customer token from reading any business data.) */
export async function proxyLoginAndEstablishSession(body: unknown): Promise<NextResponse> {
  const login = await backendLogin(body);
  if (!login.ok) {
    return login.response;
  }
  const refused = await refuseUnlessAdmitted(login.result);
  if (refused !== null) {
    return refused;
  }
  await establishSession(login.result);
  return NextResponse.json({ user: login.result.user });
}

/** 23.23: redeem an emailed invitation in ONE step -- sign in, accept, then open a
 * session. An invitee usually cannot sign in first: until they accept they belong to no
 * business, so ordinary sign-in refuses them. The API decides everything (the code, and
 * that the account's email is the invited address); every refusal reads the same, so this
 * page cannot be used to learn which part was wrong, and the just-issued session is
 * revoked. */
export async function proxyAcceptInviteAndEstablishSession(input: {
  email: string;
  password: string;
  code: string;
}): Promise<NextResponse> {
  const login = await backendLogin({ email: input.email, password: input.password });
  if (!login.ok) {
    return login.response;
  }
  const { result } = login;
  let accepted: Response;
  try {
    accepted = await fetch(`${webEnv.NEXT_PUBLIC_API_BASE_URL}/v1/shop/staff-invites/accept`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${result.accessToken}`,
      },
      body: JSON.stringify({ token: input.code }),
    });
  } catch {
    await revoke(result.refreshToken);
    return jsonError(502, "UPSTREAM_UNREACHABLE", "The service is unreachable right now.");
  }
  if (!accepted.ok) {
    await revoke(result.refreshToken);
    if (accepted.status === 429) {
      return jsonError(429, "RATE_LIMITED", "Too many attempts. Wait a while and try again.");
    }
    if (accepted.status >= 500) {
      return jsonError(502, "UPSTREAM_UNREACHABLE", "The service is unreachable right now.");
    }
    return jsonError(404, "INVITE_INVALID", INVITE_INVALID);
  }
  const joined = (await accepted.json().catch(() => ({}))) as { shopId?: unknown };
  // They have just joined a business, so this admits them; it runs anyway so the
  // admission rule lives in one place.
  const refused = await refuseUnlessAdmitted(result);
  if (refused !== null) {
    return refused;
  }
  await establishSession(result);
  return NextResponse.json({
    user: result.user,
    shopId: typeof joined.shopId === "string" ? joined.shopId : null,
  });
}

/** Fix wave 1: the owner of an admin-created business sets their password with the
 * emailed code and lands in the console signed in, in ONE step. Unlike the two flows
 * above there is nothing to sign in with first (the account has no password yet): the
 * API's public, rate-limited `POST /shop/staff-invites/activate` checks the code and the
 * address, sets the password and answers with a session, which becomes this app's
 * cookies exactly as a login's does. Every refusal of the code reads the same (the API
 * deliberately gives one 404 for a wrong code, a wrong address, an expired or used code,
 * or an account that already has a password), so this page cannot be used to learn which
 * part was wrong. */
export async function proxyActivateAndEstablishSession(input: {
  email: string;
  token: string;
  password: string;
}): Promise<NextResponse> {
  let activated: Response;
  try {
    activated = await fetch(`${webEnv.NEXT_PUBLIC_API_BASE_URL}/v1/shop/staff-invites/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    return jsonError(502, "UPSTREAM_UNREACHABLE", "The service is unreachable right now.");
  }
  if (!activated.ok) {
    if (activated.status === 429) {
      return jsonError(429, "RATE_LIMITED", "Too many attempts. Wait a while and try again.");
    }
    if (activated.status >= 500) {
      return jsonError(502, "UPSTREAM_UNREACHABLE", "The service is unreachable right now.");
    }
    if (activated.status === 400) {
      // The route validated with the same schema first, so this is rare; the API's own
      // words say which field.
      const payload = (await activated.json().catch(() => ({}))) as { message?: unknown };
      return jsonError(
        400,
        "VALIDATION_FAILED",
        typeof payload.message === "string" ? payload.message : "Check the details and try again.",
      );
    }
    return jsonError(404, "ACTIVATION_INVALID", ACTIVATION_INVALID);
  }
  const result = (await activated.json()) as AuthResultPayload & { shopId?: unknown };
  // The account was created as a business owner, so this admits it; it runs anyway so
  // the admission rule lives in one place.
  const refused = await refuseUnlessAdmitted(result);
  if (refused !== null) {
    return refused;
  }
  await establishSession(result);
  return NextResponse.json({
    user: result.user,
    shopId: typeof result.shopId === "string" ? result.shopId : null,
  });
}

async function backendLogin(body: unknown): Promise<LoginOutcome> {
  let backendResponse: Response;
  try {
    backendResponse = await fetch(`${webEnv.NEXT_PUBLIC_API_BASE_URL}/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return {
      ok: false,
      response: jsonError(502, "UPSTREAM_UNREACHABLE", "The service is unreachable right now."),
    };
  }
  const payload: unknown = await backendResponse.json().catch(() => undefined);
  if (!backendResponse.ok) {
    return {
      ok: false,
      response: NextResponse.json(payload ?? {}, { status: backendResponse.status }),
    };
  }
  return { ok: true, result: payload as AuthResultPayload };
}

/** 23.23: who may use the back office. A staff or platform-admin ACCOUNT role is admitted
 * as before. Any other account -- typically a plain customer account that accepted an
 * invitation -- is admitted when it holds at least one ACTIVE business membership, which
 * is what makes someone staff (the API authorises business routes by membership, 16.1).
 * Returns the refusal to send, or null when admitted. */
async function refuseUnlessAdmitted(result: AuthResultPayload): Promise<NextResponse | null> {
  if (isBackOfficeRole(result.user.role)) {
    return null;
  }
  let businesses: number | null = null;
  try {
    const response = await fetch(`${webEnv.NEXT_PUBLIC_API_BASE_URL}/v1/shop/staff/me`, {
      headers: { Authorization: `Bearer ${result.accessToken}` },
    });
    if (response.ok) {
      const body = (await response.json().catch(() => ({}))) as { shops?: unknown };
      businesses = Array.isArray(body.shops) ? body.shops.length : null;
    }
  } catch {
    businesses = null;
  }
  if (businesses !== null && businesses > 0) {
    return null;
  }
  await revoke(result.refreshToken);
  return businesses === null
    ? jsonError(502, "UPSTREAM_UNREACHABLE", "The service is unreachable right now.")
    : jsonError(403, "NOT_BACK_OFFICE_ACCOUNT", NOT_A_MEMBER);
}

async function establishSession(result: AuthResultPayload): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(ACCESS_TOKEN_COOKIE, result.accessToken, accessTokenCookieOptions());
  cookieStore.set(REFRESH_TOKEN_COOKIE, result.refreshToken, refreshTokenCookieOptions());
  cookieStore.set(SESSION_USER_COOKIE, JSON.stringify(result.user), sessionUserCookieOptions());
}

/** Best effort: a session we refuse to open must not stay usable at the API. */
async function revoke(refreshToken: string): Promise<void> {
  await fetch(`${webEnv.NEXT_PUBLIC_API_BASE_URL}/v1/auth/logout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  }).catch(() => undefined);
}

export function jsonError(status: number, errorCode: string, message: string): NextResponse {
  return NextResponse.json(
    { error_code: errorCode, message, retryable: false, request_id: "web" },
    { status },
  );
}
