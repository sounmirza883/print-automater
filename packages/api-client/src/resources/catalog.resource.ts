import type { Page } from "@print-automated/types";
import type { HttpClient } from "../http-client.js";

type Caps = { color: boolean; duplex: boolean; a4: boolean; a3: boolean };

export interface Product {
  id: string;
  shopId: string;
  name: string;
  description: string | null;
  category: string | null;
  unit: string | null;
  taxRateBasisPoints: number | null;
  printerRequirements: Caps | null;
  paperRequirements: { paperSize?: string; paperType?: string } | null;
  available: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductInput {
  name?: string;
  description?: string;
  category?: string;
  unit?: string;
  taxRateBasisPoints?: number;
  printerRequirements?: Caps;
  paperRequirements?: { paperSize?: string; paperType?: string };
  available?: boolean;
}

export interface PricingRule {
  id: string;
  shopId: string;
  version: number;
  currency: string;
  pricePerPageMinor: number;
  colorSurchargePerPageMinor: number;
  otherCharges: Array<{ label: string; amountMinor: number }>;
  minimumChargeMinor: number;
  paperSizeSurchargePerPageMinor: Record<string, number> | null;
  paperTypeSurchargePerPageMinor: Record<string, number> | null;
  finishingChargeMinor: Record<string, number> | null;
  taxRateBasisPoints: number | null;
  createdAt: string;
}

export interface PricingRuleInput {
  currency: string;
  pricePerPageMinor: number;
  colorSurchargePerPageMinor: number;
  otherCharges?: Array<{ label: string; amountMinor: number }>;
  minimumChargeMinor: number;
  paperSizeSurchargePerPageMinor?: Record<string, number>;
  paperTypeSurchargePerPageMinor?: Record<string, number>;
  finishingChargeMinor?: Record<string, number>;
  taxRateBasisPoints?: number;
}

export interface Customer {
  id: string;
  shopId: string;
  name: string;
  phone: string | null;
  email: string | null;
  company: string | null;
  address: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerInput {
  name?: string;
  phone?: string;
  email?: string;
  company?: string;
  address?: string;
  active?: boolean;
}

/** MANAGE_PRICES. Products have no delete: `available: false` hides one. */
export class ProductsResource {
  constructor(private readonly http: HttpClient) {}

  list(
    shopId: string,
    params: {
      q?: string;
      category?: string;
      available?: boolean;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<Page<Product>> {
    return this.http.request("/v1/shop/products", {
      query: { shopId, ...params, limit: params.limit ?? 50 },
    });
  }

  create(shopId: string, input: ProductInput & { name: string }): Promise<Product> {
    return this.http.request("/v1/shop/products", { method: "POST", body: { shopId, ...input } });
  }

  update(id: string, input: ProductInput): Promise<Product> {
    return this.http.request(`/v1/shop/products/${id}`, { method: "PATCH", body: input });
  }
}

/** MANAGE_PRICES. Rules are VERSIONED: a change is a new version; there is no edit or delete. */
export class PricingRulesResource {
  constructor(private readonly http: HttpClient) {}

  list(
    shopId: string,
    params: { limit?: number; offset?: number } = {},
  ): Promise<Page<PricingRule>> {
    return this.http.request("/v1/shop/pricing-rules", {
      query: { shopId, ...params, limit: params.limit ?? 50 },
    });
  }

  create(shopId: string, input: PricingRuleInput): Promise<PricingRule> {
    return this.http.request("/v1/shop/pricing-rules", {
      method: "POST",
      body: { shopId, ...input },
    });
  }
}

/** Walk-in customer records. List needs VIEW_ORDERS, create CREATE_ORDERS, edit EDIT_ORDERS. */
export class CustomersResource {
  constructor(private readonly http: HttpClient) {}

  list(
    shopId: string,
    params: { q?: string; active?: boolean; limit?: number; offset?: number } = {},
  ): Promise<Page<Customer>> {
    return this.http.request("/v1/shop/customers", {
      query: { shopId, ...params, limit: params.limit ?? 50 },
    });
  }

  create(shopId: string, input: CustomerInput & { name: string }): Promise<Customer> {
    return this.http.request("/v1/shop/customers", { method: "POST", body: { shopId, ...input } });
  }

  update(id: string, input: CustomerInput): Promise<Customer> {
    return this.http.request(`/v1/shop/customers/${id}`, { method: "PATCH", body: input });
  }
}
