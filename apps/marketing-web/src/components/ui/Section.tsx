import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { Container } from "./Container";

export type SectionTone = "light" | "muted" | "dark";

export type SectionProps = Omit<HTMLAttributes<HTMLElement>, "id"> & {
  /** Anchor id; aria-labelledby defaults to `${id}-title` (the SectionHeader heading id). */
  id: string;
  tone?: SectionTone;
  /** Override aria-labelledby. Pass "" and supply aria-label instead. */
  labelledBy?: string;
  /** Extra classes for the inner Container. */
  containerClassName?: string;
};

const tones: Record<SectionTone, string> = {
  light: "bg-white text-ink-900",
  muted: "bg-ink-50 text-ink-900",
  dark: "bg-ink-950 text-white",
};

/** Standard band: py-20 md:py-28, tone background, inner Container. */
export function Section({
  id,
  tone = "light",
  labelledBy,
  className,
  containerClassName,
  children,
  ...rest
}: SectionProps) {
  const lb = labelledBy ?? `${id}-title`;
  return (
    <section
      id={id}
      aria-labelledby={lb || undefined}
      data-tone={tone}
      className={cn("relative py-20 md:py-28", tones[tone], className)}
      {...rest}
    >
      <Container className={containerClassName}>{children}</Container>
    </section>
  );
}
