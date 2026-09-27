import type { ReportName } from "@print-automated/api-client";
import type { ReportGroupBy } from "@print-automated/types";

/** 23.29 (PRD 72-74): the reports screen's catalogue, time ranges and formatting. Pure
 * functions, no React, so they are unit-tested directly. Every date here is UTC, because the
 * API buckets in UTC (a day starts 00:00 UTC, a week on Monday, a month on the 1st). */

export interface ReportDefinition {
  name: ReportName;
  title: string;
  /** One line under the title saying what the report counts. */
  summary: string;
  /** Has a per-period series (its rows, or a series in its totals), so the day/week/month
   * grouping control applies. */
  periodic: boolean;
}

export const REPORTS: readonly ReportDefinition[] = [
  {
    name: "orders",
    title: "Orders",
    summary: "Orders placed in the period and what became of them.",
    periodic: true,
  },
  {
    name: "revenue",
    title: "Revenue",
    summary: "Money taken and refunded, by the day each payment or refund happened.",
    periodic: true,
  },
  {
    name: "printing-volume",
    title: "Printing volume",
    summary: "Jobs and pages printed, colour and black and white.",
    periodic: true,
  },
  {
    name: "printers",
    title: "Printers",
    summary: "What each printer printed, what failed, and its current page allowance.",
    periodic: false,
  },
  {
    name: "operator-workload",
    title: "Operator workload",
    summary: "Jobs recorded against each operator in the period.",
    periodic: false,
  },
  {
    name: "paper-consumption",
    title: "Paper used",
    summary: "Sheets taken from stock by printed jobs, per stock item.",
    periodic: true,
  },
  {
    name: "supplier-purchases",
    title: "Supplier purchases",
    summary: "Purchase orders raised with each supplier and what they cost.",
    periodic: true,
  },
];

export function reportDefinition(name: string): ReportDefinition {
  return REPORTS.find((report) => report.name === name) ?? (REPORTS[0] as ReportDefinition);
}

export type RangePreset = "last7" | "last30" | "last90" | "thisMonth" | "last12Months" | "custom";

export const RANGE_PRESETS: ReadonlyArray<{
  value: Exclude<RangePreset, "custom">;
  label: string;
}> = [
  { value: "last7", label: "Last 7 days" },
  { value: "last30", label: "Last 30 days" },
  { value: "last90", label: "Last 90 days" },
  { value: "thisMonth", label: "This month" },
  { value: "last12Months", label: "Last 12 months" },
];

/** The screen's state, as it lives in the URL (shareable, survives reload). `from` and `to`
 * are calendar dates (`YYYY-MM-DD`, UTC); `to` is INCLUSIVE here and made exclusive only when
 * the API is called. */
export interface ReportsQuery {
  report: ReportName;
  range: RangePreset;
  from: string;
  to: string;
  groupBy: ReportGroupBy;
  currency: string;
}

const DAY_MS = 86_400_000;
/** The API refuses ranges longer than this (its MAX_DASHBOARD_RANGE_DAYS). */
export const MAX_RANGE_DAYS = 366;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const GROUP_BY: readonly ReportGroupBy[] = ["day", "week", "month"];

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function parseDate(text: string): Date | null {
  if (!DATE.test(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || isoDate(date) !== text ? null : date;
}

/** The inclusive calendar dates a preset covers, ending today (UTC). */
export function presetDates(
  preset: Exclude<RangePreset, "custom">,
  now: Date,
): {
  from: string;
  to: string;
} {
  const today = utcMidnight(now);
  const back = (days: number) => new Date(today.getTime() - days * DAY_MS);
  switch (preset) {
    case "last7":
      return { from: isoDate(back(6)), to: isoDate(today) };
    case "last30":
      return { from: isoDate(back(29)), to: isoDate(today) };
    case "last90":
      return { from: isoDate(back(89)), to: isoDate(today) };
    case "thisMonth":
      return {
        from: isoDate(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))),
        to: isoDate(today),
      };
    case "last12Months":
      return {
        from: isoDate(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11, 1))),
        to: isoDate(today),
      };
  }
}

/** A sensible grouping for a preset: daily bars stop being readable past about 90. */
export function defaultGroupBy(preset: RangePreset): ReportGroupBy {
  if (preset === "last90") return "week";
  if (preset === "last12Months") return "month";
  return "day";
}

type ParamReader = { get(name: string): string | null };

/** Reads the URL, correcting anything invalid (unknown report, bad dates, an over-long or
 * backwards custom range) to the defaults rather than failing. */
