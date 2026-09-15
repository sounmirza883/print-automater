import type { NextRequest, NextResponse } from "next/server";
import { proxyAuthenticatedRequest } from "@/lib/authenticated-proxy";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body: unknown = await request.json();
  return proxyAuthenticatedRequest("/v1/orders/quote", { method: "POST", body });
}
