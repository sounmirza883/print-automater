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

export interface ShopStaffMember {
  id: string;
  shopId: string;
  userId: string;
  role: string;
  status: "ACTIVE" | "SUSPENDED" | "REMOVED";
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

  /** MANAGE_USERS. Adds an existing user by id (or re-activates / re-roles a member). */
  add(shopId: string, userId: string, role: string): Promise<ShopStaffMember> {
    return this.http.request("/v1/shop/staff", { method: "POST", body: { shopId, userId, role } });
  }

  changeRole(membershipId: string, role: string): Promise<ShopStaffMember> {
    return this.http.request(`/v1/shop/staff/${membershipId}/role`, {
      method: "PATCH",
      body: { role },
    });
  }

  remove(membershipId: string): Promise<void> {
    return this.http.request(`/v1/shop/staff/${membershipId}`, { method: "DELETE" });
  }

  myShops(): Promise<{ shops: MyShopMembership[] }> {
    return this.http.request<{ shops: MyShopMembership[] }>("/v1/shop/staff/me");
  }
}
