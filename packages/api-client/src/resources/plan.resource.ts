import type {
  PlanDefinitionResponse,
  PlanFeatureResponse,
  ShopPlanResponse,
} from "@print-automated/types";
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
  /** Price for 365 days; omit for no annual option. */
  annualPriceMinor?: number;
  highlighted?: boolean;
  /** Custom pricing: the public card shows "Custom pricing" and "Contact us". */
  contactOnly?: boolean;
  sortOrder?: number;
  /** featureId -> "true" | "false" | text; replaces the plan's whole set of values. */
  values?: Record<string, string>;
}

/** `description?: string` on create (omit it, it's unset); on update, `null`
 * clears a previously-set description, `undefined`/omitted leaves it unchanged
 * -- distinct from create's shape, so this isn't just `Partial<...>`. */
export type UpdatePlanDefinitionBody = Omit<
  Partial<CreatePlanDefinitionBody>,
  "description" | "annualPriceMinor"
> & {
  description?: string | null;
  /** `null` removes the annual option. */
  annualPriceMinor?: number | null;
  archived?: boolean;
};

/** A row of the public Compare plans table. */
export interface CreatePlanFeatureBody {
  section: string;
  label: string;
  sortOrder?: number;
  showOnCard?: boolean;
  /** Card bullet template, e.g. "{value} printers". */
  cardText?: string;
}

export type UpdatePlanFeatureBody = Omit<Partial<CreatePlanFeatureBody>, "cardText"> & {
  /** `null` clears the template (the card then shows the label). */
  cardText?: string | null;
};

export interface PlanFeatureListResult {
  items: PlanFeatureResponse[];
}

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

  /** The rows of the public Compare plans table, in display order. */
  listFeatures(): Promise<PlanFeatureListResult> {
    return this.http.request<PlanFeatureListResult>("/v1/admin/plan-features");
  }

  createFeature(input: CreatePlanFeatureBody): Promise<PlanFeatureResponse> {
    return this.http.request<PlanFeatureResponse>("/v1/admin/plan-features", {
      method: "POST",
      body: input,
    });
  }

  updateFeature(id: string, input: UpdatePlanFeatureBody): Promise<PlanFeatureResponse> {
    return this.http.request<PlanFeatureResponse>(`/v1/admin/plan-features/${id}`, {
      method: "PATCH",
      body: input,
    });
  }

  /** Also deletes every plan's value for this row. */
  deleteFeature(id: string): Promise<{ result: "DELETED" }> {
    return this.http.request<{ result: "DELETED" }>(`/v1/admin/plan-features/${id}`, {
      method: "DELETE",
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
