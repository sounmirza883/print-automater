import type { HttpClient } from "../http-client.js";
import type { MyShopsResponse, Page } from "../types.js";

export interface ShopStaffListItem {
  id: string;
  shopId: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  status: "ACTIVE" | "SUSPENDED" | "REMOVED";
  createdAt: string;
  /** What this person may do now: their role's defaults plus their own overrides. */
  permissions: string[];
  /** What their role alone would give them (the table lives on the server only). */
  defaultPermissions: string[];
  /** True when their access differs from their role's defaults. */
  customised: boolean;
}

export interface ShopStaffMember {
  id: string;
  shopId: string;
  userId: string;
  role: string;
  status: "ACTIVE" | "SUSPENDED" | "REMOVED";
}

/** 23.15: one row of the minimal staff directory. */
export interface StaffDirectoryItem {
  userId: string;
  name: string;
}

export interface StaffInvite {
  id: string;
  email: string;
  role: string;
  invitedBy: string | null;
  createdAt: string;
  expiresAt: string;
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

  /** 23.15/23.18 (MANAGE_USERS): invite by email. Always a pending invitation with an emailed
   * code -- nobody is added until they accept -- and always the same `{result:"PROCESSED"}`
   * (HTTP 202), whether or not the address has an account. */
  addByEmail(shopId: string, email: string, role: string): Promise<{ result: "PROCESSED" }> {
    return this.http.request("/v1/shop/staff", { method: "POST", body: { shopId, email, role } });
  }

  /** 23.15: id + display name of active members (any staff role), e.g. for the operator filter. */
  directory(
    shopId: string,
    params: { q?: string; role?: string; limit?: number; offset?: number } = {},
  ): Promise<Page<StaffDirectoryItem>> {
    return this.http.request<Page<StaffDirectoryItem>>("/v1/shop/staff/directory", {
      query: { shopId, ...params },
    });
  }

  /** 23.15 (MANAGE_USERS): pending invitations. */
  listInvites(
    shopId: string,
    params: { limit?: number; offset?: number } = {},
  ): Promise<Page<StaffInvite>> {
    return this.http.request<Page<StaffInvite>>("/v1/shop/staff/invites", {
      query: { shopId, ...params },
    });
  }

  revokeInvite(inviteId: string): Promise<void> {
    return this.http.request<void>(`/v1/shop/staff/invites/${inviteId}`, { method: "DELETE" });
  }

  /** 23.15: the signed-in person redeems the emailed code (their account email must match).
   * Every failure is the same 404, whatever the reason. */
  acceptInvite(token: string): Promise<{ shopId: string; role: string }> {
    return this.http.request("/v1/shop/staff-invites/accept", { method: "POST", body: { token } });
  }

  changeRole(membershipId: string, role: string): Promise<ShopStaffMember> {
    return this.http.request(`/v1/shop/staff/${membershipId}/role`, {
      method: "PATCH",
      body: { role },
    });
  }

  /** MANAGE_USERS: the FULL list of permissions the member should hold. The API stores the
   * difference from their role's defaults and answers with what they can now do. */
  updateAccess(
    membershipId: string,
    permissions: string[],
  ): Promise<ShopStaffMember & { permissions: string[] }> {
    return this.http.request(`/v1/shop/staff/${membershipId}`, {
      method: "PATCH",
      body: { permissions },
    });
  }

  remove(membershipId: string): Promise<void> {
    return this.http.request(`/v1/shop/staff/${membershipId}`, { method: "DELETE" });
  }

  myShops(): Promise<MyShopsResponse> {
    return this.http.request<MyShopsResponse>("/v1/shop/staff/me");
  }
}
