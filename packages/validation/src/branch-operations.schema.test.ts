import {
  createCounterOrderSchema,
  createOrderSchema,
  createPublicOrderSchema,
  issuePairingCodeSchema,
  listPrintersQuerySchema,
  listShopOrdersQuerySchema,
  movePrinterBranchSchema,
  registerPrinterSchema,
  searchShopOrdersQuerySchema,
} from "./index.js";

const shopId = "0b0cf1a4-6f44-4d4e-8f0a-3f2f2c1d9a11";
const branchId = "5d2f0f4e-8f43-4c1a-9a55-3b6a2f0c9e22";
const documentId = "9a1c2b3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";
const printConfiguration = {
  pages: { mode: "all" },
  copies: 1,
  paperSize: "A4",
  color: "BW",
  sides: "SINGLE",
  orientation: "PORTRAIT",
};

/** Step 3 (branch-scoped operations): the places a request can name a branch. It is always
 * optional (omitting it means "my own branch", "the only branch" or "the oldest branch" depending
 * on who asks), and always a uuid, so a typo is a clean 400 rather than a lookup that finds nothing. */
describe("branch-aware request schemas", () => {
  const cases: Array<[string, { parse: (input: unknown) => unknown }, Record<string, unknown>]> = [
    ["orders list", listShopOrdersQuerySchema, { shopId }],
    ["orders search", searchShopOrdersQuerySchema, { shopId }],
    ["printers list", listPrintersQuerySchema, { shopId }],
    ["register printer", registerPrinterSchema, { shopId, name: "HP" }],
    ["pairing code", issuePairingCodeSchema, { shopId }],
    [
      "counter order",
      createCounterOrderSchema,
      { shopId, documentId, customerRecordId: documentId, printConfiguration },
    ],
    ["customer order", createOrderSchema, { shopId, documentId, printConfiguration }],
    [
      "QR order",
      createPublicOrderSchema,
      { name: "Guest", phone: "03001234567", documentId, printConfiguration },
    ],
  ];

  it.each(cases)("%s keeps a named branch", (_name, schema, base) => {
    expect(schema.parse({ ...base, branchId })).toMatchObject({ branchId });
  });

  it.each(cases)("%s does not need a branch", (_name, schema, base) => {
    expect(schema.parse(base)).not.toHaveProperty("branchId");
  });

  it.each(cases)("%s refuses a branch that is not a uuid", (_name, schema, base) => {
    expect(() => schema.parse({ ...base, branchId: "not-a-uuid" })).toThrow();
  });

  it("moving a PC needs a branch", () => {
    expect(movePrinterBranchSchema.parse({ branchId })).toEqual({ branchId });
    expect(() => movePrinterBranchSchema.parse({})).toThrow();
    expect(() => movePrinterBranchSchema.parse({ branchId: null })).toThrow();
  });
});
