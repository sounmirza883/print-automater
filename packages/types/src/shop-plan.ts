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
  /** Price for 365 days in the same currency; null = no annual option. The public
   * site shows "monthly x 12" struck out next to it (calculated, never stored). */
  annualPriceMinor: number | null;
  /** "Most popular" badge and emphasised card on the pricing page. */
  highlighted: boolean;
  /** Custom pricing: the public card shows "Custom pricing" and "Contact us"
   * instead of a price (`priceMinor` is ignored for display). */
  contactOnly: boolean;
  /** Card / column order on the public page and in the admin list (low first). */
  sortOrder: number;
  /** featureId -> value for the Compare plans table: "true" tick, "false" dash,
   * anything else is the text shown. A missing feature reads as a dash. */
  values: Record<string, string>;
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

/** A row of the public Compare plans table, defined once for all plans. */
export interface PlanFeatureResponse {
  id: string;
  section: string;
  label: string;
  sortOrder: number;
  /** Also listed as a bullet on each plan's pricing card. */
  showOnCard: boolean;
  /** Card bullet template ("{value} printers"); null = the label. */
  cardText: string | null;
}

/** What the public marketing site may see of a plan (no id, archived flag,
 * subscriber count or timestamps). */
export interface PublicPlan {
  name: string;
  description: string | null;
  priceMinor: number;
  currency: string;
  billingPeriodDays: number;
  annualPriceMinor: number | null;
  highlighted: boolean;
  contactOnly: boolean;
}

/** One Compare-table row; `values` is keyed by plan NAME (unique) and a missing
 * key reads as a dash. */
export interface PublicPlanFeature {
  section: string;
  label: string;
  showOnCard: boolean;
  cardText: string | null;
  values: Record<string, string>;
}

/** `GET /v1/plans` (unauthenticated). */
export interface PublicPlansResponse {
  items: PublicPlan[];
  features: PublicPlanFeature[];
}
