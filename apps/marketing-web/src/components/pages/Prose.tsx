import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Readable long-form typography for docs, legal and blog content (no typography plugin needed). */
export function Prose({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "max-w-none text-base leading-7 text-ink-700",
        "[&_h2]:mt-12 [&_h2]:scroll-mt-24 [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:text-ink-950",
        "[&_h3]:mt-8 [&_h3]:scroll-mt-24 [&_h3]:text-lg [&_h3]:font-bold [&_h3]:text-ink-950",
        "[&_p]:mt-4 [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6",
        "[&_ol]:mt-4 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-6",
        "[&_a]:font-medium [&_a]:text-ink-950 [&_a]:underline [&_a]:underline-offset-4 hover:[&_a]:decoration-2",
        "[&_strong]:font-semibold [&_strong]:text-ink-950",
        "[&_:not(pre)>code]:bg-ink-100 [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[0.9em] [&_:not(pre)>code]:text-ink-900",
        "[&_table]:mt-6 [&_table]:w-full [&_table]:text-left [&_table]:text-sm [&_th]:border-b [&_th]:border-ink-400 [&_th]:py-2 [&_th]:pr-4 [&_th]:font-semibold [&_th]:text-ink-950 [&_td]:border-b [&_td]:border-ink-400 [&_td]:py-2 [&_td]:pr-4",
        className,
      )}
    >
      {children}
    </div>
  );
}
