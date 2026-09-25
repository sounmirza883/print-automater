import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type BadgeVariant = "neutral" | "brand" | "success" | "warning" | "outline" | "dark";
export type BadgeDot = "cyan" | "magenta" | "yellow" | "green" | "brand";

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
  /** Leading status dot (CMYK accents, green, brand). */
  dot?: BadgeDot;
};

const variants: Record<BadgeVariant, string> = {
  neutral: "bg-ink-100 text-ink-700",
  brand: "bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200",
  success: "bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200",
  warning: "bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-200",
  outline: "text-ink-700 ring-1 ring-inset ring-ink-200",
  dark: "bg-white/10 text-ink-100 ring-1 ring-inset ring-white/15",
};

const dots: Record<BadgeDot, string> = {
  cyan: "bg-cmyk-cyan",
  magenta: "bg-cmyk-magenta",
  yellow: "bg-cmyk-yellow",
  green: "bg-emerald-500",
  brand: "bg-brand-500",
};

export function Badge({ variant = "neutral", dot, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        variants[variant],
        className,
      )}
      {...rest}
    >
      {dot ? <span aria-hidden="true" className={cn("size-1.5 rounded-full", dots[dot])} /> : null}
      {children}
    </span>
  );
}
