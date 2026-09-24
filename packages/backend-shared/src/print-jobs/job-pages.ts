import { resolvePageCount } from "@print-automated/pricing";
import type { PageSelection } from "@print-automated/types";

export type JobPagesFallbackReason = "UNKNOWN_DOCUMENT_PAGE_COUNT" | "INVALID_PAGE_RANGE";

export type JobConfig = { pages: PageSelection; copies?: number };

export interface JobPages {
  /** Resolved pages of ONE copy (a page range counts only its range). */
  pagesPerCopy: number;
  copies: number;
  /** pagesPerCopy x copies: the ONE measure for the page allowance, queue
   * load and usage accrual. */
  total: number;
}

/** The ONE definition of how many pages a print job consumes. Pure. Uses the
 * pricing package's own resolver so a "pages 10-14 of 100" job is 5, not 100.
 * `copies` is the order item's quantity when there is one (it mirrors
 * `printConfiguration.copies`), otherwise the configuration's copies (a legacy
 * job with no order item uses its ORDER's configuration). An unknown document
 * page count counts as 1; a range the resolver rejects falls back to the whole
 * document (over-count, never an exception in the accounting path).
 * `maxJobPages` is compared against `pagesPerCopy`, not `total`: it is the
 * largest document a printer can spool, not a per-period budget. */
export function jobPages(
  configuration: JobConfig,
  documentPageCount: number | null | undefined,
  quantity?: number | null,
  /** Reports each silent fallback (the helper stays pure: callers decide how
   * to log). Never changes the result. */
  onFallback?: (reason: JobPagesFallbackReason) => void,
): JobPages {
  if (documentPageCount == null) {
    // UNDER-counts when the real document is longer than 1 page.
    onFallback?.("UNKNOWN_DOCUMENT_PAGE_COUNT");
  }
  const documentPages = documentPageCount ?? 1;
  let pagesPerCopy: number;
  try {
    pagesPerCopy = resolvePageCount(configuration.pages, documentPages);
  } catch {
    // OVER-counts: a range the resolver rejects counts as the whole document.
    onFallback?.("INVALID_PAGE_RANGE");
    pagesPerCopy = documentPages;
  }
  const copies = quantity ?? configuration.copies ?? 1;
  return { pagesPerCopy, copies, total: pagesPerCopy * copies };
}
