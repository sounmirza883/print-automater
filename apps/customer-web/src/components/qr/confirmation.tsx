"use client";

import { useEffect, type ReactNode } from "react";
import { Card, Notice, SiteFrame } from "@/components/ui";
import { formatMoney, summarizeConfiguration } from "@/lib/order-formatting";
import type { PublicOrderResult } from "@/lib/public-order";

/** Step 4: the guest's order number, to show at the counter, plus the real
 * total, seen here for the first time (no quote preview exists earlier in
 * this flow). No link onward: there is no account or session for this guest
 * to track the order under, so this screen is the end of the flow. */
export function ConfirmationScreen({ order }: { order: PublicOrderResult }): ReactNode {
  const quote = order.pricingSnapshot.quote;
  // The order can be placed from anywhere on the long options form (the phone
  // submit bar follows the scroll), and this screen would open at that depth.
  useEffect(() => window.scrollTo(0, 0), []);
  return (
    <SiteFrame width="narrow">
      <div className="grid gap-6">
        <Card className="grid gap-4">
          {/* `Card` takes no ARIA props, so the status role sits on the block it always
              covered: "Order placed", the order number and the shop. */}
          <div role="status" className="grid gap-1">
            <p className="text-sm text-muted">Order placed</p>
            <h1 className="num text-3xl font-semibold">{order.publicOrderNumber}</h1>
            <p className="text-muted">{order.shopName}</p>
          </div>

          <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-muted">Document</dt>
            <dd className="mb-2 min-w-0 wrap-anywhere sm:mb-0">{order.documentFilename}</dd>
            <dt className="text-muted">Configuration</dt>
            <dd>{summarizeConfiguration(order.printConfiguration)}</dd>
          </dl>
        </Card>

        <Card className="grid gap-3">
          <ul className="grid gap-1 text-sm">
            {quote.lineItems.map((item) => (
              <li key={item.label} className="flex justify-between gap-4">
                <span>{item.label}</span>
                <span className="num shrink-0 whitespace-nowrap">
                  {formatMoney(item.amountMinor, quote.currency)}
                </span>
              </li>
            ))}
            <li className="flex justify-between gap-4">
              <span>Platform fee</span>
              <span className="num shrink-0 whitespace-nowrap">
                {formatMoney(quote.platformFeeMinor, quote.currency)}
              </span>
            </li>
          </ul>
          <div className="flex justify-between gap-4 border-t border-line pt-3 text-base font-semibold">
            <span>Total</span>
            <span className="num shrink-0 whitespace-nowrap">
              {formatMoney(quote.totalMinor, quote.currency)}
            </span>
          </div>
        </Card>

        <Notice tone="accent">
          Show this order number to the shop when you collect your prints.
        </Notice>
      </div>
    </SiteFrame>
  );
}
