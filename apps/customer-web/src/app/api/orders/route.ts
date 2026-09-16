import type { NextResponse } from "next/server";
import { proxyAuthenticatedRequest } from "@/lib/authenticated-proxy";

export async function GET(): Promise<NextResponse> {
  return proxyAuthenticatedRequest("/v1/orders", { method: "GET" });
}
