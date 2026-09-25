import type { NextRequest, NextResponse } from "next/server";
import { loginSchema } from "@print-automated/validation";
import { jsonError, proxyLoginAndEstablishSession } from "@/lib/auth-backend";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body: unknown = await request.json().catch(() => undefined);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "VALIDATION_FAILED", parsed.error.issues[0]?.message ?? "Invalid input.");
  }
  return proxyLoginAndEstablishSession(parsed.data);
}
