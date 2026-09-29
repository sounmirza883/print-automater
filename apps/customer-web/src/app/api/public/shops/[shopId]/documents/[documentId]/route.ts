import type { NextResponse } from "next/server";
import { proxyPublicRequest } from "@/lib/public-proxy";

/** Polled by the guest upload wizard until the document settles
 * (READY or REJECTED). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ shopId: string; documentId: string }> },
): Promise<NextResponse> {
  const { shopId, documentId } = await params;
  return proxyPublicRequest(`/v1/public/shops/${shopId}/documents/${documentId}`, {
    method: "GET",
  });
}
