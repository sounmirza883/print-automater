"use client";

import { useContext, useEffect, useState, type ReactNode } from "react";
import { QRCodeSVG } from "qrcode.react";
import { OrderingBranchContext } from "@/components/qr/ordering-branch";
import { Button, Card, Notice, SiteFrame } from "@/components/ui";
import { formatMoney, summarizeConfiguration } from "@/lib/order-formatting";
import { fetchPublicInvoice, type PublicOrderResult } from "@/lib/public-order";

/** Saves a blob under `filename` through a throwaway link. */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Step 4: the guest's order number, to show at the counter, plus the real
 * total, seen here for the first time (no quote preview exists earlier in
 * this flow). The order number is also shown as a QR code the shop can scan
 * at the counter, and the guest can download a PDF invoice. There is no link
 * onward to track the order: there is no account or session for this guest to
 * track it under. `onOrderAgain` starts a fresh order from the upload step. */
export function ConfirmationScreen({
  order,
  onOrderAgain,
}: {
  order: PublicOrderResult;
  onOrderAgain: () => void;
}): ReactNode {
  const quote = order.pricingSnapshot.quote;
  // The branch the code named, so the guest knows where to collect (null for a code without one).
  const branch = useContext(OrderingBranchContext);
  const [downloading, setDownloading] = useState(false);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  // The order can be placed from anywhere on the long options form (the phone
  // submit bar follows the scroll), and this screen would open at that depth.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  function downloadInvoice(): void {
    setDownloading(true);
    setInvoiceError(null);
    fetchPublicInvoice(order)
      .then(({ blob, filename }) => saveBlob(blob, filename))
      .catch((error: unknown) => {
        setInvoiceError(error instanceof Error ? error.message : "Could not download the invoice.");
      })
      .finally(() => setDownloading(false));
  }

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
            {branch !== null && (
              <p className="text-sm text-muted">
                Collect at <strong className="font-semibold text-ink">{branch.name}</strong>
                {branch.address !== "" && `, ${branch.address}`}
              </p>
            )}
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

        <Card className="grid justify-items-center gap-3 text-center">
          {/* A QR code needs a white quiet zone to scan, in either theme. */}
          <div className="rounded-md bg-white p-3">
            <QRCodeSVG
              value={order.publicOrderNumber}
              size={176}
              level="M"
              marginSize={1}
              title={`QR code for order ${order.publicOrderNumber}`}
            />
          </div>
          <p className="text-sm text-muted">
            Show this QR code at the counter. The shop scans it to find your order and take payment.
          </p>
        </Card>

        <Notice tone="accent">
          Show this order number to the shop when you collect your prints.
        </Notice>

        <div className="grid gap-3">
          <Button block onClick={downloadInvoice} disabled={downloading}>
            {downloading ? "Preparing invoice…" : "Download invoice (PDF)"}
          </Button>
          {invoiceError !== null && (
            <p role="alert" className="text-sm text-danger-fg">
              {invoiceError}
            </p>
          )}
          <Button block variant="primary" onClick={onOrderAgain}>
            Place another order
          </Button>
        </div>
      </div>
    </SiteFrame>
  );
}
