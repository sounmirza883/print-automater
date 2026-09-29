import { createPublicOrderSchema } from "./create-public-order.schema.js";

const VALID = {
  name: "Zainab Khan",
  phone: "+92 300 555-1234",
  documentId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  printConfiguration: {
    pages: { mode: "all" },
    copies: 1,
    paperSize: "A4",
    color: "BW",
    sides: "SINGLE",
    orientation: "PORTRAIT",
  },
};

describe("createPublicOrderSchema (24.1, POST /public/shops/:shopId/orders)", () => {
  it("accepts a guest's name, phone, document and print configuration", () => {
    expect(createPublicOrderSchema.safeParse(VALID).success).toBe(true);
  });

  it("trims the name and phone", () => {
    const parsed = createPublicOrderSchema.parse({
      ...VALID,
      name: "  Zainab  ",
      phone: " 03005551234 ",
    });
    expect(parsed.name).toBe("Zainab");
    expect(parsed.phone).toBe("03005551234");
  });

  it.each([
    ["an empty name", { name: "   " }],
    ["a name over 200 characters", { name: "x".repeat(201) }],
    ["a missing phone", { phone: undefined }],
    ["a phone with letters", { phone: "call me maybe" }],
    ["a phone with too few digits", { phone: "12345" }],
    ["a phone with more than 15 digits", { phone: "1234567890123456" }],
    ["a non-uuid documentId", { documentId: "not-a-uuid" }],
    ["a missing printConfiguration", { printConfiguration: undefined }],
  ])("rejects %s", (_label, override) => {
    expect(createPublicOrderSchema.safeParse({ ...VALID, ...override }).success).toBe(false);
  });

  it("has no shopId, price or customer field a caller could smuggle in -- the route decides the shop", () => {
    const parsed = createPublicOrderSchema.parse({
      ...VALID,
      shopId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      total: 1,
      customerRecordId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      creationSource: "COUNTER",
    });
    expect(Object.keys(parsed).sort()).toEqual(
      ["documentId", "name", "phone", "printConfiguration"].sort(),
    );
  });
});
