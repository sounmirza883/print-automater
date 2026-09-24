export type PageLimitPeriod = "DAILY" | "WEEKLY" | "MONTHLY";

/** The ONE definition of a page-limit period boundary. Pure: the clock is
 * passed in. Everything is computed in UTC (never local time), so there are
 * no DST shifts: a day is exactly 24h, a week starts Monday 00:00 UTC (ISO
 * 8601), a month starts on the 1st 00:00 UTC. Rollover is implicit -- the
 * returned start is part of the usage row's key, so a new period simply
 * addresses a new row and there is no reset job. */
export function periodStart(period: PageLimitPeriod, now: Date): Date {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const day = now.getUTCDate();
  switch (period) {
    case "DAILY":
      return new Date(Date.UTC(y, m, day));
    case "WEEKLY": {
      const sinceMonday = (now.getUTCDay() + 6) % 7;
      return new Date(Date.UTC(y, m, day - sinceMonday));
    }
    case "MONTHLY":
      return new Date(Date.UTC(y, m, 1));
  }
}
