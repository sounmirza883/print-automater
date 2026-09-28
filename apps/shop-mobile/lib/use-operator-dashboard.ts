import { useCallback, useEffect, useState } from "react";
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
 * immediate reload on reconnect. `reload()` is for pull-to-refresh: it bumps a counter the
 * effect depends on (the use-printers.ts pattern), and does nothing while nothing can load,
 * so the refresh spinner can never be left turning. */
export function useOperatorDashboard(
  apiClient: ApiClient,
  shopId: string | null,
  enabled: boolean,
): { state: OperatorDashboardState; reload: () => void } {
  const [state, setState] = useState<OperatorDashboardState>({ phase: "loading" });
  const [reloads, setReloads] = useState(0);
  const isOffline = useIsOffline();
  const canLoad = shopId !== null && enabled && !isOffline;

  useEffect(() => {
    if (!canLoad || shopId === null) {
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

    void load();
    const interval = setInterval(() => void load(), OPERATOR_DASHBOARD_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [apiClient, shopId, canLoad, reloads]);

  const reload = useCallback(() => {
    if (!canLoad) {
      return;
    }
    setState((current) => (current.phase === "ready" ? { ...current, refreshing: true } : current));
    setReloads((count) => count + 1);
  }, [canLoad]);

  return { state, reload };
}
