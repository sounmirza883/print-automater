import type { NextRequest, NextResponse } from "next/server";
import { loginSchema } from "@print-automated/validation";
import { proxyAuthAndEstablishSession, validationErrorResponse } from "@/lib/auth-backend";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body: unknown = await request.json();
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error.issues[0]?.message ?? "Invalid input.");
  }
  return proxyAuthAndEstablishSession("/v1/auth/login", parsed.data);
}
