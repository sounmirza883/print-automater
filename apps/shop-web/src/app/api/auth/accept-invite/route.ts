import type { NextRequest, NextResponse } from "next/server";
import { acceptStaffInviteSchema, loginSchema } from "@print-automated/validation";
import { jsonError, proxyAcceptInviteAndEstablishSession } from "@/lib/auth-backend";
import { isSameOriginMutation } from "@/lib/proxy-path";

/** 23.23: sign in and redeem an invitation code in one step (see auth-backend.ts). */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (
    !isSameOriginMutation("POST", request.headers.get("origin"), request.headers.get("host") ?? "")
  ) {
    return jsonError(403, "CROSS_ORIGIN_BLOCKED", "That request was blocked for safety.");
  }
  const body = (await request.json().catch(() => undefined)) as
    { email?: unknown; password?: unknown; code?: unknown } | undefined;
  const credentials = loginSchema.safeParse({ email: body?.email, password: body?.password });
  if (!credentials.success) {
    return jsonError(
      400,
      "VALIDATION_FAILED",
      credentials.error.issues[0]?.message ?? "Enter your email address and password.",
    );
  }
  const code = acceptStaffInviteSchema.safeParse({ token: body?.code });
  if (!code.success) {
    return jsonError(
      400,
      "VALIDATION_FAILED",
      "Enter the invitation code exactly as it appears in the email.",
    );
  }
  return proxyAcceptInviteAndEstablishSession({ ...credentials.data, code: code.data.token });
}
