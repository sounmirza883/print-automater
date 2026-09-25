import type { HttpClient } from "../http-client.js";
import type { MyShopMembership, Page } from "../types.js";

export interface ShopStaffListItem {
  id: string;
  shopId: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  status: "ACTIVE" | "SUSPENDED" | "REMOVED";
  createdAt: string;
}

export class ShopStaffResource {
  constructor(private readonly http: HttpClient) {}

  /** 23.6: the business roster (needs MANAGE_USERS: owner and manager). */
  list(
    shopId: string,
    params: { q?: string; role?: string; status?: string; limit?: number; offset?: number } = {},
  ): Promise<Page<ShopStaffListItem>> {
    return this.http.request<Page<ShopStaffListItem>>("/v1/shop/staff", {
      query: { shopId, ...params },
    });
  }

  myShops(): Promise<{ shops: MyShopMembership[] }> {
    return this.http.request<{ shops: MyShopMembership[] }>("/v1/shop/staff/me");
  }
}
