import { useEffect, useState } from "react";
import type { ApiClient, PrinterResponse } from "@print-automated/api-client";
import { SHOP_ORDERS_POLL_INTERVAL_MS } from "./use-shop-orders.js";
import { useIsOffline } from "./use-is-offline.js";

export type PrintersState =
  | { phase: "loading" }
  | { phase: "ready"; printers: PrinterResponse[] }
  | { phase: "error"; message: string };

/** Same 5s polling cadence as `useShopOrders` -- a printer going
 * offline/online is exactly the kind of change §31's Shop Home also
 * wants to reflect promptly. `refresh` is exposed (unlike
 * useShopOrders) because 8.9's own register/rename/enable-disable/
 * remove actions want to reflect their own result immediately, not
 * wait for the next poll tick -- it just bumps a counter the effect
 * depends on, re-running the same fetch, rather than a `useCallback`
 * exposed for the effect to call (that shape trips the
 * react-hooks/set-state-in-effect lint rule). */
export function usePrinters(
  apiClient: ApiClient,
  shopId: string | null,
): PrintersState & { refresh: () => void } {
  const [state, setState] = useState<PrintersState>({ phase: "loading" });
  const [refreshCount, setRefreshCount] = useState(0);
  // §89/§90/10.7: same "tear down while offline, refetch immediately on
  // reconnect" pattern as use-shop-orders.ts's own dependency-array
  // trick -- see that file's comment for the full reasoning.
  const isOffline = useIsOffline();

  useEffect(() => {
    if (shopId === null || isOffline) {
      return;
    }
    const activeShopId = shopId;
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const printers = await apiClient.printers.list(activeShopId);
        if (!cancelled) {
          setState({ phase: "ready", printers });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            phase: "error",
            message: error instanceof Error ? error.message : "Could not load printers.",
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
  }, [apiClient, shopId, refreshCount, isOffline]);

  return { ...state, refresh: () => setRefreshCount((count) => count + 1) };
}
