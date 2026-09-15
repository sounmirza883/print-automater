"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import type { PrintConfiguration } from "@print-automated/types";
import {
  debounce,
  fetchMatchingShops,
  fetchQuote,
  validatePageSelection,
  type QuoteResult,
  type ShopListItem,
} from "@/lib/configure-quote";

const QUOTE_DEBOUNCE_MS = 400;

interface DocumentInfo {
  id: string;
  filename: string;
  status: string;
  pageCount: number | null;
}

export default function ConfigurePage(): ReactNode {
  // useSearchParams() requires a Suspense boundary during static
  // generation -- same reasoning as login/page.tsx (3.3).
  return (
    <Suspense>
      <ConfigureForm />
    </Suspense>
  );
}

function ConfigureForm(): ReactNode {
  const documentId = useSearchParams().get("documentId");

  if (documentId === null) {
    // A plain render-time branch, not an effect+setState round trip --
    // this can't change without `documentId` itself changing identity,
    // and the component below only ever mounts once one exists, so its
    // own hook count is never conditional on this.
    return (
      <main className="mx-auto max-w-xl px-6 py-12">
        <p role="alert" style={{ color: "var(--color-error)" }}>
          No document selected. Upload one first.
        </p>
      </main>
    );
  }

  return <ConfigureDocument documentId={documentId} />;
}

