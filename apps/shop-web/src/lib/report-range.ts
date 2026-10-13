/** Date ranges for the admin payment report. A range is [from, to): `to` is the START of the
 * day after the last day shown, so "1 Oct - 31 Oct" is 1 Oct 00:00 to 1 Nov 00:00. Every boundary
 * is the viewer's local midnight (that is what "today" means to them); the API is told their UTC
 * offset so its per-day buckets agree. Pure, so unit-tested. */

export type RangePreset =
  | "today"
  | "thisMonth"
  | "lastMonth"
  | "last3Months"
  | "last6Months"
  | "thisYear"
  | "last12Months"
  | "custom";

export const RANGE_PRESETS: ReadonlyArray<{ id: RangePreset; label: string }> = [
  { id: "today", label: "Today" },
  { id: "thisMonth", label: "This month" },
  { id: "lastMonth", label: "Last month" },
  { id: "last3Months", label: "Last 3 months" },
  { id: "last6Months", label: "Last 6 months" },
  { id: "thisYear", label: "This year" },
  { id: "last12Months", label: "Last 12 months" },
  { id: "custom", label: "Custom dates" },
];

export interface ReportRange {
  /** Inclusive. */
  from: Date;
  /** Exclusive. */
  to: Date;
}

/** Same cap as the API (5 years). */
export const MAX_REPORT_DAYS = 1830;

const midnight = (year: number, month: number, day: number): Date => new Date(year, month, day);

/** "Last N months" = N calendar months ending with the current one (this month plus N-1 before). */
function lastMonths(now: Date, count: number): ReportRange {
  return {
    from: midnight(now.getFullYear(), now.getMonth() - (count - 1), 1),
    to: midnight(now.getFullYear(), now.getMonth() + 1, 1),
  };
}

export function rangeForPreset(preset: Exclude<RangePreset, "custom">, now: Date): ReportRange {
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (preset) {
    case "today":
      return { from: midnight(y, m, now.getDate()), to: midnight(y, m, now.getDate() + 1) };
    case "thisMonth":
      return lastMonths(now, 1);
    case "lastMonth":
      return { from: midnight(y, m - 1, 1), to: midnight(y, m, 1) };
    case "last3Months":
      return lastMonths(now, 3);
    case "last6Months":
      return lastMonths(now, 6);
    case "thisYear":
      return { from: midnight(y, 0, 1), to: midnight(y + 1, 0, 1) };
    case "last12Months":
      return lastMonths(now, 12);
  }
}

/** Local `YYYY-MM-DD` for an `<input type="date">`. */
export function toInputDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseInputDate(text: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match === null) {
    return null;
  }
  const date = midnight(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  // Rejects 2026-02-31 (JavaScript would roll it into March).
  return toInputDate(date) === text ? date : null;
}

export type CustomRangeResult = { ok: true; range: ReportRange } | { ok: false; error: string };

/** A custom range from two date inputs; both days are INCLUDED (the end day is whole). */
export function rangeFromInputs(fromText: string, toText: string): CustomRangeResult {
  const from = parseInputDate(fromText);
  const last = parseInputDate(toText);
  if (from === null || last === null) {
    return { ok: false, error: "Choose both a start and an end date." };
  }
  if (last < from) {
    return { ok: false, error: "The end date is before the start date." };
  }
  const to = midnight(last.getFullYear(), last.getMonth(), last.getDate() + 1);
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000);
  if (days > MAX_REPORT_DAYS) {
    return { ok: false, error: "A report can cover at most 5 years." };
  }
  return { ok: true, range: { from, to } };
}

/** Minutes the viewer's clock is AHEAD of UTC (Pakistan = 300), the API's `tzOffsetMinutes`. */
export function tzOffsetMinutes(now: Date): number {
  // `getTimezoneOffset` is UTC minus local, so negate (and avoid -0).
  return -now.getTimezoneOffset() || 0;
}

/** "1 Oct 2026 - 31 Oct 2026", or one date for a single day. */
export function rangeLabel(range: ReportRange): string {
  const format = (date: Date) =>
    date.toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" });
  const last = new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate() - 1);
  return range.from.getTime() === last.getTime()
    ? format(range.from)
    : `${format(range.from)} – ${format(last)}`;
}

/** `payments_2026-10-01_to_2026-10-31.xlsx`, matching the name the API sends. */
export function exportFileName(range: ReportRange, extension: "csv" | "xlsx"): string {
  const last = new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate() - 1);
  return `payments_${toInputDate(range.from)}_to_${toInputDate(last)}.${extension}`;
}

/** How a period's label reads in the table: a month for monthly buckets, a day otherwise. */
export function periodLabel(period: string, groupBy: "day" | "month"): string {
  const [y, m, d] = period.split("-").map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  return groupBy === "month"
    ? date.toLocaleDateString("en", { month: "long", year: "numeric" })
    : date.toLocaleDateString("en", { weekday: "short", day: "numeric", month: "short" });
}
