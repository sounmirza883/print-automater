import { useEffect, useState } from "react";
import type { ApiClient, ShopOrdersGrouped } from "@print-automated/api-client";
import { useIsOffline } from "./use-is-offline.js";

export type ShopOrdersState =
  | { phase: "loading" }
  | { phase: "ready"; data: ShopOrdersGrouped }
  | { phase: "error"; message: string };

/** §8.5's own Done-when: "a counter updates within 5s of a backend
 * change" -- plain polling, not a websocket/SSE channel this MVP
 * doesn't have. */
export const SHOP_ORDERS_POLL_INTERVAL_MS = 5000;

/** §89/§90/10.7: `isOffline` in the dependency array does double duty --
 * going offline tears this effect down (clearing the interval, so no
 * requests are wasted retrying against a connection known to be down,
 * and `state` is left exactly as it was, preserving the last-known-good
 * list rather than clobbering it with an error) and coming back online
 * re-runs it from scratch, which fires `load()` immediately rather than
 * waiting up to SHOP_ORDERS_POLL_INTERVAL_MS for the next tick -- that
 * immediate catch-up IS "synchronize on reconnect," for free, from the
 * same effect-dependency mechanism every other hook in this app already
 * uses for its own inputs. */
export function useShopOrders(apiClient: ApiClient, shopId: string | null): ShopOrdersState {
  const [state, setState] = useState<ShopOrdersState>({ phase: "loading" });
  const isOffline = useIsOffline();

  useEffect(() => {
    if (shopId === null || isOffline) {
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
  }, [apiClient, shopId, isOffline]);

  return state;
}
