import Link from "next/link";
import type { ReactNode } from "react";

/** §12.1: the landing page must immediately explain what Print
 * Automated does, with "Start Printing" as the primary CTA and "For
 * Print Shops" as the secondary CTA. */
export default function LandingPage(): ReactNode {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-8 px-6 text-center">
      <div className="space-y-4">
        <h1 className="text-3xl font-bold sm:text-4xl">Print Automated</h1>
        <p className="text-lg text-gray-600">
          Upload a document, configure how you want it printed, and pick it up already printed at a
          nearby print shop -- no walking in with a USB stick, no explaining your order at the
          counter.
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Link
          href="/signup"
          className="rounded-md px-6 py-3 font-semibold text-white"
          style={{ backgroundColor: "var(--color-primary-action)" }}
        >
          Start Printing
        </Link>
        <Link
          href="/for-shops"
          className="rounded-md border border-gray-300 px-6 py-3 font-semibold text-gray-800"
        >
          For Print Shops
        </Link>
      </div>
    </main>
  );
}
