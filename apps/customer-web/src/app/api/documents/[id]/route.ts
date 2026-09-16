import type { NextResponse } from "next/server";
import { proxyAuthenticatedRequest } from "@/lib/authenticated-proxy";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return proxyAuthenticatedRequest(`/v1/documents/${id}`, { method: "GET" });
}

// §71/§2.5's own customer-facing DELETE was never wired up through this
// app's own proxy layer -- discovered while building 13.1's golden path,
// whose own §121 step 31 needs it. Same pattern as GET above.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return proxyAuthenticatedRequest(`/v1/documents/${id}`, { method: "DELETE" });
}
