"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import type { PrintConfiguration } from "@print-automated/types";
import { fetchQuote, type QuoteResult } from "@/lib/configure-quote";
import { formatMoney, summarizeConfiguration } from "@/lib/orders";
import { createOrder, startCheckout } from "@/lib/place-order";

/** §22's review screen. Everything the customer already chose on the
 * configure screen (4.6/4.7) arrives here via the URL rather than
 * being recomputed -- but the *price* is always re-fetched fresh from
 * the server (below), never trusted from the query string, so this
 * screen keeps 4.4's "nothing is computed in the browser" guarantee
 * even though it's a step removed from the live configure form. */
export default function ReviewPage(): ReactNode {
  return (
    <Suspense>
      <ReviewForm />
    </Suspense>
  );
}

function ReviewForm(): ReactNode {
  const searchParams = useSearchParams();
  const documentId = searchParams.get("documentId");
  const documentFilename = searchParams.get("documentFilename");
  const shopId = searchParams.get("shopId");
  const shopName = searchParams.get("shopName");
  const configParam = searchParams.get("config");

  let printConfiguration: PrintConfiguration | null = null;
  if (configParam !== null) {
    try {
      printConfiguration = JSON.parse(configParam) as PrintConfiguration;
    } catch {
      printConfiguration = null;
    }
  }

  if (
    documentId === null ||
    documentFilename === null ||
    shopId === null ||
    shopName === null ||
    printConfiguration === null
  ) {
    return (
      <main className="mx-auto max-w-xl px-6 py-12">
        <p role="alert" style={{ color: "var(--color-error)" }}>
          Missing order details. Go back and configure your print job again.
        </p>
      </main>
    );
  }

  return (
    <ReviewOrder
      documentId={documentId}
      documentFilename={documentFilename}
      shopId={shopId}
      shopName={shopName}
      printConfiguration={printConfiguration}
    />
  );
}

type QuoteState =
  | { phase: "loading" }
  | { phase: "ready"; quote: QuoteResult }
  | { phase: "error"; message: string };

function ReviewOrder({
  documentId,
  documentFilename,
  shopId,
  shopName,
  printConfiguration,
}: {
  documentId: string;
  documentFilename: string;
  shopId: string;
  shopName: string;
  printConfiguration: PrintConfiguration;
}): ReactNode {
  const [quoteState, setQuoteState] = useState<QuoteState>({ phase: "loading" });
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  // One key per mount of this screen, reused across a retry -- a
  // double click or a retry after a transient network error must not
  // mint a second order (§92).
  const idempotencyKey = useRef(crypto.randomUUID());

  useEffect(() => {
    let cancelled = false;
    fetchQuote(documentId, shopId, printConfiguration)
      .then((quote) => {
        if (!cancelled) setQuoteState({ phase: "ready", quote });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setQuoteState({
            phase: "error",
            message: error instanceof Error ? error.message : "Could not get a quote.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
    // documentId/shopId/printConfiguration are carried once from the
    // configure screen's final values via the URL and never change
    // for the life of this page -- this fetch runs exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handlePlaceOrder(): Promise<void> {
    setPlaceError(null);
    setPlacing(true);
    try {
      const order = await createOrder(
        documentId,
        shopId,
        printConfiguration,
        idempotencyKey.current,
      );
      const { checkoutUrl } = await startCheckout(order.id);
      // A full navigation, not a fetch: the mock provider's checkout
      // page (6.3) is served directly by services/api, a different
      // origin from customer-web.
      window.location.href = checkoutUrl;
    } catch (error) {
      setPlaceError(error instanceof Error ? error.message : "Could not place this order.");
      setPlacing(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 px-6 py-12">
      <h1 className="text-2xl font-bold">Review your order</h1>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt className="text-gray-500">Document</dt>
        <dd>{documentFilename}</dd>
        <dt className="text-gray-500">Shop</dt>
        <dd>{shopName}</dd>
        <dt className="text-gray-500">Configuration</dt>
        <dd>{summarizeConfiguration(printConfiguration)}</dd>
      </dl>

      {quoteState.phase === "loading" && (
        <p className="text-gray-600">Getting the current price…</p>
      )}
      {quoteState.phase === "error" && (
        <p role="alert" style={{ color: "var(--color-error)" }}>
          {quoteState.message}
        </p>
      )}
      {quoteState.phase === "ready" && (
        <div className="flex flex-col gap-2 rounded-lg border border-gray-300 p-4">
          <ul className="flex flex-col gap-1 text-sm">
            {quoteState.quote.lineItems.map((item) => (
              <li key={item.label} className="flex justify-between">
                <span>{item.label}</span>
                <span>{formatMoney(item.amountMinor, quoteState.quote.currency)}</span>
              </li>
            ))}
            <li className="flex justify-between">
              <span>Platform fee</span>
              <span>
                {formatMoney(quoteState.quote.platformFeeMinor, quoteState.quote.currency)}
              </span>
            </li>
          </ul>
          <div className="flex justify-between border-t border-gray-300 pt-2 font-semibold">
            <span>Total</span>
            <span>{formatMoney(quoteState.quote.totalMinor, quoteState.quote.currency)}</span>
          </div>
        </div>
      )}

      {placeError !== null && (
        <p role="alert" style={{ color: "var(--color-error)" }}>
          {placeError}
        </p>
      )}

      <button
        type="button"
        disabled={quoteState.phase !== "ready" || placing}
        onClick={handlePlaceOrder}
        className="rounded-md bg-black px-4 py-2 font-semibold text-white disabled:opacity-50"
      >
        {placing ? "Placing order…" : "Pay & Place Order"}
      </button>
    </main>
  );
}
