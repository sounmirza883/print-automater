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
    expect(printConfigurationSchema.safeParse({ ...VALID, paperSize: "A3" }).success).toBe(false);
    expect(printConfigurationSchema.safeParse({ ...VALID, color: "SEPIA" }).success).toBe(false);
    expect(printConfigurationSchema.safeParse({ ...VALID, sides: "TRIPLE" }).success).toBe(false);
    expect(printConfigurationSchema.safeParse({ ...VALID, orientation: "DIAGONAL" }).success).toBe(
      false,
    );
  });
});
