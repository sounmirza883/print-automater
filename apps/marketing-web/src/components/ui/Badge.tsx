import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type BadgeVariant = "neutral" | "brand" | "success" | "warning" | "outline" | "dark";

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
  /** Leading square marker, drawn in the badge's own text colour. */
  dot?: boolean;
};

// Monochrome: weight and outline carry the meaning. A dashed rule marks placeholder
// or not-yet-available content, a solid rule marks a confirmed state.
const variants: Record<BadgeVariant, string> = {
  neutral: "bg-ink-100 text-ink-700",
  brand: "bg-ink-900 text-ink-50",
  success: "border border-ink-900 text-ink-900",
  warning: "border border-dashed border-ink-900 text-ink-900",
  outline: "border border-ink-400 text-ink-700",
  dark: "border border-ink-600 text-ink-100",
};

export function Badge({ variant = "neutral", dot, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 font-mono text-[11px] font-medium uppercase tracking-wider",
        variants[variant],
        className,
      )}
      {...rest}
    >
      {dot ? <span aria-hidden="true" className="size-1.5 bg-current" /> : null}
      {children}
    </span>
  );
}
