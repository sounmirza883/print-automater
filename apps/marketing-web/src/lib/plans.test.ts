import {
  annualSaving,
  billedNote,
  cardBullets,
  cellKind,
  fetchPlans,
  formatPlanPrice,
  groupFeatures,
  monthlyYearTotal,
  periodUnit,
  priceLabel,
  type PublicFeature,
  type PublicPlan,
} from "./plans";

const plan = (over: Partial<PublicPlan> = {}): PublicPlan => ({
  name: "Starter",
  description: null,
  priceMinor: 600_000,
  currency: "PKR",
  billingPeriodDays: 30,
  annualPriceMinor: 6_000_000,
  highlighted: false,
  contactOnly: false,
  ...over,
});

const feature = (over: Partial<PublicFeature> = {}): PublicFeature => ({
  section: "Capacity",
  label: "Printers",
  showOnCard: true,
  cardText: null,
  values: {},
  ...over,
});

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

describe("annual pricing", () => {
  it("struck-out total is monthly x 12 and the saving is the difference", () => {
    expect(monthlyYearTotal(plan())).toBe(7_200_000);
    expect(annualSaving(plan())).toBe(1_200_000);
  });

  it("no saving when there is no annual price, or it is not cheaper", () => {
    expect(annualSaving(plan({ annualPriceMinor: null }))).toBe(0);
    expect(annualSaving(plan({ annualPriceMinor: 7_200_000 }))).toBe(0);
    expect(annualSaving(plan({ annualPriceMinor: 9_000_000 }))).toBe(0);
  });
});

describe("priceLabel", () => {
  it("never prints PKR 0 for a contact-only plan, but a paid plan at 0 still prints it", () => {
    expect(priceLabel(plan({ contactOnly: true, priceMinor: 0 }), "monthly")).toBe(
      "Custom pricing",
    );
    expect(priceLabel(plan({ contactOnly: true, priceMinor: 0 }), "annual")).toBe("Custom pricing");
    expect(priceLabel(plan({ priceMinor: 0, annualPriceMinor: null }), "monthly")).toBe("PKR 0");
  });

  it("annual view shows the annual price, or falls back to monthly when there is none", () => {
    expect(priceLabel(plan(), "monthly")).toBe("PKR 6,000");
    expect(priceLabel(plan(), "annual")).toBe("PKR 60,000");
    expect(priceLabel(plan({ annualPriceMinor: null }), "annual")).toBe("PKR 6,000");
  });
});

describe("cardBullets", () => {
  const features = [
    feature({ label: "Printers", cardText: "{value} printers", values: { Starter: "2" } }),
    feature({ label: "Routing", cardText: null, values: { Starter: "true" } }),
    feature({ label: "Reports", cardText: "Essential daily reports", values: { Starter: "true" } }),
    feature({ label: "Audit log", showOnCard: false, values: { Starter: "true" } }),
    feature({ label: "Rules", values: { Starter: "false" } }),
    feature({ label: "Exports", values: {} }),
    feature({ label: "Support", cardText: null, values: { Starter: "Email" } }),
  ];

  it("renders templates, ticks and text; skips dashes, missing values and hidden rows", () => {
    expect(cardBullets(plan(), features)).toEqual([
      "2 printers",
      "Routing",
      "Essential daily reports",
      "Support: Email",
    ]);
  });

  it("a plan with no values has no bullets", () => {
    expect(cardBullets(plan({ name: "Nobody" }), features)).toEqual([]);
  });

  it("a card template without {value} falls back to label: value for text", () => {
    const rows = [
      feature({ label: "Support", cardText: "Priority help", values: { Starter: "Email" } }),
    ];
    expect(cardBullets(plan(), rows)).toEqual(["Support: Email"]);
  });
});

describe("groupFeatures / cellKind", () => {
  it("groups by section in first-appearance order", () => {
    const rows = [
      feature({ section: "A", label: "1" }),
      feature({ section: "B", label: "2" }),
      feature({ section: "A", label: "3" }),
    ];
    expect(groupFeatures(rows).map((g) => [g.section, g.rows.map((r) => r.label)])).toEqual([
      ["A", ["1", "3"]],
      ["B", ["2"]],
    ]);
  });

  it("classifies a cell as tick, dash or text", () => {
    expect(cellKind("true")).toEqual({ kind: "yes" });
    expect(cellKind("false")).toEqual({ kind: "no" });
    expect(cellKind(undefined)).toEqual({ kind: "no" });
    expect(cellKind("Unlimited")).toEqual({ kind: "text", text: "Unlimited" });
  });
});

describe("fetchPlans", () => {
  const body = {
    items: [plan()],
    features: [feature({ values: { Starter: "2" } })],
  };
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  const stub = (impl: () => Promise<Response>) => {
    globalThis.fetch = jest.fn(impl) as unknown as typeof fetch;
  };
  const json = (payload: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(payload), { status }));

  it("returns the API's plans and feature rows, asking its public /v1/plans route", async () => {
    stub(() => json(body));
    await expect(fetchPlans("http://api.test")).resolves.toEqual({
      plans: body.items,
      features: body.features,
    });
    expect((globalThis.fetch as jest.Mock).mock.calls[0][0]).toBe("http://api.test/v1/plans");
  });

  it("returns empty lists (not null) when the admin has no live plans", async () => {
    stub(() => json({ items: [], features: [] }));
    await expect(fetchPlans("http://api.test")).resolves.toEqual({ plans: [], features: [] });
  });

  it("returns null when the API fails, errors or answers with the wrong shape", async () => {
    stub(() => json({ message: "down" }, 503));
    await expect(fetchPlans("http://api.test")).resolves.toBeNull();
    stub(() => Promise.reject(new Error("ECONNREFUSED")));
    await expect(fetchPlans("http://api.test")).resolves.toBeNull();
    stub(() => json({ items: [{ name: "x" }], features: [] }));
    await expect(fetchPlans("http://api.test")).resolves.toBeNull();
    stub(() => json({ items: [plan()] })); // features missing
    await expect(fetchPlans("http://api.test")).resolves.toBeNull();
    stub(() => json({ items: [plan()], features: [{ label: 1 }] }));
    await expect(fetchPlans("http://api.test")).resolves.toBeNull();
    stub(() => json({ nope: true }));
    await expect(fetchPlans("http://api.test")).resolves.toBeNull();
  });
});
