import { createPlanFeatureSchema, updatePlanFeatureSchema } from "./plan-feature.schema.js";

describe("plan feature schemas", () => {
  const valid = {
    section: "Capacity",
    label: "Printers",
    sortOrder: 10,
    showOnCard: true,
    cardText: "{value} printers",
  };

  it("accepts a full row and trims text", () => {
    const r = createPlanFeatureSchema.safeParse({
      ...valid,
      section: "  Capacity ",
      label: " Printers ",
    });
    expect(r.success && r.data.section).toBe("Capacity");
    expect(r.success && r.data.label).toBe("Printers");
  });

  it("requires section and label; the rest is optional", () => {
    expect(createPlanFeatureSchema.safeParse({ section: "A", label: "B" }).success).toBe(true);
    expect(createPlanFeatureSchema.safeParse({ section: "", label: "B" }).success).toBe(false);
    expect(createPlanFeatureSchema.safeParse({ section: "A", label: "" }).success).toBe(false);
  });

  it("update is partial and lets cardText be cleared with null", () => {
    expect(updatePlanFeatureSchema.safeParse({}).success).toBe(true);
    const r = updatePlanFeatureSchema.safeParse({ cardText: null });
    expect(r.success && r.data.cardText).toBeNull();
  });

  it("does not let a client smuggle in an id", () => {
    const r = createPlanFeatureSchema.safeParse({ ...valid, id: "x" });
    expect(r.success && "id" in r.data).toBe(false);
  });
});
