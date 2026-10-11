import { billedNote, fetchPlans, formatPlanPrice, periodUnit } from "./plans";

describe("formatPlanPrice", () => {
  it("shows PKR whole amounts without empty decimals (paisa on the wire)", () => {
    expect(formatPlanPrice(250_000, "PKR")).toBe("PKR 2,500");
    expect(formatPlanPrice(1_200_000, "PKR")).toBe("PKR 12,000");
  });

  it("keeps real decimals", () => {
    expect(formatPlanPrice(250_050, "PKR")).toBe("PKR 2,500.50");
  });

  it("uses the currency's own minor-unit scale", () => {
    expect(formatPlanPrice(2_500, "JPY")).toBe("JPY 2,500");
    expect(formatPlanPrice(2_500_500, "KWD")).toBe("KWD 2,500.500");
  });

  it("prints a free plan as zero", () => {
    expect(formatPlanPrice(0, "PKR")).toBe("PKR 0");
  });
});

describe("billing period wording", () => {
  it("names the common periods", () => {
    expect(periodUnit(30)).toBe("month");
    expect(periodUnit(365)).toBe("year");
    expect(periodUnit(7)).toBe("week");
    expect(billedNote(30)).toBe("Billed monthly.");
    expect(billedNote(365)).toBe("Billed yearly.");
  });

  it("falls back to a day count", () => {
    expect(periodUnit(45)).toBe("45 days");
    expect(periodUnit(1)).toBe("day");
    expect(billedNote(45)).toBe("Billed every 45 days.");
  });
});

describe("fetchPlans", () => {
  const plan = {
    name: "Standard",
    priceMinor: 250_000,
    currency: "PKR",
    billingPeriodDays: 30,
    description: null,
  };
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  const stub = (impl: () => Promise<Response>) => {
    globalThis.fetch = jest.fn(impl) as unknown as typeof fetch;
  };
  const json = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));

  it("returns the API's plans, asking its public /v1/plans route", async () => {
    stub(() => json({ items: [plan] }));
    await expect(fetchPlans("http://api.test")).resolves.toEqual([plan]);
    expect((globalThis.fetch as jest.Mock).mock.calls[0][0]).toBe("http://api.test/v1/plans");
  });

  it("returns an empty list (not null) when the admin has no live plans", async () => {
    stub(() => json({ items: [] }));
    await expect(fetchPlans("http://api.test")).resolves.toEqual([]);
  });

  it("returns null when the API fails, errors or answers with the wrong shape", async () => {
    stub(() => json({ message: "down" }, 503));
    await expect(fetchPlans("http://api.test")).resolves.toBeNull();
    stub(() => Promise.reject(new Error("ECONNREFUSED")));
    await expect(fetchPlans("http://api.test")).resolves.toBeNull();
    stub(() => json({ items: [{ name: "x" }] }));
    await expect(fetchPlans("http://api.test")).resolves.toBeNull();
    stub(() => json({ nope: true }));
    await expect(fetchPlans("http://api.test")).resolves.toBeNull();
  });
});
