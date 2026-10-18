import { cn } from "@/lib/cn";
import { stockRows, type StockRow } from "./data";
import { surface } from "./surface";

export type InventoryMeterProps = {
  items?: StockRow[];
  ariaLabel?: string;
  /** Optional card title, shown above the meters (dashboard-widget style). */
  title?: string;
  className?: string;
};

export function InventoryMeter({
  items = stockRows,
  ariaLabel = "Paper stock levels",
  title,
  className,
}: InventoryMeterProps) {
  if (title) {
    return (
      <div className={cn(surface, "p-4", className)}>
        <h4 className="text-xs font-medium text-ink-600">{title}</h4>
        <MeterList items={items} ariaLabel={ariaLabel} className="mt-3" />
      </div>
    );
  }
  return (
    <MeterList items={items} ariaLabel={ariaLabel} className={cn(surface, "p-4", className)} />
  );
}

function MeterList({
  items,
  ariaLabel,
  className,
}: {
  items: StockRow[];
  ariaLabel: string;
  className?: string;
}) {
  return (
    <ul aria-label={ariaLabel} className={cn("space-y-4", className)}>
      {items.map((s) => {
        const low = s.level <= s.threshold;
        return (
          <li key={s.item}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium text-ink-900">{s.item}</span>
              <span
                className={cn(
                  "whitespace-nowrap font-mono text-xs tabular-nums",
                  low ? "font-bold text-ink-950" : "text-ink-600",
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
              className="relative mt-1.5 h-2 overflow-hidden bg-ink-100"
            >
              <div
                className={cn("h-full", low ? "bg-ink-400" : "bg-ink-900")}
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