function ConfigureDocument({ documentId }: { documentId: string }): ReactNode {
  const [document, setDocument] = useState<DocumentInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [pagesMode, setPagesMode] = useState<"all" | "range">("all");
  const [rangeFrom, setRangeFrom] = useState(1);
  const [rangeTo, setRangeTo] = useState(1);
  const [copies, setCopies] = useState(1);
  const [color, setColor] = useState<PrintConfiguration["color"]>("BW");
  const [sides, setSides] = useState<PrintConfiguration["sides"]>("SINGLE");
  const [orientation, setOrientation] = useState<PrintConfiguration["orientation"]>("PORTRAIT");

  const [shops, setShops] = useState<ShopListItem[]>([]);
  const [selectedShopId, setSelectedShopId] = useState<string | null>(null);

  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

  // Load the document once -- must be READY (2.7's pipeline outcome)
  // with a real page count before anything here means anything.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/documents/${documentId}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setLoadError("Could not load this document.");
          return;
        }
        const doc = (await res.json()) as DocumentInfo;
        if (doc.status !== "READY") {
          setLoadError("This document isn't ready to configure yet.");
          return;
        }
        setDocument(doc);
        setRangeTo(doc.pageCount ?? 1);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Could not load this document.");
      });
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  // §18: re-fetch capability-matched shops whenever color/duplex change.
  useEffect(() => {
    let cancelled = false;
    fetchMatchingShops({ paperSize: "A4", color, sides })
      .then((list) => {
        if (cancelled) return;
        setShops(list);
        setSelectedShopId((current) =>
          current !== null && list.some((shop) => shop.id === current)
            ? current
            : (list[0]?.id ?? null),
        );
      })
      .catch(() => {
        if (!cancelled) setShops([]);
      });
    return () => {
      cancelled = true;
    };
  }, [color, sides]);

  const pages = useMemo<PrintConfiguration["pages"]>(
    () => (pagesMode === "all" ? { mode: "all" } : { mode: "range", from: rangeFrom, to: rangeTo }),
    [pagesMode, rangeFrom, rangeTo],
  );

  const pageError =
    document?.pageCount != null ? validatePageSelection(pages, document.pageCount) : null;

  const debouncedFetchQuote = useMemo(
    () =>
      debounce((config: PrintConfiguration, docId: string, shopId: string) => {
        setQuoteLoading(true);
        setQuoteError(null);
        fetchQuote(docId, shopId, config)
          .then((result) => setQuote(result))
          .catch((error: unknown) => {
            setQuote(null);
            setQuoteError(error instanceof Error ? error.message : "Could not get a quote.");
          })
          .finally(() => setQuoteLoading(false));
      }, QUOTE_DEBOUNCE_MS),
    [],
  );

  // §4.6: "Live re-quote on every change, debounced" -- every control
  // that affects price (all of them except pagesMode's own radio, which
  // just toggles which of pages/rangeFrom/rangeTo is live) re-triggers
  // this. An out-of-range selection or no matching shop skips the call
  // entirely rather than sending a request known to fail; the render
  // below only ever shows `quote` when `canQuote` holds, so a stale
  // value left over from before the last change never displays --
  // no synchronous setQuote(null) needed here to enforce that.
  const canQuote = document !== null && selectedShopId !== null && pageError === null;

  useEffect(() => {
    if (!canQuote || document === null || selectedShopId === null) {
      return;
    }
    const config: PrintConfiguration = {
      pages,
      copies,
      paperSize: "A4",
      color,
      sides,
      orientation,
    };
    debouncedFetchQuote(config, document.id, selectedShopId);
  }, [
    canQuote,
    document,
    selectedShopId,
    pages,
    copies,
    color,
    sides,
    orientation,
    debouncedFetchQuote,
  ]);

  if (loadError !== null) {
    return (
      <main className="mx-auto max-w-xl px-6 py-12">
        <p role="alert" style={{ color: "var(--color-error)" }}>
          {loadError}
        </p>
      </main>
    );
  }

  if (document === null) {
    return (
      <main className="mx-auto max-w-xl px-6 py-12">
        <p>Loading…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12 md:flex-row">
      <div className="flex flex-1 flex-col gap-6">
        <h1 className="text-2xl font-bold">Configure your print job</h1>
        <p className="text-sm text-gray-600">{document.filename}</p>

        <fieldset className="flex flex-col gap-2">
          <legend className="font-semibold">Pages</legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={pagesMode === "all"}
              onChange={() => setPagesMode("all")}
            />
            All pages{document.pageCount !== null ? ` (${document.pageCount})` : ""}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={pagesMode === "range"}
              onChange={() => setPagesMode("range")}
            />
            Page range
          </label>
          {pagesMode === "range" && (
            <div className="flex items-center gap-2 pl-6">
              <input
                type="number"
                min={1}
                value={rangeFrom}
                onChange={(event) => setRangeFrom(Number(event.target.value))}
                className="w-20 rounded-md border border-gray-300 px-2 py-1"
                aria-label="From page"
              />
              <span>to</span>
              <input
                type="number"
                min={1}
                value={rangeTo}
                onChange={(event) => setRangeTo(Number(event.target.value))}
                className="w-20 rounded-md border border-gray-300 px-2 py-1"
                aria-label="To page"
              />
            </div>
          )}
          {pageError !== null && (
            <p role="alert" className="text-sm" style={{ color: "var(--color-error)" }}>
              {pageError}
            </p>
          )}
        </fieldset>

        <label className="flex flex-col gap-1">
          <span className="font-semibold">Copies</span>
          <input
            type="number"
            min={1}
            max={500}
            value={copies}
            onChange={(event) => setCopies(Number(event.target.value))}
            className="w-24 rounded-md border border-gray-300 px-2 py-1"
          />
        </label>

        <fieldset className="flex flex-col gap-2">
          <legend className="font-semibold">Color</legend>
          <label className="flex items-center gap-2">
            <input type="radio" checked={color === "BW"} onChange={() => setColor("BW")} />
            Black &amp; white
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={color === "COLOR"} onChange={() => setColor("COLOR")} />
            Color
          </label>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="font-semibold">Sides</legend>
          <label className="flex items-center gap-2">
            <input type="radio" checked={sides === "SINGLE"} onChange={() => setSides("SINGLE")} />
            Single-sided
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={sides === "DOUBLE"} onChange={() => setSides("DOUBLE")} />
            Double-sided
          </label>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="font-semibold">Orientation</legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={orientation === "PORTRAIT"}
              onChange={() => setOrientation("PORTRAIT")}
            />
            Portrait
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={orientation === "LANDSCAPE"}
              onChange={() => setOrientation("LANDSCAPE")}
            />
            Landscape
          </label>
        </fieldset>

        <label className="flex flex-col gap-1">
          <span className="font-semibold">Shop</span>
          <select
            value={selectedShopId ?? ""}
            onChange={(event) => setSelectedShopId(event.target.value || null)}
            className="rounded-md border border-gray-300 px-2 py-1"
          >
            {shops.length === 0 && <option value="">No matching shops</option>}
            {shops.map((shop) => (
              <option key={shop.id} value={shop.id}>
                {shop.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <aside className="flex w-full flex-col gap-3 rounded-lg border border-gray-300 p-4 md:w-80">
        <h2 className="font-semibold">Price</h2>
        {!canQuote && (
          <p className="text-sm text-gray-600">Fix the highlighted fields to see a price.</p>
        )}
        {canQuote && quoteLoading && <p className="text-sm text-gray-600">Updating…</p>}
        {canQuote && quoteError !== null && (
          <p role="alert" className="text-sm" style={{ color: "var(--color-error)" }}>
            {quoteError}
          </p>
        )}
        {canQuote && quote !== null && (
          <div className="flex flex-col gap-2">
            <ul className="flex flex-col gap-1 text-sm">
              {quote.lineItems.map((item) => (
                <li key={item.label} className="flex justify-between">
                  <span>{item.label}</span>
                  <span>{formatMinor(item.amountMinor, quote.currency)}</span>
                </li>
              ))}
              <li className="flex justify-between">
                <span>Platform fee</span>
                <span>{formatMinor(quote.platformFeeMinor, quote.currency)}</span>
              </li>
            </ul>
            <div className="flex justify-between border-t border-gray-300 pt-2 font-semibold">
              <span>Total</span>
              <span>{formatMinor(quote.totalMinor, quote.currency)}</span>
            </div>
          </div>
        )}
      </aside>
    </main>
  );
}

function formatMinor(amountMinor: number, currency: string): string {
  return `${currency} ${(amountMinor / 100).toFixed(2)}`;
}
