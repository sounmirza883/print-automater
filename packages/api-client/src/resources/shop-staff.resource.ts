import type { HttpClient } from "../http-client.js";
import type { MyShopMembership } from "../types.js";

export class ShopStaffResource {
  constructor(private readonly http: HttpClient) {}

  myShops(): Promise<{ shops: MyShopMembership[] }> {
    return this.http.request<{ shops: MyShopMembership[] }>("/v1/shop/staff/me");
  }
}
