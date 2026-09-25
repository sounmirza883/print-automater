import {
  LEGACY_LIST_CAP,
  MAX_PAGE_LIMIT,
  optionalPaginationQuerySchema,
  paginationQuerySchema,
} from "./pagination.schema.js";

describe("pagination schemas (23.6)", () => {
  it("optional: no params parse to no limit and no offset (a legacy call)", () => {
    expect(optionalPaginationQuerySchema.parse({})).toEqual({});
  });

  it("optional: coerces query strings and enforces 1..100 / >= 0", () => {
    expect(optionalPaginationQuerySchema.parse({ limit: "25", offset: "5" })).toEqual({
      limit: 25,
      offset: 5,
    });
    for (const bad of [{ limit: "0" }, { limit: "101" }, { offset: "-1" }, { limit: "x" }]) {
      expect(optionalPaginationQuerySchema.safeParse(bad).success).toBe(false);
    }
    expect(MAX_PAGE_LIMIT).toBe(100);
  });

  it("required form defaults to limit 50, offset 0", () => {
    expect(paginationQuerySchema.parse({})).toEqual({ limit: 50, offset: 0 });
  });

  it("the legacy cap bounds unpaged lists at a fixed size", () => {
    expect(LEGACY_LIST_CAP).toBe(500);
  });
});
