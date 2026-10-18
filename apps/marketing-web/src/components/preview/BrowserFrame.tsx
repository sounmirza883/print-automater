import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type BrowserFrameProps = {
  /** Text shown in the fake address bar. */
  url?: string;
  children: ReactNode;
  className?: string;
};

/** Decorative window chrome around a product mock. */
export function BrowserFrame({
  url = "app.printautomated.example/dashboard",
  children,
  className,
}: BrowserFrameProps) {
  return (
    <div
      data-app-mock
      data-tone="dark"
      className={cn("overflow-hidden border border-ink-600 bg-ink-900", className)}
    >
      <div className="flex items-center gap-3 border-b border-ink-700 px-3 py-2.5">
        <div className="flex shrink-0 gap-1.5" aria-hidden="true">
          <span className="size-2.5 border border-ink-400" />
          <span className="size-2.5 border border-ink-400" />
          <span className="size-2.5 border border-ink-400" />
        </div>
        <div className="min-w-0 flex-1 truncate border border-ink-700 px-3 py-1 text-center font-mono text-[11px] text-ink-300">
          {url}
        </div>
        <span className="hidden w-10 sm:block" aria-hidden="true" />
      </div>
      <div className="bg-ink-50 text-ink-900">{children}</div>
    </div>
  );
}
