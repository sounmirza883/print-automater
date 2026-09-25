import { cn } from "@/lib/cn";
import { stockRows, type StockRow } from "./data";

export type InventoryMeterProps = {
  items?: StockRow[];
  ariaLabel?: string;
  className?: string;
};

export function InventoryMeter({
  items = stockRows,
  ariaLabel = "Paper stock levels",
  className,
}: InventoryMeterProps) {
  return (
    <ul
      aria-label={ariaLabel}
      className={cn("space-y-4 rounded-lg border border-ink-100 bg-white p-4", className)}
    >
      {items.map((s) => {
        const low = s.level <= s.threshold;
        return (
          <li key={s.item}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium text-ink-900">{s.item}</span>
              <span
                className={cn(
                  "font-mono text-xs",
                  low ? "font-semibold text-rose-700" : "text-ink-600",
                )}
              >
                {s.remaining} {s.unit}
                {low ? ", reorder" : ""}
              </span>
            </div>
            <div
              role="meter"
              aria-label={`${s.item} stock`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={s.level}
              aria-valuetext={`${s.level}% remaining${low ? ", below reorder threshold" : ""}`}
              className="relative mt-1.5 h-2 overflow-hidden rounded-full bg-ink-100"
            >
              <div
                className={cn("h-full rounded-full", low ? "bg-rose-600" : "bg-brand-600")}
                style={{ width: `${s.level}%` }}
              />
              <span
                aria-hidden="true"
                className="absolute inset-y-0 w-px bg-ink-900/60"
                style={{ left: `${s.threshold}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-ink-600">
              {s.detail}, reorder at {s.threshold}%
            </p>
          </li>
        );
      })}
    </ul>
  );
}
