import {
  createPrinterRuleSchema,
  reorderPrinterRulesSchema,
  updatePrinterRuleSchema,
} from "./printer-rule.schema.js";

const shopId = "6ddee6f2-64f4-42ed-8e6e-f51691514da5";
const p1 = "0d3e1c54-8b64-4a0e-a3c6-6a8a1f6a3a01";
const p2 = "0d3e1c54-8b64-4a0e-a3c6-6a8a1f6a3a02";
const base = { shopId, name: "Colour to the laser", action: "PREFER", printerIds: [p1] };

describe("createPrinterRuleSchema (22.3)", () => {
  const ok = (v: unknown) => createPrinterRuleSchema.safeParse(v).success;

  it("accepts a minimal rule and defaults conditions to {} and enabled to true", () => {
    const parsed = createPrinterRuleSchema.parse(base);
    expect(parsed.conditions).toEqual({});
    expect(parsed.enabled).toBe(true);
  });

  it("needs 1..50 unique printer uuids", () => {
    expect(ok({ ...base, printerIds: [] })).toBe(false);
    expect(ok({ ...base, printerIds: [p1, p1] })).toBe(false);
    expect(ok({ ...base, printerIds: ["nope"] })).toBe(false);
    expect(ok({ ...base, printerIds: [p1, p2] })).toBe(true);
    const many = Array.from(
      { length: 51 },
      (_, i) => `0d3e1c54-8b64-4a0e-a3c6-6a8a1f6a${String(i).padStart(4, "0")}`,
    );
    expect(ok({ ...base, printerIds: many })).toBe(false);
  });

  it("action is PREFER or AVOID only; name is required and bounded", () => {
    expect(ok({ ...base, action: "AVOID" })).toBe(true);
    expect(ok({ ...base, action: "FORCE" })).toBe(false);
    expect(ok({ ...base, name: "   " })).toBe(false);
    expect(ok({ ...base, name: "x".repeat(81) })).toBe(false);
  });

  it("conditions use the real print-configuration enums and a sane page range", () => {
    expect(ok({ ...base, conditions: { color: "COLOR", sides: "DOUBLE", paperSize: "A3" } })).toBe(
      true,
    );
    expect(ok({ ...base, conditions: { color: "PURPLE" } })).toBe(false);
    expect(ok({ ...base, conditions: { paperType: "PHOTO", minPages: 10, maxPages: 10 } })).toBe(
      true,
    );
    expect(ok({ ...base, conditions: { minPages: 10, maxPages: 5 } })).toBe(false);
    expect(ok({ ...base, conditions: { minPages: 0 } })).toBe(false);
    expect(ok({ ...base, conditions: { unknown: 1 } })).toBe(false);
  });

  it("is strict about unknown keys", () => {
    expect(ok({ ...base, position: 0 })).toBe(false);
  });
});

describe("updatePrinterRuleSchema", () => {
  const ok = (v: unknown) => updatePrinterRuleSchema.safeParse(v).success;
  it("needs at least one field besides expectedVersion, and is strict", () => {
    expect(ok({})).toBe(false);
    expect(ok({ expectedVersion: 1 })).toBe(false);
    expect(ok({ enabled: false })).toBe(true);
    expect(ok({ enabled: false, expectedVersion: 2 })).toBe(true);
    expect(ok({ shopId })).toBe(false);
  });
});

describe("reorderPrinterRulesSchema", () => {
  it("takes unique rule ids", () => {
    expect(reorderPrinterRulesSchema.safeParse({ shopId, ruleIds: [p1, p2] }).success).toBe(true);
    expect(reorderPrinterRulesSchema.safeParse({ shopId, ruleIds: [p1, p1] }).success).toBe(false);
    expect(reorderPrinterRulesSchema.safeParse({ shopId, ruleIds: [] }).success).toBe(true);
  });
});
