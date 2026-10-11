import type { ShopOrderResponse } from "@print-automated/api-client";
import { findOrderByScan } from "./scan-order";

function client(items: Array<Pick<ShopOrderResponse, "id" | "publicOrderNumber">>) {
  const search = jest.fn().mockResolvedValue({ items, total: items.length, limit: 5, offset: 0 });
  return { api: { shopOrders: { search } } as never, search };
}

describe("findOrderByScan", () => {
  it("returns the exact publicOrderNumber match, case-insensitively", async () => {
    const { api, search } = client([
      { id: "a", publicOrderNumber: "PA-10001" },
      { id: "b", publicOrderNumber: "PA-1000" },
    ]);
    const order = await findOrderByScan(api, "shop1", " pa-1000\n");
    expect(order?.id).toBe("b");
    expect(search).toHaveBeenCalledWith("shop1", { q: "pa-1000", limit: 5 });
  });

  it("returns null when only a partial match comes back", async () => {
    const { api } = client([{ id: "a", publicOrderNumber: "PA-10001" }]);
    expect(await findOrderByScan(api, "shop1", "PA-1000")).toBeNull();
  });

  it("does not call the API for an empty scan", async () => {
    const { api, search } = client([]);
    expect(await findOrderByScan(api, "shop1", "  ")).toBeNull();
    expect(search).not.toHaveBeenCalled();
  });
});
