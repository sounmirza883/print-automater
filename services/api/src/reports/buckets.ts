import type { ReportGroupBy } from "@print-automated/types";

const DAY_MS = 86_400_000;

function utcStart(date: Date, unit: ReportGroupBy): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const day = date.getUTCDate();
  switch (unit) {
    case "day":
      return new Date(Date.UTC(y, m, day));
    case "week":
      // ISO week: Monday 00:00 UTC, the same boundary as Postgres date_trunc('week').
      return new Date(Date.UTC(y, m, day - ((date.getUTCDay() + 6) % 7)));
    case "month":
      return new Date(Date.UTC(y, m, 1));
  }
}

function label(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The label (`YYYY-MM-DD` of the bucket's first day, UTC) of the bucket containing `date`. */
export function bucketStart(date: Date, unit: ReportGroupBy): string {
  return label(utcStart(date, unit));
}

/** Every bucket label from the bucket of `from` through the bucket of `to`, in order.
 * Used to fill zero rows so a chart never has gaps. */
export function bucketKeys(from: Date, to: Date, unit: ReportGroupBy): string[] {
  const keys: string[] = [];
  let cursor = utcStart(from, unit);
  const last = utcStart(to, unit).getTime();
  while (cursor.getTime() <= last) {
    keys.push(label(cursor));
    cursor =
      unit === "month"
        ? new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))
        : new Date(cursor.getTime() + (unit === "week" ? 7 : 1) * DAY_MS);
  }
  return keys;
}
