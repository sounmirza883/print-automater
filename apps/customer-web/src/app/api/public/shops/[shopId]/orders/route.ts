import type { NextRequest, NextResponse } from "next/server";
import { proxyPublicRequest } from "@/lib/public-proxy";

/** §92/5.3, guest version: forwards the caller's own `Idempotency-Key`
 * (minted once per placement attempt by the wizard, `lib/public-order.ts`)
 * straight through -- same reasoning as the authenticated `/api/orders`
 * route: a retry must reuse the same key for the backend's dedup to
 * apply, so this route must never mint its own. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ shopId: string }> },
): Promise<NextResponse> {
  const { shopId } = await params;
  const body: unknown = await request.json();
  const idempotencyKey = request.headers.get("Idempotency-Key");
  return proxyPublicRequest(`/v1/public/shops/${shopId}/orders`, {
    method: "POST",
    body,
    headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
  });
}
