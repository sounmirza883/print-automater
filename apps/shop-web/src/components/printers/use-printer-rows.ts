"use client";

import { useMemo } from "react";
import { Permission } from "@print-automated/types";
import { useSession } from "@/components/session-provider";
import { getApi } from "@/lib/api";
import { mergePrinters, type PrinterRow } from "@/lib/printers-view";
import { useResource, type ResourceState } from "@/lib/use-resource";

const POLL_MS = 15_000;

/** The business's printers: profiles from the printer list, joined with
 * live queue/agent/error data when the role may read the printer
 * dashboard. The live half failing (or being forbidden) never blanks the
 * screen; the profile list is what the management screens need. */
export function usePrinterRows(): {
  state: ResourceState<PrinterRow[]>;
  hasLiveData: boolean;
} {
  const { business, can } = useSession();
  const shopId = business?.id ?? "";
  const wantsLive = can(Permission.VIEW_PRINTER_DASHBOARD);

  const list = useResource(() => getApi().printers.listPage(shopId, { limit: 100 }), [shopId], {
    intervalMs: POLL_MS,
    enabled: shopId !== "",
  });
  const live = useResource(() => getApi().dashboard.printers(shopId), [shopId], {
    intervalMs: POLL_MS,
    enabled: shopId !== "" && wantsLive,
  });

  const rows = useMemo(
    () => (list.data === null ? null : mergePrinters(list.data.items, live.data?.items ?? null)),
    [list.data, live.data],
  );

  return {
    state: { ...list, data: rows },
    hasLiveData: live.data !== null,
  };
}
