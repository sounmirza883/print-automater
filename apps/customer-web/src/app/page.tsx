import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass, Card, SiteFrame } from "@/components/ui";

const STEPS: ReadonlyArray<{ title: string; text: string }> = [
  { title: "Scan the shop's code", text: "The QR code at the counter opens that shop's own page." },
  {
    title: "Upload and choose",
    text: "Your file, which pages, how many copies, color or black and white.",
  },
  { title: "Collect at the counter", text: "Show your order number, pay and pick it up." },
];

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
    <SiteFrame>
      <section className="grid gap-4 pb-10 sm:pb-14">
        <p className="text-xs font-semibold tracking-[0.08em] text-muted uppercase">
          No account · No app
        </p>
        <h1 className="text-4xl leading-[1.05] font-semibold tracking-[-0.03em] sm:text-5xl">
          Print from your phone. Collect at the counter.
        </h1>
        <p className="max-w-2xl text-base text-muted sm:text-lg">
          Scan the QR code at your print shop&apos;s counter, upload your document, choose how you
          want it printed, and collect it already printed. No walking in with a USB stick, no
          explaining your order at the counter.
        </p>
      </section>

      <section className="grid gap-4">
        <p id="how-it-works" className="text-sm font-semibold text-ink-2">
          How it works
        </p>
        <ol aria-labelledby="how-it-works" className="grid gap-3 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title}>
              <Card className="grid h-full content-start gap-3">
                <span
                  aria-hidden="true"
                  className="grid size-7 place-items-center rounded-full bg-inv text-xs font-bold text-inv-ink"
                >
                  {index + 1}
                </span>
                <h2 className="text-base font-semibold">{step.title}</h2>
                <p className="text-sm text-muted">{step.text}</p>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-3 sm:mt-14">
        <p className="text-sm text-muted">Run a print shop?</p>
        <Link href="/for-shops" className={buttonClass()}>
          For print shops
        </Link>
      </section>
    </SiteFrame>
  );
}
