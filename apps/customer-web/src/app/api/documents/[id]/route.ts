import type { NextResponse } from "next/server";
import { proxyAuthenticatedRequest } from "@/lib/authenticated-proxy";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return proxyAuthenticatedRequest(`/v1/documents/${id}`, { method: "GET" });
}
