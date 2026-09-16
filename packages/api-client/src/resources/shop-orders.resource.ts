import type { HttpClient } from "../http-client.js";
import type { ShopOrderResponse, ShopOrdersGrouped, ShopRejectionReason } from "../types.js";

export class ShopOrdersResource {
  constructor(private readonly http: HttpClient) {}

  list(shopId: string): Promise<ShopOrdersGrouped> {
    return this.http.request<ShopOrdersGrouped>("/v1/shop/orders", { query: { shopId } });
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
}
