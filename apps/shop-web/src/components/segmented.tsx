import type { ReactNode } from "react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** For an option whose label is only an icon. */
  ariaLabel?: string;
}

/** A few mutually exclusive choices side by side (reporting period, theme,
 * workspace). Each is a real button with `aria-pressed`, so it reads as a
 * toggle group rather than as tabs. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  className = "",
}: {
  value: T;
  onChange: (next: T) => void;
  options: ReadonlyArray<SegmentedOption<T>>;
  ariaLabel: string;
  className?: string;
}): ReactNode {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`inline-flex gap-0.5 rounded-[10px] bg-panel-2 p-[3px] ${className}`}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            aria-label={option.ariaLabel}
            onClick={() => onChange(option.value)}
            className={`inline-flex min-h-[30px] flex-1 items-center justify-center gap-1.5 rounded-[7px] px-3 text-sm font-medium whitespace-nowrap max-sm:min-h-10 ${
              active ? "bg-panel text-ink shadow-panel" : "text-muted hover:text-ink"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
