import Link from "next/link";
import type { ReactNode } from "react";

/** §12.1's secondary CTA destination. Shop staff accounts and the
 * onboarding flow itself are out of this app's scope (shop-mobile,
 * Phase 3.4/8) -- this page only explains the partner side plainly,
 * same as the landing page does for customers. */
export default function ForShopsPage(): ReactNode {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-3xl font-bold">For Print Shops</h1>
      <p className="text-lg text-gray-600">
        Print Automated sends you paid, correctly configured print jobs from customers nearby --
        review the order, accept it, and print. Staff sign in from the Print Automated Shop app.
      </p>
      <Link href="/" className="font-semibold underline">
        Back to Print Automated
      </Link>
    </main>
  );
}
