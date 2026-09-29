import Link from "next/link";
import type { ReactNode } from "react";

/** §12.1: the landing page must immediately explain what Print
 * Automated does. There's no "Start Printing" CTA here (and no
 * signup/login of any kind) because a customer never starts an order
 * from this app directly -- they scan a QR code printed at their own
 * print shop, which lands them straight on that shop's own guest-order
 * page (`/s/[shopId]/upload`, 24.1). This page has no shop id to send
 * anyone to, so "For Print Shops" is the only real destination it can
 * offer. */
export default function LandingPage(): ReactNode {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-8 px-6 text-center">
      <div className="space-y-4">
        <h1 className="text-3xl font-bold sm:text-4xl">Print Automated</h1>
        <p className="text-lg text-gray-600">
          No account, no app to install. Scan the QR code at your print shop&apos;s counter, upload
          your document, choose how you want it printed, and pick it up already printed -- no
          walking in with a USB stick, no explaining your order at the counter.
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Link
          href="/for-shops"
          className="rounded-md px-6 py-3 font-semibold text-white"
          style={{ backgroundColor: "var(--color-primary-action)" }}
        >
          For Print Shops
        </Link>
      </div>
    </main>
  );
}
