import type { HttpClient } from "../http-client.js";
import type {
  JobFailureReason,
  Page,
  ReprintReason,
  ShopOrderDelivery,
  ShopOrderResponse,
  ShopOrdersGrouped,
  ShopRejectionReason,
} from "../types.js";

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

  /** Legacy (no `jobId`): the API answers 409 UNKNOWN_JOB_ID_REQUIRED, so new callers use
   * `resolveUnknownPrint`. Kept only so shop-mobile keeps compiling. */
  resolveUnknown(
    orderId: string,
    resolution: "CONFIRMED_PRINTED" | "RETRY" | "MARK_FAILED",
  ): Promise<ShopOrderResponse> {
    return this.http.request<ShopOrderResponse>(`/v1/shop/orders/${orderId}/resolve-unknown`, {
      method: "POST",
      body: { resolution },
    });
  }

  /** `jobId` is required by the API (409 UNKNOWN_JOB_ID_REQUIRED without it). */
  resolveUnknownPrint(
    orderId: string,
    input: {
      resolution: "CONFIRMED_PRINTED" | "RETRY" | "MARK_FAILED";
      jobId: string;
      failureReason?: JobFailureReason;
      failureNote?: string;
    },
  ): Promise<ShopOrderResponse> {
    return this.http.request<ShopOrderResponse>(`/v1/shop/orders/${orderId}/resolve-unknown`, {
      method: "POST",
      body: input,
    });
  }

  /** EDIT_ORDERS: staff recording a cash/offline payment (no PSP). */
  recordPayment(orderId: string): Promise<ShopOrderResponse> {
    return this.http.request<ShopOrderResponse>(`/v1/shop/orders/${orderId}/record-payment`, {
      method: "POST",
    });
  }

  /** QUALITY_CHECK: PASSED / FAILED / NEEDS_REPRINT (the last may name jobs, a reason, a cost). */
  qualityCheck(
    orderId: string,
    input: {
      result: "PASSED" | "FAILED" | "NEEDS_REPRINT";
      note?: string;
      jobIds?: string[];
      reprintReason?: ReprintReason;
      additionalCostMinor?: number;
    },
  ): Promise<ShopOrderResponse> {
    return this.http.request<ShopOrderResponse>(`/v1/shop/orders/${orderId}/quality-check`, {
      method: "POST",
      body: input,
    });
  }

  /** The invoice PDF as a blob (VIEW_ORDERS). */
  invoice(orderId: string): Promise<Blob> {
    return this.http.requestBlob(`/v1/shop/orders/${orderId}/invoice`);
  }

  /** MANAGE_DELIVERY: create or replace the order delivery record. */
  saveDelivery(
    orderId: string,
    input: {
      address: string;
      courier?: string | null;
      trackingNumber?: string | null;
      feeMinor?: number;
    },
  ): Promise<ShopOrderDelivery> {
    return this.http.request<ShopOrderDelivery>(`/v1/shop/orders/${orderId}/delivery`, {
      method: "PUT",
      body: input,
    });
  }

  setDeliveryStatus(
    orderId: string,
    input: {
      status: "OUT_FOR_DELIVERY" | "DELIVERED" | "FAILED" | "CANCELLED";
      courier?: string | null;
      trackingNumber?: string | null;
    },
  ): Promise<ShopOrderDelivery> {
    return this.http.request<ShopOrderDelivery>(`/v1/shop/orders/${orderId}/delivery/status`, {
      method: "POST",
      body: input,
    });
  }

  changePrinter(orderId: string, printerId: string): Promise<ShopOrderResponse> {
    return this.http.request<ShopOrderResponse>(`/v1/shop/orders/${orderId}/change-printer`, {
      method: "POST",
      body: { printerId },
    });
  }
}
