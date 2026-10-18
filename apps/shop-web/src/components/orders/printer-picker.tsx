"use client";

import type { ReactNode } from "react";
import type { ShopOrderResponse } from "@print-automated/api-client";
import { INPUT } from "@/components/form-kit";
import { getApi, isForbidden } from "@/lib/api";
import { capabilityProblems } from "@/lib/order-actions";
import { humanizeEnum } from "@/lib/format";
import { useResource } from "@/lib/use-resource";

/** Choose a printer for a job. Each option says what that printer lacks
 * for THIS job (a hint from its capabilities and status); picking one
 * anyway is allowed, because the API is the authority and answers
 * PRINTER_CAPABILITY_MISMATCH / PRINTER_NOT_AVAILABLE with an explanation.
 * Every staff role may list printers (VIEW_PRINTERS, 23.14); if a role
 * ever cannot, that is said plainly rather than shown as an empty list. */
export function PrinterPicker({
  shopId,
  branchId,
  config,
  value,
  onChange,
  emptyLabel,
  label = "Printer",
}: {
  shopId: string;
  /** The order's branch: a job only prints at its own branch, so only that branch's printers are
   * offered (the API refuses another's). Left out, every printer the person may see is offered. */
  branchId?: string;
  config: ShopOrderResponse["printConfiguration"];
  value: string;
  onChange: (printerId: string) => void;
  /** When set, an empty choice is offered with this label (e.g. "Let the system choose"). */
  emptyLabel?: string;
  label?: string;
}): ReactNode {
  const printers = useResource(
    () => getApi().printers.listPage(shopId, { limit: 100, branchId }),
    [shopId, branchId],
  );

  if (printers.data === null) {
    if (printers.error !== null) {
      return (
        <p className="text-sm text-muted">
          {isForbidden(printers.error)
            ? "Your role cannot list printers here. Ask a manager to choose the printer."
            : "Could not load printers."}
        </p>
      );
    }
    return <p className="text-sm text-muted">Loading printers…</p>;
  }

  return (
    <label className="grid gap-1 text-sm font-medium">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className={INPUT}>
        {emptyLabel !== undefined ? (
          <option value="">{emptyLabel}</option>
        ) : (
          <option value="" disabled>
            Choose a printer
          </option>
        )}
        {printers.data.items.map((printer) => {
          const problems = capabilityProblems(printer.capabilities, config);
          if (printer.status !== "ONLINE" && printer.status !== "BUSY") {
            problems.unshift(humanizeEnum(printer.status).toLowerCase());
          }
          return (
            <option key={printer.id} value={printer.id}>
              {printer.name}
              {problems.length > 0 ? ` (${problems.join(", ")})` : ""}
            </option>
          );
        })}
      </select>
    </label>
  );
}
