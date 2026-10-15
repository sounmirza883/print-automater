import Link from "next/link";
import type { ReactNode } from "react";
import { Card, SiteFrame } from "@/components/ui";

const POINTS: ReadonlyArray<string> = [
  "Correctly configured jobs from customers nearby",
  "Review, accept and print from one queue",
  "No walk-in USB sticks, no re-typing orders",
];

/** §12.1's secondary CTA destination. Shop staff accounts and the
 * onboarding flow itself are out of this app's scope (shop-mobile,
 * Phase 3.4/8) -- this page only explains the partner side plainly,
 * same as the landing page does for customers. */
export default function ForShopsPage(): ReactNode {
  return (
    <SiteFrame>
      <section className="grid gap-4 pb-8">
        <h1 className="text-4xl leading-[1.05] font-semibold tracking-[-0.03em] sm:text-5xl">
          For print shops
        </h1>
        <p className="max-w-2xl text-base text-muted sm:text-lg">
          Print Automated sends you correctly configured print jobs from customers nearby. Review
          the order, accept it, and print. Staff sign in from the Print Automated Shop app.
        </p>
      </section>

      <ul className="grid gap-3 sm:grid-cols-3">
        {POINTS.map((point) => (
          <li key={point}>
            <Card className="flex h-full items-start gap-3">
              <span
                aria-hidden="true"
                className="grid size-7 flex-none place-items-center rounded-full bg-inv text-sm font-bold text-inv-ink"
              >
                ✓
              </span>
              <p className="text-sm font-medium">{point}</p>
            </Card>
          </li>
        ))}
      </ul>

      <p className="mt-10">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center text-[15px] font-semibold text-ink underline underline-offset-4"
        >
          Back to Print Automated
        </Link>
      </p>
    </SiteFrame>
  );
}
