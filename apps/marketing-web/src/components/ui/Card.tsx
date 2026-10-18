import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type CardProps = HTMLAttributes<HTMLDivElement> & {
  tone?: "light" | "dark";
  /** Darkens the rule and lifts the fill on hover. */
  interactive?: boolean;
  /** p-6 padding (default true). */
  padded?: boolean;
};

/** Flat, square container: a grey rule on cream, no shadow. */
export function Card({
  tone = "light",
  interactive = false,
  padded = true,
  className,
  ...rest
}: CardProps) {
  const dark = tone === "dark";
  return (
    <div
      className={cn(
        "border",
        dark ? "border-ink-600 bg-ink-900 text-ink-50" : "border-ink-400 bg-ink-50 text-ink-900",
        padded && "p-6",
        interactive &&
          (dark
            ? "transition-colors duration-150 hover:border-ink-50"
            : "transition-colors duration-150 hover:border-ink-900 hover:bg-white"),
        className,
      )}
      {...rest}
    />
  );
}
