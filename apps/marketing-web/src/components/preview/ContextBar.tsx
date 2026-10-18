import { cn } from "@/lib/cn";

export type ContextBadge = { text: string; tone: "live" | "warning" | "neutral" };

const badgeTone: Record<ContextBadge["tone"], { pill: string; dot: string }> = {
  live: { pill: "bg-ink-900 text-ink-50 ring-ink-900", dot: "bg-ink-50" },
  warning: { pill: "bg-white text-ink-950 ring-ink-900", dot: "bg-ink-950" },
  neutral: { pill: "bg-ink-50 text-ink-700 ring-ink-200", dot: "bg-ink-400" },
};

export type ContextBarProps = {
  title: string;
  subtitle: string;
  badge?: ContextBadge;
};

/** The app's page header: screen title, a one-line context, and a status badge. */
export function ContextBar({ title, subtitle, badge }: ContextBarProps) {
  return (
    <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-b border-ink-200 bg-white px-4 py-2 @2xl/main:px-5">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
        <p className="text-xs text-ink-600">{subtitle}</p>
      </div>
      {badge ? (
        <span
          className={cn(
            "inline-flex items-center gap-1.5 whitespace-nowrap px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
            badgeTone[badge.tone].pill,
          )}
        >
          <span aria-hidden="true" className={cn("size-1.5", badgeTone[badge.tone].dot)} />
          {badge.text}
        </span>
      ) : null}
    </div>
  );
}
