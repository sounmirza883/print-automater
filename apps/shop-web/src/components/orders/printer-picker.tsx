"use client";

import type { ReactNode } from "react";
import type { ShopOrderResponse } from "@print-automated/api-client";
import { getApi, isForbidden } from "@/lib/api";
import { capabilityProblems } from "@/lib/order-actions";
import { humanizeEnum } from "@/lib/format";
import { useResource } from "@/lib/use-resource";

/** Choose a printer for a job. Each option says what that printer lacks
 * for THIS job (a hint from its capabilities and status); picking one
 * anyway is allowed, because the API is the authority and answers
 * PRINTER_CAPABILITY_MISMATCH / PRINTER_NOT_AVAILABLE with an explanation.
 * An operator cannot list printers (the API restricts that read), which
 * is said plainly rather than shown as an empty list. */
export function PrinterPicker({
  shopId,
  config,
  value,
  onChange,
  emptyLabel,
  label = "Printer",
}: {
  shopId: string;
  config: ShopOrderResponse["printConfiguration"];
  value: string;
  onChange: (printerId: string) => void;
  /** When set, an empty choice is offered with this label (e.g. "Let the system choose"). */
  emptyLabel?: string;
  label?: string;
}): ReactNode {
  const printers = useResource(() => getApi().printers.listPage(shopId, { limit: 100 }), [shopId]);

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
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-md border border-line bg-panel px-2 py-1.5 font-normal"
      >
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
