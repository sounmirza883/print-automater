import type { Page } from "@print-automated/types";
import type { HttpClient } from "../http-client.js";

type Query = Record<string, string | number | boolean | undefined>;

export interface InventoryItem {
  id: string;
  shopId: string;
  name: string;
  sku: string | null;
  paperSize: string | null;
  paperType: string | null;
  weightGsm: number | null;
  quantity: number;
  minQuantity: number;
  maxQuantity: number | null;
  location: string | null;
  unitCostMinor: number | null;
  active: boolean;
  lowStock: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryItemInput {
  name?: string;
  sku?: string | null;
  paperSize?: string | null;
  paperType?: string | null;
  weightGsm?: number | null;
  minQuantity?: number;
  maxQuantity?: number | null;
  location?: string | null;
  unitCostMinor?: number | null;
  active?: boolean;
  /** Create only. */
  initialQuantity?: number;
}

export interface InventoryAlert {
  id: string;
  shopId: string;
  inventoryItemId: string;
  itemName: string;
  status: "OPEN" | "RESOLVED";
  quantityAtAlert: number;
  minQuantity: number;
  currentQuantity: number;
  createdAt: string;
  resolvedAt: string | null;
}

export interface InventorySummary {
  shopId: string;
  trackingEnabled: boolean;
  activeItems: number;
  lowStockCount: number;
  outOfStockCount: number;
  openAlertCount: number;
  lowStockItems: InventoryItem[];
}

export interface InventoryMovement {
  id: string;
  inventoryItemId: string;
  type: string;
  quantityDelta: number;
  quantityAfter: number;
  reason: string | null;
  actorId: string | null;
  printJobId: string | null;
  createdAt: string;
}

/** 20.x stock. Reads need VIEW_INVENTORY, writes MANAGE_INVENTORY. */
export class InventoryResource {
  constructor(private readonly http: HttpClient) {}

  summary(shopId: string): Promise<InventorySummary> {
    return this.http.request("/v1/shop/inventory/summary", { query: { shopId } });
  }

  alerts(
    shopId: string,
    params: { status?: "OPEN" | "RESOLVED"; limit?: number; offset?: number } = {},
  ): Promise<Page<InventoryAlert>> {
    return this.http.request("/v1/shop/inventory/alerts", { query: { shopId, ...params } });
  }

  /** The `PUT` alias for the tracking switch (MANAGE_INVENTORY). */
  setTracking(shopId: string, trackingEnabled: boolean): Promise<{ trackingEnabled: boolean }> {
    return this.http.request("/v1/shop/inventory/settings", {
      method: "PUT",
      body: { shopId, trackingEnabled },
    });
  }

