import type {
  AdminDashboardResponse,
  OperatorDashboardResponse,
  OwnerDashboardResponse,
  PrinterDashboardResponse,
} from "@print-automated/types";
import type { HttpClient } from "../http-client.js";

/** 23.2 (PRD 39-42). Each call needs the matching permission at the shop (see
 * `Permission.VIEW_DASHBOARD` / `VIEW_OPERATOR_DASHBOARD` / `VIEW_PRINTER_DASHBOARD`);
 * `admin()` needs the ADMIN role. */
export class DashboardResource {
  constructor(private readonly http: HttpClient) {}

  owner(
    shopId: string,
    range: { from?: string; to?: string } = {},
  ): Promise<OwnerDashboardResponse> {
    return this.http.request<OwnerDashboardResponse>("/v1/shop/dashboard/owner", {
      query: { shopId, from: range.from, to: range.to },
    });
  }

  operator(shopId: string, limit?: number): Promise<OperatorDashboardResponse> {
    return this.http.request<OperatorDashboardResponse>("/v1/shop/dashboard/operator", {
      query: { shopId, limit },
    });
  }

  printers(shopId: string): Promise<PrinterDashboardResponse> {
    return this.http.request<PrinterDashboardResponse>("/v1/shop/dashboard/printers", {
      query: { shopId },
    });
  }

  admin(): Promise<AdminDashboardResponse> {
    return this.http.request<AdminDashboardResponse>("/v1/admin/dashboard");
  }
}