export function parseReportsQuery(params: ParamReader, now: Date = new Date()): ReportsQuery {
  const report = reportDefinition(params.get("report") ?? "").name;
  const rawRange = params.get("range") ?? "";
  let range: RangePreset = RANGE_PRESETS.some((p) => p.value === rawRange)
    ? (rawRange as RangePreset)
    : rawRange === "custom"
      ? "custom"
      : "last30";
  let from = "";
  let to = "";
  if (range === "custom") {
    const start = parseDate(params.get("from") ?? "");
    const end = parseDate(params.get("to") ?? "");
    const span = start && end ? (end.getTime() - start.getTime()) / DAY_MS + 1 : 0;
    if (start && end && span >= 1 && span <= MAX_RANGE_DAYS) {
      from = isoDate(start);
      to = isoDate(end);
    } else {
      range = "last30";
    }
  }
  if (range !== "custom") {
    ({ from, to } = presetDates(range, now));
  }
  const rawGroup = params.get("groupBy") ?? "";
  const groupBy = (GROUP_BY as readonly string[]).includes(rawGroup)
    ? (rawGroup as ReportGroupBy)
    : defaultGroupBy(range);
  const rawCurrency = (params.get("currency") ?? "").toUpperCase();
  return {
    report,
    range,
    from,
    to,
    groupBy,
    currency: /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : "",
  };
}

/** The URL query for a state; defaults are left out so links stay short. */
export function reportsSearch(query: ReportsQuery): string {
  const params = new URLSearchParams();
  params.set("report", query.report);
  if (query.range !== "last30") params.set("range", query.range);
  if (query.range === "custom") {
    params.set("from", query.from);
    params.set("to", query.to);
  }
  if (query.groupBy !== defaultGroupBy(query.range)) params.set("groupBy", query.groupBy);
  if (query.currency !== "") params.set("currency", query.currency);
  return params.toString();
}

/** What the API is called with: `to` becomes the next day's midnight (exclusive end). */
export function apiParams(query: ReportsQuery): {
  from: string;
  to: string;
  groupBy: ReportGroupBy;
  currency?: string;
} {
  const end = parseDate(query.to) ?? new Date();
  return {
    from: `${query.from}T00:00:00.000Z`,
    to: new Date(end.getTime() + DAY_MS).toISOString(),
    groupBy: query.groupBy,
    ...(query.currency !== "" ? { currency: query.currency } : {}),
  };
}

/** Checks a custom range typed by a person; null when it is usable. */
export function customRangeProblem(from: string, to: string): string | null {
  const start = parseDate(from);
  const end = parseDate(to);
  if (!start || !end) return "Choose a start and an end date.";
  const span = (end.getTime() - start.getTime()) / DAY_MS + 1;
  if (span < 1) return "The end date must be on or after the start date.";
  if (span > MAX_RANGE_DAYS) return `A report can cover at most ${MAX_RANGE_DAYS} days.`;
  return null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-21" as a period label: "21 Sep" (day), "w/c 21 Sep" (week), "Sep 2026" (month).
 * Built by hand, not with Intl, so it is identical on the server, in every browser and in
 * tests (the API's bucket is already the UTC first day of the period). */
export function bucketLabel(bucket: string, groupBy: ReportGroupBy | null): string {
  const date = parseDate(bucket);
  if (!date) return bucket;
  const day = date.getUTCDate();
  const month = MONTHS[date.getUTCMonth()] as string;
  if (groupBy === "month") return `${month} ${date.getUTCFullYear()}`;
  if (groupBy === "week") return `w/c ${day} ${month}`;
  return `${day} ${month}`;
}

/** "27 Aug – 26 Sep 2026" for the page subtitle. */
export function rangeLabel(from: string, to: string): string {
  const start = parseDate(from);
  const end = parseDate(to);
  if (!start || !end) return "";
  const endText = `${end.getUTCDate()} ${MONTHS[end.getUTCMonth()]} ${end.getUTCFullYear()}`;
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const startText = `${start.getUTCDate()} ${MONTHS[start.getUTCMonth()]}${
    sameYear ? "" : ` ${start.getUTCFullYear()}`
  }`;
  return `${startText} – ${endText}`;
}

/** Clean y-axis ticks from 0 to at least `max`: steps of 1, 2 or 5 x 10^k, about four of
 * them. Always at least [0, 1] so an all-zero chart still has an axis. */
export function niceTicks(max: number, target = 4): number[] {
  const top = Math.max(0, max);
  if (top === 0) return [0, 1];
  const rough = top / target;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step =
    [1, 2, 5, 10].map((m) => m * magnitude).find((candidate) => candidate >= rough) ??
    10 * magnitude;
  const ticks: number[] = [];
  for (let value = 0; value < top + step; value += step) {
    ticks.push(Math.round(value * 1e9) / 1e9);
    if (value >= top) break;
  }
  return ticks;
}

/** Which x positions get a label: first, last, and evenly spaced ones between, at most
 * `max` of them, so labels never collide. */
export function labelledIndexes(count: number, max = 6): number[] {
  if (count <= 0) return [];
  if (count <= max) return Array.from({ length: count }, (_, i) => i);
  const step = (count - 1) / (max - 1);
  return Array.from(new Set(Array.from({ length: max }, (_, i) => Math.round(i * step))));
}

/** "4 min 5 s", "38 s", "1 h 2 min"; "—" when there is no figure. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  const total = Math.round(seconds);
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) {
    const rest = total % 60;
    return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** The download's file name: `revenue-2026-08-28-to-2026-09-26.csv`. */
export function csvFileName(query: Pick<ReportsQuery, "report" | "from" | "to">): string {
  return `${query.report}-${query.from}-to-${query.to}.csv`;
}
