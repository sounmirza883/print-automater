/** 26 (Shop Plan / subscription system). `GET /v1/shop/plan` (any shop
 * staff, their own business) and `GET /v1/admin/businesses/:shopId/plan` /
 * `POST .../activate` (ADMIN only) all return this same shape. */
export interface ShopPlanResponse {
  shopId: string;
  active: boolean;
  /** ISO-8601; null means never activated, which reads identically to expired. */
  expiresAt: string | null;
  activatedAt: string | null;
}
