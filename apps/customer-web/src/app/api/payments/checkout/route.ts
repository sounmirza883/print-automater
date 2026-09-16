import { type NextRequest, NextResponse } from "next/server";
import { proxyAuthenticatedRequest } from "@/lib/authenticated-proxy";

/** §6.4 already makes this endpoint idempotent per order on the
 * backend (two checkout calls on one order reuse the same payment
 * record) -- no client-generated key needed here the way order
 * creation needs one. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body: unknown = await request.json();
  return proxyAuthenticatedRequest("/v1/payments/checkout", { method: "POST", body });
}
