import type { NextRequest, NextResponse } from "next/server";
import { activateStaffInviteSchema } from "@print-automated/validation";
import { jsonError, proxyActivateAndEstablishSession } from "@/lib/auth-backend";
import { isSameOriginMutation } from "@/lib/proxy-path";

/** Fix wave 1: a new business owner sets their password with the emailed code and is
 * signed in, in one step (see auth-backend.ts). Validated with the API's own schema first
 * (same email, code and password rules), so a malformed request never spends one of the
 * API's rate-limited attempts. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (
    !isSameOriginMutation("POST", request.headers.get("origin"), request.headers.get("host") ?? "")
  ) {
    return jsonError(403, "CROSS_ORIGIN_BLOCKED", "That request was blocked for safety.");
  }
  const body = (await request.json().catch(() => undefined)) as
    { email?: unknown; password?: unknown; code?: unknown } | undefined;
  const parsed = activateStaffInviteSchema.safeParse({
    email: body?.email,
    token: body?.code,
    password: body?.password,
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return jsonError(
      400,
      "VALIDATION_FAILED",
      field === "token"
        ? "Enter the code exactly as it appears in the email."
        : field === "password"
          ? "Choose a password of at least 8 characters."
          : "Enter the email address the code was sent to.",
    );
  }
  return proxyActivateAndEstablishSession(parsed.data);
}
