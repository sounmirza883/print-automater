import { NextResponse } from "next/server";

/** 23.27: liveness for the container healthcheck. It answers without touching the API, a
 * session or a page render, so a slow API cannot make the web container restart, and the
 * check does not depend on the sign-in redirect that `/` answers with. */
export const dynamic = "force-dynamic";

export function GET(): NextResponse {
  return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
