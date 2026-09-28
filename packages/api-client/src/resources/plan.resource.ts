import type { ShopPlanResponse } from "@print-automated/types";
import type { HttpClient } from "../http-client.js";

/** 26 (Shop Plan / subscription system). `get()` needs no special
 * permission -- any shop staff member may see their own business's plan
 * (see PermissionsGuard's own "no @RequirePermission means nothing enforced
 * here" comment) -- and returns 403 for a business the caller isn't active
 * staff at. `adminGet()`/`adminActivate()` need the ADMIN role. */
export class PlanResource {
  constructor(private readonly http: HttpClient) {}

  get(shopId: string): Promise<ShopPlanResponse> {
    return this.http.request<ShopPlanResponse>("/v1/shop/plan", { query: { shopId } });
  }

  adminGet(shopId: string): Promise<ShopPlanResponse> {
    return this.http.request<ShopPlanResponse>(`/v1/admin/businesses/${shopId}/plan`);
  }

  adminActivate(shopId: string, days: number): Promise<ShopPlanResponse> {
    return this.http.request<ShopPlanResponse>(`/v1/admin/businesses/${shopId}/plan/activate`, {
      method: "POST",
      body: { days },
    });
  }
}
