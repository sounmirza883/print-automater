import type { ReactNode } from "react";

const STEPS = ["Your details", "Your file", "Print options"] as const;

/** Where the guest is in the flow. The current step is in ink and marked
 * `aria-current="step"`; finished steps are ticked. On a phone only the
 * current step's name shows, the others are numbers with their names kept for
 * screen readers. */
export function StepIndicator({ current }: { current: 1 | 2 | 3 }): ReactNode {
  return (
    <ol className="mb-6 flex items-center gap-2 text-xs font-medium">
      {STEPS.map((label, index) => {
        const number = index + 1;
        const state = number < current ? "done" : number === current ? "current" : "next";
        return (
          <li
            key={label}
            aria-current={state === "current" ? "step" : undefined}
            className="flex min-w-0 items-center gap-2"
          >
            <span
              className={`grid size-6 shrink-0 place-items-center rounded-full ${
                state === "next" ? "border border-line-strong text-muted" : "bg-inv text-inv-ink"
              }`}
            >
              {state === "done" ? "✓" : number}
            </span>
            <span
              className={`truncate ${state === "current" ? "text-ink" : "text-muted max-sm:sr-only"}`}
            >
              {label}
            </span>
            {number < STEPS.length && (
              <span aria-hidden="true" className="h-px w-4 bg-line-strong sm:w-8" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
