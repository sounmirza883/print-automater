import type { NextResponse } from "next/server";
import { proxyPublicRequest } from "@/lib/public-proxy";

/** Step 2 of the guest upload flow: called once the presigned PUT to
 * storage has succeeded, so the worker can pick the document up. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ shopId: string; documentId: string }> },
): Promise<NextResponse> {
  const { shopId, documentId } = await params;
  return proxyPublicRequest(`/v1/public/shops/${shopId}/documents/${documentId}/upload`, {
    method: "POST",
  });
}