  listItems(
    shopId: string,
    params: {
      search?: string;
      paperSize?: string;
      lowStock?: boolean;
      active?: boolean;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<Page<InventoryItem>> {
    return this.http.request("/v1/shop/inventory/items", { query: { shopId, ...params } });
  }

  getItem(itemId: string): Promise<InventoryItem> {
    return this.http.request(`/v1/shop/inventory/items/${itemId}`);
  }

  createItem(shopId: string, input: InventoryItemInput): Promise<InventoryItem> {
    return this.http.request("/v1/shop/inventory/items", {
      method: "POST",
      body: { shopId, ...input },
    });
  }

  updateItem(itemId: string, input: InventoryItemInput): Promise<InventoryItem> {
    return this.http.request(`/v1/shop/inventory/items/${itemId}`, {
      method: "PATCH",
      body: input,
    });
  }

  /** Replay-safe under `idempotencyKey`: reuse the SAME key only to retry one submission. */
  recordMovement(
    itemId: string,
    input: { type: string; quantityDelta: number; reason?: string },
    idempotencyKey: string,
  ): Promise<InventoryMovement> {
    return this.http.request(`/v1/shop/inventory/items/${itemId}/movements`, {
      method: "POST",
      body: input,
      headers: { "Idempotency-Key": idempotencyKey },
    });
  }

  movements(
    itemId: string,
    params: { limit?: number; offset?: number } = {},
  ): Promise<Page<InventoryMovement>> {
    return this.http.request(`/v1/shop/inventory/items/${itemId}/movements`, {
      query: params as Query,
    });
  }
}

export interface Supplier {
  id: string;
  shopId: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  paymentTerms: string | null;
  status: "ACTIVE" | "INACTIVE";
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierInput {
  name?: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  paymentTerms?: string | null;
  notes?: string | null;
  status?: "ACTIVE" | "INACTIVE";
}

export interface SupplierProduct {
  id: string;
  shopId: string;
  supplierId: string;
  supplierName: string;
  inventoryItemId: string;
  itemName: string;
  supplierSku: string | null;
  unitPriceMinor: number | null;
  leadTimeDays: number | null;
  active: boolean;
}

/** MANAGE_SUPPLIERS. Suppliers are deactivated (status), never deleted. */
export class SuppliersResource {
  constructor(private readonly http: HttpClient) {}

  list(
    shopId: string,
    params: { search?: string; status?: string; limit?: number; offset?: number } = {},
  ): Promise<Page<Supplier>> {
    return this.http.request("/v1/shop/suppliers", { query: { shopId, ...params } });
  }

  get(id: string): Promise<Supplier> {
    return this.http.request(`/v1/shop/suppliers/${id}`);
  }

  create(shopId: string, input: SupplierInput & { name: string }): Promise<Supplier> {
    return this.http.request("/v1/shop/suppliers", { method: "POST", body: { shopId, ...input } });
  }

  update(id: string, input: SupplierInput): Promise<Supplier> {
    return this.http.request(`/v1/shop/suppliers/${id}`, { method: "PATCH", body: input });
  }

  products(
    id: string,
    params: { limit?: number; offset?: number } = {},
  ): Promise<Page<SupplierProduct>> {
    return this.http.request(`/v1/shop/suppliers/${id}/products`, { query: params as Query });
  }

  linkProduct(
    id: string,
    input: {
      inventoryItemId: string;
      supplierSku?: string;
      unitPriceMinor?: number;
      leadTimeDays?: number;
    },
  ): Promise<SupplierProduct> {
    return this.http.request(`/v1/shop/suppliers/${id}/products`, { method: "POST", body: input });
  }

  updateProduct(
    linkId: string,
    input: {
      supplierSku?: string | null;
      unitPriceMinor?: number | null;
      leadTimeDays?: number | null;
      active?: boolean;
    },
  ): Promise<SupplierProduct> {
    return this.http.request(`/v1/shop/supplier-products/${linkId}`, {
      method: "PATCH",
      body: input,
    });
  }

  unlinkProduct(linkId: string): Promise<void> {
    return this.http.request(`/v1/shop/supplier-products/${linkId}`, { method: "DELETE" });
  }

  ofItem(
    itemId: string,
    params: { limit?: number; offset?: number } = {},
  ): Promise<Page<SupplierProduct>> {
    return this.http.request(`/v1/shop/inventory/items/${itemId}/suppliers`, {
      query: params as Query,
    });
  }
}

export interface PurchaseOrderLine {
  id: string;
  inventoryItemId: string;
  itemName: string;
  quantityOrdered: number;
  unitCostMinor: number;
  quantityReceived: number | null;
}

export interface PurchaseOrder {
  id: string;
  shopId: string;
  supplierId: string;
  supplierName: string;
  poNumber: string;
  status: string;
  paymentStatus: string;
  expectedDeliveryAt: string | null;
  actualDeliveryAt: string | null;
  totalCostMinor: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  lines: PurchaseOrderLine[];
}

/** MANAGE_INVENTORY. */
export class PurchaseOrdersResource {
  constructor(private readonly http: HttpClient) {}

  list(
    shopId: string,
    params: { status?: string; supplierId?: string; limit?: number; offset?: number } = {},
  ): Promise<Page<PurchaseOrder>> {
    return this.http.request("/v1/shop/purchase-orders", { query: { shopId, ...params } });
  }

  get(id: string): Promise<PurchaseOrder> {
    return this.http.request(`/v1/shop/purchase-orders/${id}`);
  }

  create(input: {
    shopId: string;
    supplierId: string;
    expectedDeliveryAt?: string;
    notes?: string;
    lines: Array<{ inventoryItemId: string; quantity: number; unitCostMinor?: number }>;
  }): Promise<PurchaseOrder> {
    return this.http.request("/v1/shop/purchase-orders", { method: "POST", body: input });
  }

  update(
    id: string,
    input: { expectedDeliveryAt?: string | null; notes?: string | null },
  ): Promise<PurchaseOrder> {
    return this.http.request(`/v1/shop/purchase-orders/${id}`, { method: "PATCH", body: input });
  }

  setPayment(id: string, paymentStatus: string): Promise<PurchaseOrder> {
    return this.http.request(`/v1/shop/purchase-orders/${id}/payment`, {
      method: "PATCH",
      body: { paymentStatus },
    });
  }

  place(id: string): Promise<PurchaseOrder> {
    return this.http.request(`/v1/shop/purchase-orders/${id}/order`, { method: "POST" });
  }

  cancel(id: string): Promise<PurchaseOrder> {
    return this.http.request(`/v1/shop/purchase-orders/${id}/cancel`, { method: "POST" });
  }

  /** Idempotent on the server: receiving an already-received PO changes nothing. */
  receive(
    id: string,
    input: {
      actualDeliveryAt?: string;
      lines?: Array<{ lineId: string; quantityReceived: number }>;
    } = {},
  ): Promise<PurchaseOrder> {
    return this.http.request(`/v1/shop/purchase-orders/${id}/receive`, {
      method: "POST",
      body: input,
    });
  }
}
