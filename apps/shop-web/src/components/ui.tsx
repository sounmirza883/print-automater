import Link from "next/link";
import type { ReactNode } from "react";
import { ApiClientError } from "@print-automated/api-client";
import { describeError, isForbidden } from "@/lib/api";
import { formatAge, initialsOf } from "@/lib/format";
import type { Tone } from "@/lib/job-status";

/** The console's small component kit: dense panels, big tabular numbers,
 * status pills that never rely on colour alone (each carries text), and
 * consistent loading / empty / error / forbidden states. */

export type { Tone };

const TONE_PILL: Record<Tone, string> = {
  neutral: "bg-panel-2 text-ink-2",
  good: "bg-good-soft text-good-fg",
  caution: "bg-caution-soft text-caution-fg",
  danger: "bg-danger-soft text-danger-fg",
  accent: "bg-accent-soft text-accent-fg",
};

const TONE_BORDER: Record<Tone, string> = {
  neutral: "border-line",
  good: "border-good/40",
  caution: "border-caution/40",
  danger: "border-danger/40",
  accent: "border-accent/40",
};

const TONE_DOT: Record<Tone, string> = {
  neutral: "bg-quiet",
  good: "bg-good",
  caution: "bg-caution",
  danger: "bg-danger",
  accent: "bg-accent",
};

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-ink",
  good: "text-good-fg",
  caution: "text-caution-fg",
  danger: "text-danger-fg",
  accent: "text-accent-fg",
};

/** Data marks (bars, meters) are ink unless a status tone is asked for:
 * colour is reserved for status, and "accent" was only ever the default. */
