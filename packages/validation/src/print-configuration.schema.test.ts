import { printConfigurationSchema } from "./print-configuration.schema.js";

const VALID = {
  pages: { mode: "all" },
  copies: 2,
  paperSize: "A4",
  color: "BW",
  sides: "SINGLE",
  orientation: "PORTRAIT",
};

describe("printConfigurationSchema", () => {
  it("accepts a valid 'all pages' configuration", () => {
    expect(printConfigurationSchema.safeParse(VALID).success).toBe(true);
  });

  it("accepts a valid page range", () => {
    const result = printConfigurationSchema.safeParse({
      ...VALID,
      pages: { mode: "range", from: 3, to: 7 },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a page range with a non-positive bound", () => {
    const result = printConfigurationSchema.safeParse({
      ...VALID,
      pages: { mode: "range", from: 0, to: 7 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects zero or negative copies", () => {
    expect(printConfigurationSchema.safeParse({ ...VALID, copies: 0 }).success).toBe(false);
    expect(printConfigurationSchema.safeParse({ ...VALID, copies: -1 }).success).toBe(false);
  });

  it("rejects copies over the sanity bound", () => {
    expect(printConfigurationSchema.safeParse({ ...VALID, copies: 501 }).success).toBe(false);
    expect(printConfigurationSchema.safeParse({ ...VALID, copies: 500 }).success).toBe(true);
  });

  it("rejects a paper size, color mode, sides, or orientation outside the known enums", () => {
    expect(printConfigurationSchema.safeParse({ ...VALID, paperSize: "TABLOID" }).success).toBe(
      false,
    );
    expect(printConfigurationSchema.safeParse({ ...VALID, color: "SEPIA" }).success).toBe(false);
    expect(printConfigurationSchema.safeParse({ ...VALID, sides: "TRIPLE" }).success).toBe(false);
    expect(printConfigurationSchema.safeParse({ ...VALID, orientation: "DIAGONAL" }).success).toBe(
      false,
    );
  });

  // 15.1/§64: PaperSize's expansion and the new optional paperType/
  // finishing fields.
  it("accepts every expanded PaperSize value (A5/A3/LETTER/LEGAL/CUSTOM)", () => {
    for (const paperSize of ["A4", "A5", "A3", "LETTER", "LEGAL", "CUSTOM"]) {
      expect(printConfigurationSchema.safeParse({ ...VALID, paperSize }).success).toBe(true);
    }
  });

  it("round-trips a config with no paperType/finishing -- both are absent, not null or defaulted", () => {
    const result = printConfigurationSchema.safeParse(VALID);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("paperType");
      expect(result.data).not.toHaveProperty("finishing");
      // Byte-identical round-trip: parsing doesn't inject any new keys.
      expect(Object.keys(result.data).sort()).toEqual(Object.keys(VALID).sort());
    }
  });

  it("accepts a config with paperType and a finishing array", () => {
    const result = printConfigurationSchema.safeParse({
      ...VALID,
      paperType: "PREMIUM",
      finishing: ["STAPLING", "LAMINATION"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown paperType or finishing value", () => {
    expect(printConfigurationSchema.safeParse({ ...VALID, paperType: "VELLUM" }).success).toBe(
      false,
    );
    expect(printConfigurationSchema.safeParse({ ...VALID, finishing: ["EMBOSSING"] }).success).toBe(
      false,
    );
  });
});
