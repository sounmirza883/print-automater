import Link from "next/link";
import type { ReactNode } from "react";
import { LogoutButton } from "./logout-button";

/** A shell, not a real dashboard yet -- `middleware.ts` is what actually
 * enforces "unauthenticated requests can't reach this page" (§3.3's
 * Done-when); rendering here just proves that gate let a real session
 * through. `/orders` (7.4/7.5) is where order history/status summaries
 * actually live now. */
export default function DashboardPage(): ReactNode {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <LogoutButton />
      </div>
      <div className="flex gap-3">
        <Link
          href="/upload"
          className="self-start rounded-md px-6 py-3 font-semibold text-white"
          style={{ backgroundColor: "var(--color-primary-action)" }}
        >
          Upload a document
        </Link>
        <Link
          href="/orders"
          className="self-start rounded-md border border-gray-300 px-6 py-3 font-semibold"
        >
          Your orders
        </Link>
      </div>
    </main>
  );
}
