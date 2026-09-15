import type { PageSelection } from "@print-automated/types";
import { InvalidPageSelectionError } from "./types.js";

/** `PrintConfiguration.pages` (§16) is `{mode:"all"}` or an inclusive
 * 1-based range -- neither carries a page *count* on its own; "all"
 * only means something relative to the uploaded document's actual page
 * count (known from 2.7's processing result, not from the
 * configuration itself). Resolving that is this function's only job,
 * kept separate from `computeQuote` so the arithmetic and the
 * range-validity checks aren't tangled together. */
export function resolvePageCount(pages: PageSelection, documentPageCount: number): number {
  if (!Number.isInteger(documentPageCount) || documentPageCount < 1) {
    throw new InvalidPageSelectionError(
      `documentPageCount must be a positive integer, got ${documentPageCount}.`,
    );
  }

  if (pages.mode === "all") {
    return documentPageCount;
  }

  const { from, to } = pages;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) {
    throw new InvalidPageSelectionError(`Invalid page range: from=${from}, to=${to}.`);
  }
  if (to > documentPageCount) {
    throw new InvalidPageSelectionError(
      `Page range to=${to} exceeds the document's ${documentPageCount} pages.`,
    );
  }

  return to - from + 1;
}
