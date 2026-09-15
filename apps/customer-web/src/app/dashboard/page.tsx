import type { ReactNode } from "react";
import { LogoutButton } from "./logout-button";

/** A shell, not a real dashboard yet -- `middleware.ts` is what actually
 * enforces "unauthenticated requests can't reach this page" (§3.3's
 * Done-when); rendering here just proves that gate let a real session
 * through. Phase 4+ gives this page real content once there's an
 * upload/order flow to summarize. */
export default function DashboardPage(): ReactNode {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <LogoutButton />
      </div>
      <p className="text-gray-600">
        You&apos;re signed in. Uploading and configuring print jobs lands here in a later phase.
      </p>
    </main>
  );
}
