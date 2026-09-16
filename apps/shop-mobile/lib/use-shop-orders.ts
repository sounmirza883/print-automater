import { useEffect, useState } from "react";
import type { ApiClient, ShopOrdersGrouped } from "@print-automated/api-client";

export type ShopOrdersState =
  | { phase: "loading" }
  | { phase: "ready"; data: ShopOrdersGrouped }
  | { phase: "error"; message: string };

/** §8.5's own Done-when: "a counter updates within 5s of a backend
 * change" -- plain polling, not a websocket/SSE channel this MVP
 * doesn't have. */
export const SHOP_ORDERS_POLL_INTERVAL_MS = 5000;

export function useShopOrders(apiClient: ApiClient, shopId: string | null): ShopOrdersState {
  const [state, setState] = useState<ShopOrdersState>({ phase: "loading" });

  useEffect(() => {
    if (shopId === null) {
      return;
    }
    // Captured as a plain non-null local -- narrowing from the `if`
    // above doesn't carry into the nested `load` function declaration.
    const activeShopId = shopId;
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const data = await apiClient.shopOrders.list(activeShopId);
        if (!cancelled) {
          setState({ phase: "ready", data });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            phase: "error",
            message: error instanceof Error ? error.message : "Could not load orders.",
          });
        }
      }
    }

    void load();
    const interval = setInterval(() => void load(), SHOP_ORDERS_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [apiClient, shopId]);

  return state;
}
