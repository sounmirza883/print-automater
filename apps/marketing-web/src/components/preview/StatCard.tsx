import { cn } from "@/lib/cn";
import { surface } from "./surface";

export type StatCardProps = {
  label: string;
  value: string;
  /** Short change note, e.g. "+12% vs last week". */
  delta?: string;
  trend?: "up" | "down" | "flat";
  className?: string;
};

const trendClass = {
  up: "text-emerald-700",
  down: "text-rose-700",
  flat: "text-ink-600",
} as const;

export function StatCard({ label, value, delta, trend = "flat", className }: StatCardProps) {
  return (
    <div className={cn(surface, "p-3 sm:p-4", className)}>
      <p className="text-xs font-medium text-ink-600">{label}</p>
      <p className="mt-1.5 font-mono text-xl font-semibold tabular-nums tracking-tight text-ink-900 sm:text-2xl">
        {value}
      </p>
      {delta ? <p className={cn("mt-1 text-xs", trendClass[trend])}>{delta}</p> : null}
    </div>
  );
}
