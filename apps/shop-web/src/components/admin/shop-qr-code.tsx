"use client";

import { useRef, useState, type ReactNode } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { Button, Panel } from "@/components/ui";

/** customer-web's own dev origin (its `next dev --port 3001`). */
const DEV_CUSTOMER_WEB_URL = "http://localhost:3001";

/** 24.1 follow-on (Workstream D2): the public guest-ordering URL a QR
 * code posted at the counter should point a customer's phone at --
 * `/s/:shopId/upload` on customer-web (built in Task 6; the route
 * pattern is fixed by that plan regardless of build order). `NEXT_PUBLIC_*`
 * vars are inlined into the client bundle at BUILD time (see
 * shop-web.Dockerfile's own note on this for `NEXT_PUBLIC_API_BASE_URL`)
 * -- read directly here rather than through the server-only `webEnv`
 * (src/env.ts, which validates its own schema on server boot and has no
 * entry for this var), the same direct `process.env.NEXT_PUBLIC_*` read
 * customer-web's own browser code does (lib/public-api.ts).
 *
 * Fix wave 1: `null` when there is no usable origin, so the caller shows
 * a loud error instead of a code that sends customers nowhere. An EMPTY
 * value counts as missing -- the Docker build passes an unset build arg
 * through as "" (not undefined), which `??` never caught, so the code
 * silently encoded a relative path. Only a development/test bundle falls
 * back to customer-web's dev port; a production build (NODE_ENV, also
 * inlined at build time) never guesses, since these codes are printed
 * and posted at real counters and a wrong one means reprinting them all.
 * A value that isn't an absolute http(s) URL is refused the same way.
 *
 * With a branch the address carries it (`?branch=<id>`), so a customer who scans that branch's
 * code orders from that branch. Without one it is the business-wide address every code printed
 * before branches existed has: customer-web sends those orders to the oldest branch. */
export function shopUploadUrl(shopId: string, branchId?: string): string | null {
  const configured = (process.env.NEXT_PUBLIC_CUSTOMER_WEB_URL ?? "").trim();
  let origin: string;
  if (configured === "") {
    if (process.env.NODE_ENV === "production") {
      return null;
    }
    origin = DEV_CUSTOMER_WEB_URL;
  } else if (/^https?:\/\/[^/]/i.test(configured)) {
    origin = configured.replace(/\/+$/, "");
  } else {
    return null;
  }
  const address = `${origin}/s/${shopId}/upload`;
  return branchId === undefined ? address : `${address}?branch=${encodeURIComponent(branchId)}`;
}

/** A QR code for one shop's guest-ordering page, plus a way to download
 * it as a PNG -- the real use case (per the plan) is the shop owner
 * printing it and posting it at the counter, so a browser "right click
 * and save" of an on-screen canvas isn't good enough. Presentational
 * and session-agnostic (no `useSession`/`useResource` of its own) so it
 * can be dropped into both the platform admin's business detail page
 * and the shop's own settings screen unchanged.
 *
 * `notReady` (fix wave 1): when the caller knows orders through this code
 * would be refused today (e.g. the business has no prices yet), it says
 * why, and the code itself is withheld until that changes -- a printed
 * code that fails every order is worse than no code yet. */
export function ShopQrCode({
  shopId,
  shopName,
  branchId,
  branchName,
  notReady,
  framed = true,
}: {
  shopId: string;
  shopName?: string;
  /** A branch's own code: the address carries the branch, and the wording names it. */
  branchId?: string;
  branchName?: string;
  notReady?: ReactNode;
  /** False inside a dialog that already has a title and a border of its own. */
  framed?: boolean;
}): ReactNode {
  const url = shopUploadUrl(shopId, branchId);
  const title = branchName === undefined ? "Guest ordering QR code" : `QR code for ${branchName}`;
  const frame = (tone: "default" | "danger" | "caution", content: ReactNode): ReactNode =>
    framed ? (
      <Panel title={title} id="qr-code" tone={tone === "default" ? undefined : tone}>
        {content}
      </Panel>
    ) : (
      content
    );

  if (url === null) {
    return frame(
      "danger",
      <p role="alert" className="text-sm text-danger-fg">
        The guest ordering link is not configured, so no QR code is shown. This build of the back
        office was made without NEXT_PUBLIC_CUSTOMER_WEB_URL (the customer site&apos;s public
        address); rebuild it with that set before printing any codes.
      </p>,
    );
  }

  if (notReady !== undefined && notReady !== null) {
    return frame(
      "caution",
      <div role="note" className="grid gap-2 text-sm">
        <p className="font-medium">Not ready to hand out yet</p>
        <div className="text-muted">{notReady}</div>
      </div>,
    );
  }

  return frame("default", <QrCodeView url={url} shopName={shopName} branchName={branchName} />);
}

/** The code itself with its link and buttons, without a panel around it, so it can sit in a
 * panel (Settings, the admin's business page) or in a dialog (a branch on the Branches page). */
export function QrCodeView({
  url,
  shopName,
  branchName,
}: {
  url: string;
  shopName?: string;
  branchName?: string;
}): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");

  function download(): void {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const link = document.createElement("a");
    const slug = (text: string): string =>
      text
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-");
    const namePart = [slug(shopName ?? "shop"), branchName === undefined ? "" : slug(branchName)]
      .filter((part) => part !== "" && part !== "-")
      .join("-");
    link.download = `${namePart || "shop"}-qr-code.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      setCopy("copied");
    } catch {
      // No clipboard permission (or an insecure page): the link above can still be selected.
      setCopy("failed");
    }
  }

  return (
    <div className="grid gap-3 sm:max-w-xs">
      <p className="text-sm text-muted">
        {branchName === undefined
          ? "Print this and post it at the counter. Scanning it opens the upload page for walk-in customers ordering without an account."
          : `Print this and post it at ${branchName}. Scanning it opens the upload page for walk-in customers ordering without an account, and their order goes to ${branchName}.`}
      </p>
      {/* A QR code needs a white quiet zone to scan, in either theme. */}
      <div className="w-fit rounded-md border border-line bg-white p-3">
        <QRCodeCanvas
          ref={canvasRef}
          value={url}
          size={192}
          level="M"
          marginSize={2}
          title={`QR code for ${branchName ?? shopName ?? "this business"}'s guest ordering page`}
        />
      </div>
      <p className="font-mono text-xs break-all text-muted select-all">{url}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={download}>Download PNG</Button>
        <Button onClick={() => void copyLink()}>Copy link</Button>
        <span role="status" className="text-xs text-muted">
          {copy === "copied"
            ? "Link copied."
            : copy === "failed"
              ? "Could not copy. Select the link above and copy it."
              : ""}
        </span>
      </div>
    </div>
  );
}
