import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type CardProps = HTMLAttributes<HTMLDivElement> & {
  tone?: "light" | "dark";
  /** Adds hover lift and border highlight. */
  interactive?: boolean;
  /** p-6 padding (default true). */
  padded?: boolean;
};

export function Card({
  tone = "light",
  interactive = false,
  padded = true,
  className,
  ...rest
}: CardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border",
        tone === "dark"
          ? "border-white/10 bg-ink-900/60 text-white"
          : "border-ink-100 bg-white text-ink-900 shadow-sm",
        padded && "p-6",
        interactive &&
          "transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md",
        className,
      )}
      {...rest}
    />
  );
}
