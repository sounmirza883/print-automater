import { listShopsQuerySchema } from "./list-shops-query.schema.js";

describe("listShopsQuerySchema", () => {
  it("accepts an entirely empty query -- every dimension is optional", () => {
    const result = listShopsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ paper: undefined, color: undefined, duplex: undefined });
    }
  });

  it("accepts a fully specified query and coerces the string booleans", () => {
    const result = listShopsQuerySchema.safeParse({ paper: "A4", color: "true", duplex: "false" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ paper: "A4", color: true, duplex: false });
    }
  });

  it("rejects a paper size outside the known enum", () => {
    // 15.1 expanded PaperSize to include A3 -- use a value that's
    // still outside the enum after that expansion.
    const result = listShopsQuerySchema.safeParse({ paper: "TABLOID" });
    expect(result.success).toBe(false);
  });

  it("rejects a boolean value that isn't literally 'true' or 'false'", () => {
    // The well-known z.coerce.boolean() footgun this schema avoids: any
    // non-empty string (including "0" or "no") must NOT silently coerce
    // to true.
    const result = listShopsQuerySchema.safeParse({ color: "0" });
    expect(result.success).toBe(false);
  });
});
