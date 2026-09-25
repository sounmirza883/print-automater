import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type SectionHeaderProps = {
  /** Section id; the heading gets id `${id}-title`. */
  id: string;
  eyebrow?: string;
  title: ReactNode;
  lede?: ReactNode;
  align?: "left" | "center";
  /** Use "dark" on dark bands so text is light. */
  tone?: "light" | "dark";
  /** Heading level, default h2 (h1 only for Hero). */
  as?: "h1" | "h2";
  className?: string;
};

export function SectionHeader({
  id,
  eyebrow,
  title,
  lede,
  align = "center",
  tone = "light",
  as: Heading = "h2",
  className,
}: SectionHeaderProps) {
  const dark = tone === "dark";
  return (
    <div className={cn("max-w-3xl", align === "center" && "mx-auto text-center", className)}>
      {eyebrow ? (
        <p
          className={cn(
            "font-mono text-xs font-medium uppercase tracking-[0.18em]",
            dark ? "text-brand-300" : "text-brand-700",
          )}
        >
          {eyebrow}
        </p>
      ) : null}
      <Heading
        id={`${id}-title`}
        className={cn(
          "mt-3 text-balance font-semibold tracking-tight",
          Heading === "h1"
            ? "text-4xl leading-[1.05] sm:text-5xl lg:text-6xl"
            : "text-3xl sm:text-4xl",
          dark ? "text-white" : "text-ink-900",
        )}
      >
        {title}
      </Heading>
      {lede ? (
        <p
          className={cn(
            "mt-4 text-pretty text-base leading-relaxed sm:text-lg",
            dark ? "text-ink-200" : "text-ink-600",
          )}
        >
          {lede}
        </p>
      ) : null}
    </div>
  );
}
