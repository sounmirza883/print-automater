import { cn } from "@/lib/cn";
import { printerRows, type PrinterRow, type PrinterState } from "./data";

const dot: Record<PrinterState, string> = {
  Printing: "bg-brand-600",
  Idle: "bg-emerald-600",
  Offline: "bg-rose-600",
  "Low paper": "bg-amber-500",
};

const label: Record<PrinterState, string> = {
  Printing: "text-brand-800",
  Idle: "text-emerald-800",
  Offline: "text-rose-800",
  "Low paper": "text-amber-900",
};

export type PrinterStatusListProps = {
  printers?: PrinterRow[];
  /** Accessible name for the list. */
  ariaLabel?: string;
  className?: string;
};

export function PrinterStatusList({
  printers = printerRows,
  ariaLabel = "Printer status",
  className,
}: PrinterStatusListProps) {
  return (
    <ul
      aria-label={ariaLabel}
      className={cn("divide-y divide-ink-100 rounded-lg border border-ink-100 bg-white", className)}
    >
      {printers.map((p) => (
        <li key={p.name} className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
          <span aria-hidden="true" className={cn("size-2.5 shrink-0 rounded-full", dot[p.state])} />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium text-ink-900">
              {p.name}
              <span className={cn("text-xs font-medium", label[p.state])}>{p.state}</span>
            </p>
            <p className="truncate text-xs text-ink-600">
              {p.model}, {p.detail}
            </p>
          </div>
          <div className="w-16 shrink-0 sm:w-24">
            <div
              role="meter"
              aria-label={`${p.name} load`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={p.load}
              className="h-1.5 overflow-hidden rounded-full bg-ink-100"
            >
              <div
                className={cn(
                  "h-full rounded-full",
                  p.state === "Offline" ? "bg-ink-300" : "bg-brand-600",
                )}
                style={{ width: `${p.load}%` }}
              />
            </div>
            <p className="mt-1 text-right font-mono text-[11px] text-ink-600">{p.load}%</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
