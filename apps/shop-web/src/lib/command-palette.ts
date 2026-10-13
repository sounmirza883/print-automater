import type { NavItem } from "@/lib/nav";

export interface PaletteEntry {
  id: string;
  label: string;
  href: string;
  /** One muted line under the label. */
  hint: string;
}

/** The orders search box and the API both stop at 100 characters. */
const MAX_QUERY = 100;

/** The option the arrow keys move to: one step from `active`, wrapping at both
 * ends. With no options there is nowhere to go and the answer is 0. */
export function movePaletteIndex(active: number, count: number, step: 1 | -1): number {
  if (count <= 0) {
    return 0;
  }
  return (((active + step) % count) + count) % count;
}

/** What "Search or jump to" lists for the text typed so far.
 *
 * `items` are the screens this person may open (already permission-filtered).
 * Screens whose name starts with the text come first, then screens that
 * mention it anywhere in their name or description. With `canSearchOrders`,
 * typed text also offers an orders search, LAST: typing "printers" should land
 * on Printers, and when no screen matches the search is the only row, so Enter
 * runs it. */
export function paletteEntries(
  query: string,
  items: readonly NavItem[],
  canSearchOrders: boolean,
): PaletteEntry[] {
  // Cut by code point, not UTF-16 unit: halving an emoji at the cap leaves a
  // lone surrogate, and `encodeURIComponent` throws on one. Trim again because
  // the cap can land just after a space.
  const text = Array.from(query.trim()).slice(0, MAX_QUERY).join("").trim();
  const needle = text.toLowerCase();
  const screens: PaletteEntry[] = items.map((item) => ({
    id: item.id,
    label: item.label,
    href: item.href,
    hint: item.blurb,
  }));
  if (needle === "") {
    return screens;
  }
  const startsWith = (entry: PaletteEntry): boolean => entry.label.toLowerCase().startsWith(needle);
  const mentions = (entry: PaletteEntry): boolean =>
    entry.label.toLowerCase().includes(needle) || entry.hint.toLowerCase().includes(needle);
  const matches = [
    ...screens.filter(startsWith),
    ...screens.filter((entry) => !startsWith(entry) && mentions(entry)),
  ];
  if (!canSearchOrders) {
    return matches;
  }
  return [
    ...matches,
    {
      id: "search-orders",
      label: `Search orders for "${text}"`,
      href: `/orders?q=${encodeURIComponent(text)}`,
      hint: "Order number, customer or document",
    },
  ];
}
