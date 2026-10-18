import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { timelineSteps } from "./data";
import { surface } from "./surface";

export type OrderTimelineProps = {
  order?: string;
  className?: string;
};

export function OrderTimeline({ order = "PA-10482", className }: OrderTimelineProps) {
  return (
    <div className={cn(surface, "p-4", className)}>
      <p className="text-xs font-medium text-ink-600">
        Order <span className="font-mono text-ink-900">{order}</span>
      </p>
      <ol className="mt-3">
        {timelineSteps.map((s, i) => {
          const last = i === timelineSteps.length - 1;
          return (
            <li
              key={s.label}
              aria-current={s.current ? "step" : undefined}
              className="relative flex gap-3 pb-4 last:pb-0"
            >
              {!last ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute left-[9px] top-5 h-full w-px",
                    s.done ? "bg-brand-600" : "bg-ink-200",
                  )}
                />
              ) : null}
              <span
                aria-hidden="true"
                className={cn(
                  "z-10 mt-0.5 flex size-5 shrink-0 items-center justify-center border-2",
                  s.done && "border-ink-900 bg-ink-900 text-ink-50",
                  s.current && "border-brand-600 bg-white",
                  !s.done && !s.current && "border-ink-300 bg-white",
                )}
              >
                {s.done ? (
                  <Check className="size-3" strokeWidth={3} />
                ) : s.current ? (
                  <span className="size-2 bg-brand-600" />
                ) : null}
              </span>
              <div className="flex flex-1 items-baseline justify-between gap-2">
                <span
                  className={cn(
                    "text-sm",
                    s.done || s.current ? "font-medium text-ink-900" : "text-ink-600",
                  )}
                >
                  {s.label}
                  <span className="sr-only">
                    {s.done ? " (done)" : s.current ? " (in progress)" : " (pending)"}
                  </span>
                </span>
                <span className="font-mono text-xs text-ink-600">{s.time}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
