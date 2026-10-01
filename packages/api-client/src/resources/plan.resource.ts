import type { PlanDefinitionResponse, ShopPlanResponse } from "@print-automated/types";
import type { HttpClient } from "../http-client.js";

/** Create/update inputs for a plan definition (platform-wide, not per-business) --
 * mirrors `CreatePlanDefinitionInput`/`UpdatePlanDefinitionInput` from
 * `@print-automated/validation`, kept as plain structural types here the same way
 * every other api-client resource shapes its own request bodies, rather than
 * importing a server-side Zod package into every consumer of this client. */
export interface CreatePlanDefinitionBody {
  name: string;
  priceMinor: number;
  currency: string;
  billingPeriodDays: number;
  description?: string;
}

/** `description?: string` on create (omit it, it's unset); on update, `null`
 * clears a previously-set description, `undefined`/omitted leaves it unchanged
 * -- distinct from create's shape, so this isn't just `Partial<...>`. */
export type UpdatePlanDefinitionBody = Omit<Partial<CreatePlanDefinitionBody>, "description"> & {
  description?: string | null;
  archived?: boolean;
};

export interface PlanDefinitionListResult {
  items: PlanDefinitionResponse[];
}

/** 26 (Shop Plan / subscription system). `get()` needs no special
 * permission -- any shop staff member may see their own business's plan
 * (see PermissionsGuard's own "no @RequirePermission means nothing enforced
 * here" comment) -- and returns 403 for a business the caller isn't active
 * staff at. Every other method needs the ADMIN role. */
export class PlanResource {
  constructor(private readonly http: HttpClient) {}

  get(shopId: string): Promise<ShopPlanResponse> {
    return this.http.request<ShopPlanResponse>("/v1/shop/plan", { query: { shopId } });
  }

  adminGet(shopId: string): Promise<ShopPlanResponse> {
    return this.http.request<ShopPlanResponse>(`/v1/admin/businesses/${shopId}/plan`);
  }

  /** Assigns (or re-assigns, to renew) a named plan to a business -- the renewal
   * length comes from that plan's own `billingPeriodDays`. Pick the business's
   * current plan again to renew it; pick a different one to change plans. */
  adminActivate(shopId: string, planDefinitionId: string): Promise<ShopPlanResponse> {
    return this.http.request<ShopPlanResponse>(`/v1/admin/businesses/${shopId}/plan/activate`, {
      method: "POST",
      body: { planDefinitionId },
    });
  }

  /** Clears a business's plan assignment immediately (expires it now) -- the
   * "remove/cancel this business's plan" action from the business's own detail
   * page. Does not delete the business or its history, only its current plan. */
  adminCancel(shopId: string): Promise<ShopPlanResponse> {
    return this.http.request<ShopPlanResponse>(`/v1/admin/businesses/${shopId}/plan/cancel`, {
      method: "POST",
    });
  }

  /** Every plan definition on the platform, each with how many businesses are
   * currently assigned to it. */
  listDefinitions(): Promise<PlanDefinitionListResult> {
    return this.http.request<PlanDefinitionListResult>("/v1/admin/plans");
  }

  getDefinition(id: string): Promise<PlanDefinitionResponse> {
    return this.http.request<PlanDefinitionResponse>(`/v1/admin/plans/${id}`);
  }

  createDefinition(input: CreatePlanDefinitionBody): Promise<PlanDefinitionResponse> {
    return this.http.request<PlanDefinitionResponse>("/v1/admin/plans", {
      method: "POST",
      body: input,
    });
  }

  updateDefinition(id: string, input: UpdatePlanDefinitionBody): Promise<PlanDefinitionResponse> {
    return this.http.request<PlanDefinitionResponse>(`/v1/admin/plans/${id}`, {
      method: "PATCH",
      body: input,
    });
  }

  /** Refused with 409 if any business is currently assigned to this plan --
   * archive it instead (`updateDefinition(id, { archived: true })`) to retire it
   * without breaking existing subscribers. */
  deleteDefinition(id: string): Promise<{ result: "DELETED" }> {
    return this.http.request<{ result: "DELETED" }>(`/v1/admin/plans/${id}`, {
      method: "DELETE",
    });
  }
}
