import type { HttpClient } from "../http-client.js";
import type { Page, ShopOrderResponse, ShopOrdersGrouped, ShopRejectionReason } from "../types.js";

export class ShopOrdersResource {
  constructor(private readonly http: HttpClient) {}

  list(shopId: string): Promise<ShopOrdersGrouped> {
    return this.http.request<ShopOrdersGrouped>("/v1/shop/orders", { query: { shopId } });
  }

  /** 23.6: one flat page of a group (or of every visible order), newest first. */
  listPage(
    shopId: string,
    params: {
      group?: "needsAttention" | "printing" | "ready" | "completed" | "failed";
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<Page<ShopOrderResponse>> {
    return this.http.request<Page<ShopOrderResponse>>("/v1/shop/orders", {
      query: { shopId, limit: params.limit ?? 50, offset: params.offset, group: params.group },
    });
  }

  /** 23.6 (PRD 43/44): search + filters, one flat page, newest first (rate-limited 60/min). */
  search(
    shopId: string,
    params: {
      q?: string;
      status?: string;
      paymentStatus?: string;
      from?: string;
      to?: string;
      customerId?: string;
      printerId?: string;
      operatorId?: string;
      priority?: number;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<Page<ShopOrderResponse>> {
    return this.http.request<Page<ShopOrderResponse>>("/v1/shop/orders/search", {
      query: { shopId, ...params },
    });
  }

  get(orderId: string): Promise<ShopOrderResponse> {
    return this.http.request<ShopOrderResponse>(`/v1/shop/orders/${orderId}`);
  }

  accept(orderId: string): Promise<ShopOrderResponse> {
    return this.http.request<ShopOrderResponse>(`/v1/shop/orders/${orderId}/accept`, {
      method: "POST",
    });
  }

  reject(orderId: string, reason: ShopRejectionReason): Promise<ShopOrderResponse> {
    return this.http.request<ShopOrderResponse>(`/v1/shop/orders/${orderId}/reject`, {
      method: "POST",
      body: { reason },
    });
  }

  markReady(orderId: string): Promise<ShopOrderResponse> {
    return this.http.request<ShopOrderResponse>(`/v1/shop/orders/${orderId}/ready`, {
      method: "POST",
    });
  }

  complete(orderId: string): Promise<ShopOrderResponse> {
    return this.http.request<ShopOrderResponse>(`/v1/shop/orders/${orderId}/complete`, {
      method: "POST",
    });
  }

  retryPrint(orderId: string): Promise<ShopOrderResponse> {
    return this.http.request<ShopOrderResponse>(`/v1/shop/orders/${orderId}/retry-print`, {
      method: "POST",
    });
  }

  resolveUnknown(
    orderId: string,
    resolution: "CONFIRMED_PRINTED" | "RETRY" | "MARK_FAILED",
  ): Promise<ShopOrderResponse> {
    return this.http.request<ShopOrderResponse>(`/v1/shop/orders/${orderId}/resolve-unknown`, {
      method: "POST",
      body: { resolution },
    });
  }

  changePrinter(orderId: string, printerId: string): Promise<ShopOrderResponse> {
    return this.http.request<ShopOrderResponse>(`/v1/shop/orders/${orderId}/change-printer`, {
      method: "POST",
      body: { printerId },
    });
  }
}
