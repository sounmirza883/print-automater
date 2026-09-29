import type {
  AdminBusinessResponse,
  AdminListResult,
  Page,
  PrinterCapabilities,
  ShopStatus,
  UserRole,
  UserStatus,
} from "@print-automated/types";
import type { HttpClient } from "../http-client.js";

/** 23.7/Workstream A: one row of the platform's business list. The shared
 * `AdminBusinessResponse` wire shape (§4.7/§42/16.5, @print-automated/types)
 * with `status` narrowed to the real `ShopStatus` union, so callers typed
 * against either name (the 26.6 plan panel uses `AdminBusinessResponse`, the
 * 23.7 businesses screen uses `AdminBusiness`) read the same rows. */
export interface AdminBusiness extends AdminBusinessResponse {
  status: ShopStatus;
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

/** §4.7/§42/16.5 + 23.7: the platform-wide admin surface (ADMIN role only,
 * enforced server-side). Business management (Workstream A), user
 * management (Workstream B), and the list route the 26.6 plan panel reads.
 * A business's plan itself lives on `PlanResource` (`adminGet`/`adminActivate`). */
export class AdminResource {
  constructor(private readonly http: HttpClient) {}

  listBusinesses(
    params: { limit?: number; offset?: number } = {},
  ): Promise<AdminListResult<AdminBusiness>> {
    return this.http.request<AdminListResult<AdminBusiness>>("/v1/admin/businesses", {
      query: params,
    });
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
