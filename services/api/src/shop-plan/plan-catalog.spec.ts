import { FEATURE_CATALOG, PLAN_CATALOG } from "./plan-catalog.js";

describe("plan catalog", () => {
  const keys = new Set(FEATURE_CATALOG.map((f) => f.key));

  it("has unique feature keys and unique section+label", () => {
    expect(keys.size).toBe(FEATURE_CATALOG.length);
    expect(new Set(FEATURE_CATALOG.map((f) => `${f.section}|${f.label}`)).size).toBe(
      FEATURE_CATALOG.length,
    );
  });

  it("every plan value refers to a defined feature and no plan misses a row", () => {
    for (const plan of PLAN_CATALOG) {
      for (const key of Object.keys(plan.values)) expect(keys.has(key)).toBe(true);
      for (const key of keys) expect(plan.values[key]).toBeDefined();
    }
  });

  it("paid plans are PKR with annual = 10x monthly; enterprise is contact-only", () => {
    const paid = PLAN_CATALOG.filter((p) => !p.contactOnly);
    expect(paid.map((p) => p.name)).toEqual(["Starter", "Growth", "Business"]);
    expect(paid.map((p) => p.priceMinor)).toEqual([600_000, 1_100_000, 1_500_000]);
    expect(paid.map((p) => p.annualPriceMinor)).toEqual([6_000_000, 11_000_000, 15_000_000]);
    for (const p of paid) {
      expect(p.currency).toBe("PKR");
      expect(p.annualPriceMinor).toBe(p.priceMinor * 10);
    }
    const enterprise = PLAN_CATALOG.find((p) => p.name === "Enterprise")!;
    expect(enterprise.contactOnly).toBe(true);
    expect(new Set(Object.values(enterprise.values))).toEqual(new Set(["Custom"]));
  });

  it("only Growth is highlighted", () => {
    expect(PLAN_CATALOG.filter((p) => p.highlighted).map((p) => p.name)).toEqual(["Growth"]);
  });
});
