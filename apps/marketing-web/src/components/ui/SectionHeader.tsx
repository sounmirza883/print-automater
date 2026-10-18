import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type SectionHeaderProps = {
  /** Section id; the heading gets id `${id}-title`. */
  id: string;
  eyebrow?: string;
  title: ReactNode;
  lede?: ReactNode;
  /** "rail" (default) puts the eyebrow in a left rail beside the heading from lg up, for
   * full-width bands. "left" stacks the eyebrow above a left-aligned heading, for narrow
   * columns. "center" stacks everything on one centred axis (the hero). */
  align?: "rail" | "left" | "center";
  /** Use "dark" on dark bands so text is light. */
  tone?: "light" | "dark";
  /** Heading level, default h2 (h1 only for Hero). */
  as?: "h1" | "h2";
  /** Prefix the eyebrow with the next section number (01/, 02/, ...). Defaults on for
   * h2 headers; see the data-marker rule in globals.css. */
  numbered?: boolean;
  className?: string;
};

export function SectionHeader({
  id,
  eyebrow,
  title,
  lede,
  align = "rail",
  tone = "light",
  as: Heading = "h2",
  numbered = Heading !== "h1",
  className,
}: SectionHeaderProps) {
  const dark = tone === "dark";
  const centered = align === "center";
  const eyebrowEl = eyebrow ? (
    <p
      data-marker={numbered ? "" : undefined}
      className={cn(
        "font-mono text-sm font-medium uppercase tracking-[0.12em]",
        dark ? "text-ink-300" : "text-ink-600",
      )}
    >
      {eyebrow}
    </p>
  ) : null;
  const body = (
    <div className={cn("max-w-3xl", centered && "mx-auto")}>
      <Heading
        id={`${id}-title`}
        className={cn(
          "text-balance font-bold",
          Heading === "h1"
            ? "text-4xl leading-[1.2] sm:text-5xl lg:text-6xl"
            : "text-3xl leading-[1.2] sm:text-4xl",
          dark ? "text-ink-50" : "text-ink-950",
        )}
      >
        {title}
      </Heading>
      {lede ? (
        <p
          className={cn(
            "mt-6 text-pretty text-base leading-relaxed sm:text-lg",
            dark ? "text-ink-300" : "text-ink-600",
          )}
        >
          {lede}
        </p>
      ) : null}
    </div>
  );

  if (centered || align === "left") {
    return (
      <div className={cn(centered && "text-center", className)}>
        {eyebrowEl ? <div className="mb-4">{eyebrowEl}</div> : null}
        {body}
      </div>
    );
  }
  return (
    <div className={cn("grid gap-4 lg:grid-cols-12 lg:gap-8", className)}>
      {eyebrowEl ? <div className="lg:col-span-3 lg:pt-3">{eyebrowEl}</div> : null}
      <div className={cn(eyebrowEl ? "lg:col-span-9" : "lg:col-span-12")}>{body}</div>
    </div>
  );
}
