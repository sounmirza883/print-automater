import type { ApiClient, ShopOrderResponse } from "@print-automated/api-client";

/** The guest QR on customer-web encodes the order's `publicOrderNumber`
 * (24.x). A scan resolves to an order by exact (case-insensitive) match on
 * it, via the existing staff-scoped search endpoint -- never by "closest
 * hit", so a mangled or foreign code can't open the wrong order. */
export async function findOrderByScan(
  apiClient: Pick<ApiClient, "shopOrders">,
  shopId: string,
  scanned: string,
): Promise<ShopOrderResponse | null> {
  const code = scanned.trim();
  if (code === "") {
    return null;
  }
  const page = await apiClient.shopOrders.search(shopId, { q: code, limit: 5 });
  const wanted = code.toLowerCase();
  return page.items.find((order) => order.publicOrderNumber.toLowerCase() === wanted) ?? null;
}
