import { InvalidPageSelectionError, resolvePageCount } from "@print-automated/pricing";
import type { PageSelection } from "@print-automated/types";

/** Reuses the exact same validation packages/pricing's `computeQuote`
 * (and, server-side, orders.service.ts) runs -- not a second,
 * hand-rolled copy of the same rule that could quietly drift from it.
 * §4.6's "blocked client-side AND server-side" means literally the
 * same check running in both places, not two independently-written
 * ones that happen to agree today.
 *
 * Moved out of the old, deleted `configure-quote.ts` (§4.5's
 * authenticated shop-discovery/quote flow) because the QR guest-order
 * wizard (`app/s/[shopId]/upload/page.tsx`) is this function's only
 * remaining caller and has no dependency on the rest of that file. */
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