function markFill(tone: Tone | undefined): string {
  return tone === undefined || tone === "accent" ? "bg-inv" : TONE_DOT[tone];
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}): ReactNode {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl leading-[30px] font-semibold tracking-[-0.02em]">{title}</h1>
        {subtitle !== undefined && <p className="mt-0.5 text-muted">{subtitle}</p>}
      </div>
      {actions !== undefined && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({
  title,
  aside,
  children,
  className = "",
  tone = "neutral",
  id,
  flushOnPhone = false,
}: {
  title?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  tone?: Tone;
  id?: string;
  /** On a phone, drop the panel's own border, fill and padding; for a panel
   * whose table turns into cards there. */
  flushOnPhone?: boolean;
}): ReactNode {
  const border = TONE_BORDER[tone];
  return (
    <section
      id={id}
      aria-labelledby={title ? `${id ?? title}-h` : undefined}
      // min-w-0: as a grid or flex item a panel may shrink below its content's width, so a
      // wide table scrolls inside it instead of widening the page on a phone.
      className={`min-w-0 rounded-lg border ${border} bg-panel shadow-panel ${className}${
        flushOnPhone ? " max-sm:border-0 max-sm:bg-transparent max-sm:shadow-none" : ""
      }`}
    >
      {title !== undefined && (
        <div
          className={`flex items-center justify-between gap-2 border-b border-line px-4 py-3.5 ${
            flushOnPhone ? "max-sm:border-0 max-sm:px-0" : ""
          }`}
        >
          <h2 id={`${id ?? title}-h`} className="text-sm font-semibold">
            {title}
          </h2>
          {aside !== undefined && <div className="text-xs text-muted">{aside}</div>}
        </div>
      )}
      <div className={flushOnPhone ? "p-4 max-sm:p-0" : "p-4"}>{children}</div>
    </section>
  );
}

export function Pill({
  tone = "neutral",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}): ReactNode {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${TONE_PILL[tone]}`}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

/** One headline figure. With `href` the whole tile is a link (used for
 * counts that lead somewhere: blocked jobs -> the queue). */
export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
  href,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  href?: string;
}): ReactNode {
  const body = (
    <>
      <dt className="flex items-center gap-1.5 text-[13px] text-muted">
        {tone !== "neutral" && (
          <span aria-hidden="true" className={`size-1.5 rounded-full ${TONE_DOT[tone]}`} />
        )}
        {label}
      </dt>
      <dd
        className={`mt-1.5 text-[28px] leading-[34px] font-semibold tracking-[-0.02em] tabular-nums ${TONE_TEXT[tone]}`}
      >
        {value}
      </dd>
      {hint !== undefined && <dd className="mt-1 text-xs text-muted">{hint}</dd>}
    </>
  );
  const shell = "rounded-lg border border-line bg-panel px-4 py-4 shadow-panel";
  return href !== undefined ? (
    <Link href={href} className={`${shell} block hover:border-line-strong`}>
      <dl>{body}</dl>
    </Link>
  ) : (
    <dl className={shell}>{body}</dl>
  );
}

export function StatGrid({ children }: { children: ReactNode }): ReactNode {
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">{children}</div>;
}

export function Skeleton({ className = "" }: { className?: string }): ReactNode {
  return <div aria-hidden="true" className={`skeleton ${className}`} />;
}

export function LoadingGrid({ label = "Loading" }: { label?: string }): ReactNode {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}…</span>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-20" />
        ))}
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}): ReactNode {
  return (
    <div className="rounded-lg border border-dashed border-line-strong bg-panel px-6 py-12 text-center">
      <p className="font-semibold">{title}</p>
      {children !== undefined && <p className="mx-auto mt-1 max-w-md text-muted">{children}</p>}
      {action !== undefined && <div className="mt-4">{action}</div>}
    </div>
  );
}

const BUTTON_VARIANT = {
  primary: "border-transparent bg-inv text-inv-ink hover:opacity-90",
  secondary: "border-line bg-panel text-ink hover:border-line-strong hover:bg-panel-2",
  ghost: "border-transparent bg-transparent text-ink hover:bg-panel-2",
  danger: "border-transparent bg-danger text-white hover:opacity-90",
} as const;

const BUTTON_SIZE = {
  sm: "min-h-8 px-2.5 text-[13px] max-sm:min-h-10",
  md: "min-h-9 px-3 text-sm max-sm:min-h-11",
  lg: "min-h-11 px-4 text-sm font-semibold",
} as const;

export function Button({
  children,
  onClick,
  disabled,
  variant = "secondary",
  size = "md",
  type = "button",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: keyof typeof BUTTON_VARIANT;
  size?: keyof typeof BUTTON_SIZE;
  type?: "button" | "submit";
  className?: string;
}): ReactNode {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md border font-medium whitespace-nowrap disabled:pointer-events-none disabled:opacity-50 ${BUTTON_SIZE[size]} ${BUTTON_VARIANT[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

/** 403: the API says this role may not see this. Shown in place of the
 * screen, not as a generic failure. */
export function ForbiddenState({ what = "this screen" }: { what?: string }): ReactNode {
  return (
    <div role="alert" className="rounded-lg border border-line bg-panel px-6 py-12 text-center">
      <p className="font-semibold">You don&apos;t have access to {what}</p>
      <p className="mx-auto mt-1 max-w-md text-muted">
        Your role at this business does not include it. If you think it should, ask the business
        owner to change your role.
      </p>
    </div>
  );
}

/** A failed load. 403 becomes the forbidden state; everything else offers a retry. */
export function ErrorState({
  error,
  onRetry,
  what,
}: {
  error: unknown;
  onRetry?: () => void;
  what?: string;
}): ReactNode {
  if (isForbidden(error)) {
    return <ForbiddenState what={what} />;
  }
  return (
    <div role="alert" className="rounded-lg border border-danger/40 bg-danger-soft px-6 py-8">
      <p className="font-semibold text-danger-fg">Could not load {what ?? "this screen"}</p>
      <p className="mt-1">{describeError(error)}</p>
      {error instanceof ApiClientError && error.request_id !== "unknown" && (
        <p className="num mt-1 text-xs text-muted">Reference {error.request_id}</p>
      )}
      {onRetry !== undefined && (
        <div className="mt-4">
          <Button onClick={onRetry}>Try again</Button>
        </div>
      )}
    </div>
  );
}

/** "Showing data from 2 min ago" when a background refresh fails but
 * older numbers are still on screen. */
export function StaleBanner({
  error,
  lastUpdated,
  onRetry,
}: {
  error: unknown;
  lastUpdated: number | null;
  onRetry: () => void;
}): ReactNode {
  if (error === null || error === undefined) {
    return null;
  }
  return (
    <Notice
      tone="caution"
      role="status"
      className="mb-4 flex flex-wrap items-center justify-between gap-2"
    >
      <span>
        Live updates paused: {describeError(error)}
        {lastUpdated !== null && (
          <> Showing data from {formatAge(new Date(lastUpdated).toISOString())}.</>
        )}
      </span>
      <Button onClick={onRetry}>Retry now</Button>
    </Notice>
  );
}

const NOTICE_TONE: Record<Tone, string> = {
  neutral: "border-line bg-panel-2 text-ink",
  good: "border-good/40 bg-good-soft text-ink",
  caution: "border-caution/40 bg-caution-soft text-ink",
  danger: "border-danger/40 bg-danger-soft text-danger-fg",
  accent: "border-accent/40 bg-accent-soft text-ink",
};

/** A tinted message box: something failed (danger), needs care (caution),
 * worked (good), or is worth knowing (accent). It sets no ARIA role itself:
 * whether a message interrupts a screen reader (`alert`), is read politely
 * (`status`) or is just there (`note`, or nothing) is the caller's decision,
 * and a box that guessed would start announcing messages that were quiet. */
export function Notice({
  tone = "accent",
  role,
  children,
  className = "",
}: {
  tone?: Tone;
  role?: "alert" | "status" | "note";
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <div
      role={role}
      className={`rounded-md border px-3 py-2 text-sm ${NOTICE_TONE[tone]} ${className}`}
    >
      {children}
    </div>
  );
}

/** The way back from a detail page to its list. */
export function BackLink({ href, children }: { href: string; children: ReactNode }): ReactNode {
  return (
    <Link
      href={href}
      className="mb-3 inline-flex min-h-9 items-center gap-1 text-sm font-medium text-muted hover:text-ink max-sm:min-h-11"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M15 6l-6 6 6 6" />
      </svg>
      {children}
    </Link>
  );
}

/** A detail page's two columns from `xl` up: the working area, and a narrower
 * column of reference facts beside it. One column below `xl`, main first.
 * (Not `lg`: beside the sidebar, the main column would be phone-width on a
 * 1024px screen.) When the reference column renders nothing, the main column
 * takes the full width. */
export function DetailGrid({ main, aside }: { main: ReactNode; aside: ReactNode }): ReactNode {
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start xl:has-[>div:last-child:empty]:grid-cols-1">
      <div className="grid min-w-0 gap-4 wrap-anywhere">{main}</div>
      <div className="grid min-w-0 gap-4 wrap-anywhere empty:hidden">{aside}</div>
    </div>
  );
}

/** Freshness + manual refresh, shown in a page header. */
export function LiveStatus({
  lastUpdated,
  refreshing,
  onRefresh,
}: {
  lastUpdated: number | null;
  refreshing: boolean;
  onRefresh: () => void;
}): ReactNode {
  return (
    <div className="flex items-center gap-2 text-xs text-muted" aria-live="off">
      <span className="num">
        {refreshing
          ? "Updating…"
          : lastUpdated !== null
            ? `Updated ${new Date(lastUpdated).toLocaleTimeString("en", { timeStyle: "short" })}`
            : ""}
      </span>
      <Button size="sm" onClick={onRefresh} disabled={refreshing}>
        Refresh
      </Button>
    </div>
  );
}

/** A labelled horizontal bar. The number is printed beside the bar, so
 * the bar is decoration for people who can see it and the figure is what
 * everyone else reads. */
export function BarList({
  rows,
  ariaLabel,
}: {
  rows: Array<{ label: string; value: number; tone?: Tone; href?: string }>;
  ariaLabel: string;
}): ReactNode {
  const max = Math.max(1, ...rows.map((row) => row.value));
  if (rows.length === 0) {
    return <p className="text-muted">Nothing to show.</p>;
  }
  return (
    <ul aria-label={ariaLabel} className="grid gap-2">
      {rows.map((row) => {
        const label = row.href ? (
          <Link href={row.href} className="underline-offset-2 hover:underline">
            {row.label}
          </Link>
        ) : (
          row.label
        );
        return (
          <li key={row.label} className="grid grid-cols-[8.5rem_1fr_3.5rem] items-center gap-3">
            <span className="truncate text-sm">{label}</span>
            <span aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-panel-2">
              <span
                className={`block h-full rounded-full ${markFill(row.tone)}`}
                style={{ width: `${(row.value / max) * 100}%`, minWidth: row.value > 0 ? 4 : 0 }}
              />
            </span>
            <span className="num text-right text-sm font-medium">{row.value}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Used vs allowance. `role="meter"` with text alongside. */
export function Meter({
  value,
  max,
  label,
  tone = "accent",
}: {
  value: number;
  max: number;
  label: string;
  tone?: Tone;
}): ReactNode {
  const fraction = max <= 0 ? 0 : Math.min(1, value / max);
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      className="h-2 overflow-hidden rounded-full bg-panel-2"
    >
      <div
        className={`h-full rounded-full ${markFill(tone)}`}
        style={{ width: `${fraction * 100}%` }}
      />
    </div>
  );
}

/** Simple responsive table wrapper: scrolls sideways on a phone rather than squashing. */
export function DataTable({
  caption,
  head,
  children,
  stackOnPhone = false,
}: {
  caption: string;
  head: Array<string | { label: string; align: "right" }>;
  children: ReactNode;
  /** On a phone, show each row as a card of label and value instead of a
   * sideways-scrolling table. Rows must then be built with `Row` and `Cell`. */
  stackOnPhone?: boolean;
}): ReactNode {
  // A stacked table is no longer display:table below `sm`, which strips its table
  // semantics in some browsers; the explicit roles put them back.
  const role = <R extends string>(name: R): { role: R } | Record<string, never> =>
    stackOnPhone ? { role: name } : {};
  return (
    <div className={stackOnPhone ? "sm:-mx-4 sm:overflow-x-auto" : "-mx-4 overflow-x-auto"}>
      <table
        {...role("table")}
        className={
          stackOnPhone
            ? "stack-sm w-full text-left text-sm sm:min-w-[32rem]"
            : "w-full min-w-[32rem] text-left text-sm"
        }
      >
        <caption className="sr-only">{caption}</caption>
        <thead {...role("rowgroup")}>
          <tr {...role("row")} className="border-y border-line bg-panel-2 text-xs text-muted">
            {head.map((cell) => {
              const label = typeof cell === "string" ? cell : cell.label;
              const right = typeof cell !== "string" && cell.align === "right";
              return (
                <th
                  key={label}
                  {...role("columnheader")}
                  scope="col"
                  className={`px-4 py-2.5 font-medium whitespace-nowrap ${right ? "text-right" : ""}`}
                >
                  {label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody {...role("rowgroup")} className="divide-y divide-line">
          {children}
        </tbody>
      </table>
    </div>
  );
}

/** A row of a `stackOnPhone` table. On a phone the row is laid out as a card,
 * which stops it being a table row for assistive tech unless it says so. */
export function Row({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <tr role="row" className={className}>
      {children}
    </tr>
  );
}

/** A cell of a `stackOnPhone` table. `label` is the column's heading, printed
 * beside the value on a phone. Leave it out for the row's title (the first
 * cell) and for a cell that holds only actions. */
export function Cell({
  label,
  children,
  className = "",
  colSpan,
}: {
  label?: string;
  children?: ReactNode;
  className?: string;
  colSpan?: number;
}): ReactNode {
  return (
    <td role="cell" data-label={label} colSpan={colSpan} className={`px-4 py-2 ${className}`}>
      {children}
    </td>
  );
}

/** A square button holding only an icon. `label` is what a screen reader says. */
export function IconButton({
  label,
  onClick,
  href,
  children,
  className = "",
}: {
  label: string;
  onClick?: () => void;
  href?: string;
  children: ReactNode;
  className?: string;
}): ReactNode {
  const look = `relative grid size-9 shrink-0 place-items-center rounded-md border border-line bg-panel text-ink hover:border-line-strong hover:bg-panel-2 max-sm:size-11 ${className}`;
  return href !== undefined ? (
    <Link href={href} aria-label={label} className={look}>
      {children}
    </Link>
  ) : (
    <button type="button" aria-label={label} onClick={onClick} className={look}>
      {children}
    </button>
  );
}

/** Initials in a tile. Decorative: the name is always printed beside it. */
export function Avatar({
  name,
  size = "md",
  tone = "soft",
  round = false,
}: {
  name: string;
  size?: "sm" | "md";
  tone?: "inv" | "soft";
  round?: boolean;
}): ReactNode {
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center text-xs font-semibold ${
        size === "sm" ? "size-7" : "size-[30px]"
      } ${round ? "rounded-full" : "rounded-md"} ${
        tone === "inv" ? "bg-inv text-inv-ink" : "bg-panel-2 text-ink"
      }`}
    >
      {initialsOf(name)}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }): ReactNode {
  return (
    <kbd className="rounded border border-line bg-panel-2 px-1.5 font-mono text-[11px] leading-[18px] text-muted">
      {children}
    </kbd>
  );
}

/** The row above a list: search first, then filters, then actions. Wraps on a phone. */
export function Toolbar({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}): ReactNode {
  return <div className={`mb-4 flex flex-wrap items-end gap-2 ${className}`}>{children}</div>;
}
