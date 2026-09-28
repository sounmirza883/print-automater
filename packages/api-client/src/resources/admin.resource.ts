import type {
  Page,
  PrinterCapabilities,
  ShopStatus,
  UserRole,
  UserStatus,
} from "@print-automated/types";
import type { HttpClient } from "../http-client.js";

/** 23.7/Workstream A: one row of the platform's business list. */
export interface AdminBusiness {
  id: string;
  name: string;
  address: string;
  status: ShopStatus;
  createdAt: string;
}

/** 23.7/Workstream A: one business's detail -- the row plus how much is
 * actually happening there, so an admin can tell a real, working
 * business from an empty shell. */
export interface AdminBusinessDetail extends AdminBusiness {
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  capabilities: PrinterCapabilities | null;
  counts: {
    staff: number;
    orders: number;
    printers: number;
  };
}

export interface CreateBusinessInput {
  name: string;
  address: string;
  latitude?: number;
  longitude?: number;
  phone?: string;
  capabilities?: PrinterCapabilities;
}

/** Workstream B: one row of the platform's user list, or one user's
 * detail (same shape -- there's nothing extra to show per-user here,
 * unlike a business's staff/order/printer counts). */
export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
}

/** 23.7/Workstream A: the platform-wide admin surface (ADMIN role only,
 * enforced server-side). This file grows with each admin-panel
 * workstream -- Task 2 (Workstream B) adds the user-management methods
 * alongside these. */
export class AdminResource {
  constructor(private readonly http: HttpClient) {}

  listBusinesses(params: { limit?: number; offset?: number } = {}): Promise<Page<AdminBusiness>> {
    return this.http.request<Page<AdminBusiness>>("/v1/admin/businesses", { query: params });
  }

  getBusiness(id: string): Promise<AdminBusinessDetail> {
    return this.http.request<AdminBusinessDetail>(`/v1/admin/businesses/${id}`);
  }

  createBusiness(input: CreateBusinessInput): Promise<AdminBusiness> {
    return this.http.request<AdminBusiness>("/v1/admin/businesses", {
      method: "POST",
      body: input,
    });
  }

  updateBusinessStatus(id: string, status: ShopStatus): Promise<AdminBusiness> {
    return this.http.request<AdminBusiness>(`/v1/admin/businesses/${id}/status`, {
      method: "PATCH",
      body: { status },
    });
  }

  /** Workstream B: every user on the platform. Mirrors `listBusinesses`'
   * shape -- the backend route (`GET /admin/users`) predates this whole
   * admin-panel expansion; this is just its first api-client wrapper. */
  listUsers(params: { limit?: number; offset?: number } = {}): Promise<Page<AdminUser>> {
    return this.http.request<Page<AdminUser>>("/v1/admin/users", { query: params });
  }

  getUser(id: string): Promise<AdminUser> {
    return this.http.request<AdminUser>(`/v1/admin/users/${id}`);
  }

  updateUserRole(id: string, role: UserRole): Promise<AdminUser> {
    return this.http.request<AdminUser>(`/v1/admin/users/${id}/role`, {
      method: "PATCH",
      body: { role },
    });
  }

  updateUserStatus(id: string, status: UserStatus): Promise<AdminUser> {
    return this.http.request<AdminUser>(`/v1/admin/users/${id}/status`, {
      method: "PATCH",
      body: { status },
    });
  }
}
