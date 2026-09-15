import { InvalidPageSelectionError, resolvePageCount } from "@print-automated/pricing";
import type {
  PageSelection,
  PrinterCapabilities,
  PrintConfiguration,
} from "@print-automated/types";

/** Reuses the exact same validation packages/pricing's `computeQuote`
 * (and, server-side, orders.service.ts) runs -- not a second,
 * hand-rolled copy of the same rule that could quietly drift from it.
 * §4.6's "blocked client-side AND server-side" means literally the
 * same check running in both places, not two independently-written
 * ones that happen to agree today. */
export function validatePageSelection(
  pages: PageSelection,
  documentPageCount: number,
): string | null {
  try {
    resolvePageCount(pages, documentPageCount);
    return null;
  } catch (error) {
    return error instanceof InvalidPageSelectionError ? error.message : "Invalid page selection.";
  }
}

export interface ShopListItem {
  id: string;
  name: string;
  address: string;
  status: string;
  capabilities: PrinterCapabilities | null;
  distanceKm: number | null;
  estimatedProcessingTimeMinutes: number | null;
}

/** §17/§18 shop discovery is a public endpoint (4.3) -- called directly
 * against the real backend (CORS already allows this origin, 1.1),
 * never through the authenticated `/api/*` proxy, since there's no
 * cookie/token involved at all. */
export async function fetchMatchingShops(
  config: Pick<PrintConfiguration, "paperSize" | "color" | "sides">,
  fetchImpl: typeof fetch = fetch,
): Promise<ShopListItem[]> {
  const query = new URLSearchParams({ paper: config.paperSize });
  if (config.color === "COLOR") {
    query.set("color", "true");
  }
  if (config.sides === "DOUBLE") {
    query.set("duplex", "true");
  }

  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  const response = await fetchImpl(`${apiBaseUrl}/v1/shops?${query.toString()}`);
  if (!response.ok) {
    throw new Error("Could not load shops.");
  }
  return (await response.json()) as ShopListItem[];
}

export interface QuoteLineItem {
  label: string;
  amountMinor: number;
}

export interface QuoteResult {
  lineItems: QuoteLineItem[];
  subtotalMinor: number;
  platformFeeMinor: number;
  totalMinor: number;
  currency: string;
}

/** Through the authenticated proxy (4.5's authenticated-proxy.ts) --
 * unlike shop discovery, a quote is tied to the requester's own
 * document (§64 ownership) and needs the session cookie translated
 * into a bearer token. */
export async function fetchQuote(
  documentId: string,
  shopId: string,
  printConfiguration: PrintConfiguration,
  fetchImpl: typeof fetch = fetch,
): Promise<QuoteResult> {
  const response = await fetchImpl("/api/orders/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ documentId, shopId, printConfiguration }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as
      { message?: unknown } | undefined;
    throw new Error(typeof body?.message === "string" ? body.message : "Could not get a quote.");
  }
  return (await response.json()) as QuoteResult;
}

/** §4.6: "Live re-quote on every change, debounced." A trailing-edge
 * debounce -- only the last call within `delayMs` of silence actually
 * runs, so rapid control changes (e.g. clicking copies up several
 * times) don't fire a quote request per click. */
export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  delayMs: number,
): (...args: Args) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Args) => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => fn(...args), delayMs);
  };
}
