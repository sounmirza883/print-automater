import { type NextRequest, NextResponse } from "next/server";
import { proxyAuthenticatedRequest } from "@/lib/authenticated-proxy";

export async function GET(): Promise<NextResponse> {
  return proxyAuthenticatedRequest("/v1/orders", { method: "GET" });
}

/** §92/5.3: forwards the caller's own `Idempotency-Key` (6.7's review
 * page generates one per placement attempt) straight through -- this
 * route must not mint its own, since a client-side retry needs the
 * *same* key on every attempt for the backend's dedup to apply. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body: unknown = await request.json();
  const idempotencyKey = request.headers.get("Idempotency-Key");
  return proxyAuthenticatedRequest("/v1/orders", {
    method: "POST",
    body,
    headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
  });
}
