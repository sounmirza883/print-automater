import { searchShopOrdersQuerySchema } from "./search-shop-orders-query.schema.js";

const shopId = "11111111-1111-4111-8111-111111111111";

describe("searchShopOrdersQuerySchema", () => {
  it("defaults to limit 50 / offset 0 and coerces query strings", () => {
    const parsed = searchShopOrdersQuerySchema.parse({ shopId, q: " abc ", priority: "3" });
    expect(parsed).toMatchObject({ q: "abc", priority: 3, limit: 50, offset: 0 });
  });

  it("rejects an out-of-range page, an empty q, a bad status and an inverted date range", () => {
    for (const bad of [
      { shopId, limit: "101" },
      { shopId, offset: "-1" },
      { shopId, q: "   " },
      { shopId, status: "NOPE" },
      { shopId, from: "2022-01-01", to: "2021-01-01" },
      { limit: "5" },
    ]) {
      expect(searchShopOrdersQuerySchema.safeParse(bad).success).toBe(false);
    }
  });
});
