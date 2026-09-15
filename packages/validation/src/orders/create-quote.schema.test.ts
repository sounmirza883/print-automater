import { randomUUID } from "node:crypto";
import { createQuoteSchema } from "./create-quote.schema.js";

const VALID = {
  documentId: randomUUID(),
  shopId: randomUUID(),
  printConfiguration: {
    pages: { mode: "all" },
    copies: 1,
    paperSize: "A4",
    color: "BW",
    sides: "SINGLE",
    orientation: "PORTRAIT",
  },
};

describe("createQuoteSchema", () => {
  it("accepts a valid request", () => {
    expect(createQuoteSchema.safeParse(VALID).success).toBe(true);
  });

  it("rejects a non-UUID documentId or shopId", () => {
    expect(createQuoteSchema.safeParse({ ...VALID, documentId: "not-a-uuid" }).success).toBe(false);
    expect(createQuoteSchema.safeParse({ ...VALID, shopId: "not-a-uuid" }).success).toBe(false);
  });

  it("S19: strips a client-supplied total rather than accepting it -- there is no total field in the parsed output", () => {
    const result = createQuoteSchema.safeParse({ ...VALID, total: 1 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data)).not.toContain("total");
      expect(Object.keys(result.data).sort()).toEqual(
        ["documentId", "printConfiguration", "shopId"].sort(),
      );
    }
  });
});
