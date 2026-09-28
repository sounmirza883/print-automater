import type { Page, PrinterCapabilities, ShopStatus } from "@print-automated/types";
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
}
