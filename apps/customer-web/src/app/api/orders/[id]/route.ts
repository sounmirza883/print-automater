import type { NextRequest, NextResponse } from "next/server";
import { proxyAuthenticatedRequest } from "@/lib/authenticated-proxy";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return proxyAuthenticatedRequest(`/v1/orders/${id}`, { method: "GET" });
}
