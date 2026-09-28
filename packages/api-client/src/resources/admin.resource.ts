import type { AdminBusinessResponse, AdminListResult } from "@print-automated/types";
import type { HttpClient } from "../http-client.js";

/** §4.7/§42/16.5: platform-admin list routes. ADMIN role only. */
export class AdminResource {
  constructor(private readonly http: HttpClient) {}

  listBusinesses(
    params: { limit?: number; offset?: number } = {},
  ): Promise<AdminListResult<AdminBusinessResponse>> {
    return this.http.request<AdminListResult<AdminBusinessResponse>>("/v1/admin/businesses", {
      query: params,
    });
  }
}
