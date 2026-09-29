import type { NextRequest, NextResponse } from "next/server";
import { proxyPublicRequest } from "@/lib/public-proxy";

/** Step 1 of the guest upload flow (24.1): create a document record and
 * get back a presigned PUT url, scoped to the shop the QR code named. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ shopId: string }> },
): Promise<NextResponse> {
  const { shopId } = await params;
  const body: unknown = await request.json();
  return proxyPublicRequest(`/v1/public/shops/${shopId}/documents`, { method: "POST", body });
}
