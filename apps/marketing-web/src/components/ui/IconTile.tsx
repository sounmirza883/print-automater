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
  brand: "bg-brand-600 text-white shadow-sm",
  light: "bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100",
  dark: "bg-white/10 text-brand-300 ring-1 ring-inset ring-white/10",
};

/** Decorative rounded icon (aria-hidden); always pair with visible text. */
export function IconTile({ icon: Icon, size = "md", tone = "light", className }: IconTileProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-xl",
        sizes[size],
        tones[tone],
        className,
      )}
    >
      <Icon strokeWidth={1.75} />
    </span>
  );
}
