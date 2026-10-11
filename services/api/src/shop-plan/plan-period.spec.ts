import {
  DAY_MS,
  addCalendarMonths,
  cancelledExpiry,
  extendedExpiry,
  extendedExpiryByMonths,
  isActiveAt,
  subscriberCountPhrase,
} from "./plan-period.js";

const now = new Date("2026-10-01T12:00:00.000Z");
const later = (days: number) => new Date(now.getTime() + days * DAY_MS);

describe("isActiveAt", () => {
  it("is active only while the expiry is strictly in the future; null reads as expired", () => {
    expect(isActiveAt(later(1), now)).toBe(true);
    expect(isActiveAt(now, now)).toBe(false);
    expect(isActiveAt(later(-1), now)).toBe(false);
    expect(isActiveAt(null, now)).toBe(false);
  });
});

describe("extendedExpiry (activate / renew / switch)", () => {
  it("extends a still-active plan from its CURRENT expiry, keeping the time already paid for", () => {
    expect(extendedExpiry(later(10), now, 30)).toEqual(later(40));
  });

  it("starts an expired or never-activated plan from now, not from the stale expiry", () => {
    expect(extendedExpiry(later(-5), now, 30)).toEqual(later(30));
    expect(extendedExpiry(null, now, 30)).toEqual(later(30));
  });
});

describe("addCalendarMonths", () => {
  it("adds whole calendar months, not 30-day multiples", () => {
    expect(addCalendarMonths(new Date("2026-10-15T09:30:00.000Z"), 1)).toEqual(
      new Date("2026-11-15T09:30:00.000Z"),
    );
    expect(addCalendarMonths(new Date("2026-10-15T09:30:00.000Z"), 12)).toEqual(
      new Date("2027-10-15T09:30:00.000Z"),
    );
  });

  it("clamps to the last day of a shorter target month", () => {
    expect(addCalendarMonths(new Date("2026-01-31T00:00:00.000Z"), 1)).toEqual(
      new Date("2026-02-28T00:00:00.000Z"),
    );
    expect(addCalendarMonths(new Date("2027-12-31T00:00:00.000Z"), 2)).toEqual(
      new Date("2028-02-29T00:00:00.000Z"),
    );
  });
});

describe("extendedExpiryByMonths (payment-proof approval)", () => {
  it("extends a still-active plan from its current expiry", () => {
    const current = new Date("2026-10-20T12:00:00.000Z");
    expect(extendedExpiryByMonths(current, now, 3)).toEqual(new Date("2027-01-20T12:00:00.000Z"));
  });

  it("starts an expired or never-activated plan from now", () => {
    expect(extendedExpiryByMonths(later(-5), now, 1)).toEqual(new Date("2026-11-01T12:00:00.000Z"));
    expect(extendedExpiryByMonths(null, now, 12)).toEqual(new Date("2027-10-01T12:00:00.000Z"));
  });
});

describe("cancelledExpiry", () => {
  it("expires a still-active plan right now", () => {
    expect(cancelledExpiry(later(10), now)).toEqual(now);
  });

  it("never pushes an already-expired (or never-activated) plan's expiry forward", () => {
    expect(cancelledExpiry(later(-3), now)).toEqual(later(-3));
    expect(cancelledExpiry(null, now)).toBeNull();
  });
});

describe("subscriberCountPhrase", () => {
  it("agrees in number", () => {
    expect(subscriberCountPhrase(1)).toBe("1 business is");
    expect(subscriberCountPhrase(2)).toBe("2 businesses are");
    expect(subscriberCountPhrase(17)).toBe("17 businesses are");
  });
});
