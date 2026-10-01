/** 26 (Shop Plan / subscription system). `GET /v1/shop/plan` (any shop
 * staff, their own business) and `GET /v1/admin/businesses/:shopId/plan` /
 * `POST .../activate` (ADMIN only) all return this same shape. */
export interface ShopPlanResponse {
  shopId: string;
  active: boolean;
  /** ISO-8601; null means never activated, which reads identically to expired. */
  expiresAt: string | null;
  activatedAt: string | null;
  /** The plan definition this business is (or was last) assigned to -- null for a
   * business that has never been assigned a named plan (including one only ever
   * activated the old way, by a raw day count, before plan definitions existed). */
  plan: PlanDefinitionResponse | null;
}

/** A platform-wide, nameable plan tier an admin defines once and assigns to any
 * number of businesses -- the thing `ShopPlan.planDefinitionId` points at.
 * `priceMinor` follows this codebase's existing money convention (integer minor
 * units, e.g. paisa/cents; see PricingRule's own `pricePerPageMinor`). */
export interface PlanDefinitionResponse {
  id: string;
  name: string;
  priceMinor: number;
  /** ISO 4217, upper-case, 3 letters (matches ShopSettings.currency's own rule). */
  currency: string;
  /** How many days one activation/renewal covers. */
  billingPeriodDays: number;
  description: string | null;
  /** Archived plans can no longer be newly assigned, but a business already on
   * one keeps working until an admin moves or cancels it -- the same "retire
   * without breaking existing users" shape as ShopStatus.SUSPENDED for a
   * business itself, not a hard delete. */
  archived: boolean;
  /** How many businesses are CURRENTLY assigned to this plan (active or not) --
   * what a DELETE attempt is refused against; shown so an admin knows before
   * trying. */
  subscriberCount: number;
  createdAt: string;
  updatedAt: string;
}
