import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export type IconTileProps = {
  icon: LucideIcon;
  size?: "sm" | "md" | "lg";
  tone?: "brand" | "light" | "dark";
  className?: string;
};

const sizes = {
  sm: "size-9 [&>svg]:size-4",
  md: "size-11 [&>svg]:size-5",
  lg: "size-14 [&>svg]:size-6",
};

const tones = {
  brand: "bg-ink-900 text-ink-50",
  light: "border border-ink-400 text-ink-900",
  dark: "border border-ink-600 text-ink-50",
};

/** Decorative square icon (aria-hidden); always pair with visible text. */
export function IconTile({ icon: Icon, size = "md", tone = "light", className }: IconTileProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        sizes[size],
        tones[tone],
        className,
      )}
    >
      <Icon strokeWidth={1.75} />
    </span>
  );
}
