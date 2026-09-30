import { cn } from "@/lib/cn";
import { printerRows, type PrinterRow, type PrinterState } from "./data";
import { surface } from "./surface";

const dot: Record<PrinterState, string> = {
  Printing: "bg-brand-600",
  Idle: "bg-emerald-600",
  Offline: "bg-rose-600",
  "Low paper": "bg-amber-500",
};

const label: Record<PrinterState, string> = {
  Printing: "text-brand-700",
  Idle: "text-emerald-700",
  Offline: "text-rose-700",
  "Low paper": "text-amber-800",
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
    <ul aria-label={ariaLabel} className={cn(surface, "divide-y divide-ink-100", className)}>
      {printers.map((p, i) => {
        const printing = p.state === "Printing";
        // Stagger the print-head sweeps so busy printers don't pulse in lockstep.
        const sweepDelay = `${i * 0.7}s`;
        return (
          <li key={p.name} className="flex items-center gap-3 px-3 py-3 sm:px-4">
            <span
              aria-hidden="true"
              className={cn(
                "size-2 shrink-0 rounded-full ring-4",
                dot[p.state],
                p.state === "Offline" ? "ring-rose-100" : "ring-transparent",
              )}
            />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold text-ink-900">
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
                    "relative h-full overflow-hidden rounded-full",
                    p.state === "Offline" ? "bg-ink-300" : "bg-brand-600",
                  )}
                  style={{ width: `${p.load}%` }}
                >
                  {printing ? (
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-0 left-0 w-1/2 -translate-x-full animate-sweep bg-gradient-to-r from-transparent via-white/70 to-transparent"
                      style={{ animationDelay: sweepDelay }}
                    />
                  ) : null}
                </div>
              </div>
              <p className="mt-1 text-right font-mono text-[11px] tabular-nums text-ink-600">
                {p.load}%
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
