import type { NextRequest, NextResponse } from "next/server";
import { proxyToBackend } from "@/lib/authenticated-proxy";

interface RouteContext {
  params: Promise<{ path: string[] }>;
}

/** One catch-all BFF route for every business/admin API call the console
 * makes (`/api/v1/shop/...` -> `<API>/v1/shop/...`); the allow-list of
 * areas and the auth/CSRF handling live in `lib/authenticated-proxy.ts`. */
async function handle(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { path } = await context.params;
  return proxyToBackend(request, path);
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
