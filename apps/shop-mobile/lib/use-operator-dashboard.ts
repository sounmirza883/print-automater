import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "@print-automated/api-client";
import type { OperatorDashboardResponse } from "@print-automated/types";
import { useIsOffline } from "./use-is-offline.js";

export type OperatorDashboardState =
  | { phase: "loading" }
  | { phase: "ready"; data: OperatorDashboardResponse; refreshing: boolean }
  | { phase: "error"; message: string };

/** Production is a live activity: the same 15 s shop-web's production view polls at. */
export const OPERATOR_DASHBOARD_POLL_MS = 15_000;
/** How many jobs each list shows; the full counts come with it. */
export const OPERATOR_DASHBOARD_LIMIT = 10;

/** 23.33: the operator's production view (GET /shop/dashboard/operator). Same offline
 * behaviour as use-shop-orders.ts: no polling while offline, the last good data kept, and an
 * immediate reload on reconnect. `reload()` is for pull-to-refresh. */
export function useOperatorDashboard(
  apiClient: ApiClient,
  shopId: string | null,
  enabled: boolean,
): { state: OperatorDashboardState; reload: () => void } {
  const [state, setState] = useState<OperatorDashboardState>({ phase: "loading" });
  const isOffline = useIsOffline();
  const loadRef = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    if (shopId === null || !enabled || isOffline) {
      return;
    }
    const activeShopId = shopId;
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const data = await apiClient.dashboard.operator(activeShopId, OPERATOR_DASHBOARD_LIMIT);
        if (!cancelled) {
          setState({ phase: "ready", data, refreshing: false });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            phase: "error",
            message: error instanceof Error ? error.message : "Could not load production.",
          });
        }
      }
    }

    loadRef.current = load;
    void load();
    const interval = setInterval(() => void load(), OPERATOR_DASHBOARD_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [apiClient, shopId, enabled, isOffline]);

  const reload = useCallback(() => {
    setState((current) => (current.phase === "ready" ? { ...current, refreshing: true } : current));
    void loadRef.current();
  }, []);

  return { state, reload };
}
