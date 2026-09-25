import type { NotificationItem, Page } from "@print-automated/types";
import type { HttpClient } from "../http-client.js";

export interface NotificationFilter {
  /** `customer`: order notices; `staff`: operational alerts. Default: both. */
  audience?: "customer" | "staff";
  /** One business's staff alerts (implies `audience: "staff"`). */
  shopId?: string;
}

/** 23.7 (PRD 111): the signed-in user's own notification centre (any role). */
export class NotificationsResource {
  constructor(private readonly http: HttpClient) {}

  list(
    params: NotificationFilter & { unread?: boolean; limit?: number; offset?: number } = {},
  ): Promise<Page<NotificationItem>> {
    return this.http.request<Page<NotificationItem>>("/v1/notifications", { query: { ...params } });
  }

  unreadCount(filter: NotificationFilter = {}): Promise<{ count: number }> {
    return this.http.request<{ count: number }>("/v1/notifications/unread-count", {
      query: { ...filter },
    });
  }

  markRead(id: string): Promise<NotificationItem> {
    return this.http.request<NotificationItem>(`/v1/notifications/${id}/read`, {
      method: "POST",
    });
  }

  markAllRead(filter: NotificationFilter = {}): Promise<{ updated: number }> {
    return this.http.request<{ updated: number }>("/v1/notifications/read-all", {
      method: "POST",
      query: { ...filter },
    });
  }
}
