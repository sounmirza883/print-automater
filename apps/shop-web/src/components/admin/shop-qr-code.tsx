"use client";

import { useRef, type ReactNode } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { Button, Panel } from "@/components/ui";

/** 24.1 follow-on (Workstream D2): the public guest-ordering URL a QR
 * code posted at the counter should point a customer's phone at --
 * `/s/:shopId/upload` on customer-web (built in Task 6; the route
 * pattern is fixed by that plan regardless of build order). `NEXT_PUBLIC_*`
 * vars are inlined into the client bundle at BUILD time (see
 * shop-web.Dockerfile's own note on this for `NEXT_PUBLIC_API_BASE_URL`)
 * -- read directly here rather than through the server-only `webEnv`
 * (src/env.ts, which validates its own schema on server boot and has no
 * entry for this var yet), matching customer-web's own direct
 * `process.env.NEXT_PUBLIC_API_BASE_URL` read in a browser-side call
 * (lib/configure-quote.ts). Falls back to customer-web's dev port so
 * this still renders something correct locally with no override. */
export function shopUploadUrl(shopId: string): string {
  const origin = (process.env.NEXT_PUBLIC_CUSTOMER_WEB_URL ?? "http://localhost:3001").replace(
    /\/+$/,
    "",
  );
  return `${origin}/s/${shopId}/upload`;
}

/** A QR code for one shop's guest-ordering page, plus a way to download
 * it as a PNG -- the real use case (per the plan) is the shop owner
 * printing it and posting it at the counter, so a browser "right click
 * and save" of an on-screen canvas isn't good enough. Presentational
 * and session-agnostic (no `useSession`/`useResource` of its own) so it
 * can be dropped into both the platform admin's business detail page
 * and the shop's own settings screen unchanged. */
export function ShopQrCode({ shopId, shopName }: { shopId: string; shopName?: string }): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const url = shopUploadUrl(shopId);

  function download(): void {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const link = document.createElement("a");
    const namePart = (shopName ?? "shop")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");
    link.download = `${namePart || "shop"}-qr-code.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  return (
    <Panel title="Guest ordering QR code" id="qr-code">
      <div className="grid gap-3 sm:max-w-xs">
        <p className="text-sm text-muted">
          Print this and post it at the counter. Scanning it opens the upload page for walk-in
          customers ordering without an account.
        </p>
        <div className="w-fit rounded-md border border-line bg-white p-3">
          <QRCodeCanvas
            ref={canvasRef}
            value={url}
            size={192}
            level="M"
            marginSize={2}
            title={`QR code for ${shopName ?? "this business"}'s guest ordering page`}
          />
        </div>
        <p className="break-all font-mono text-xs text-muted">{url}</p>
        <div>
          <Button onClick={download}>Download PNG</Button>
        </div>
      </div>
    </Panel>
  );
}
