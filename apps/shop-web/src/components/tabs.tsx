import Link from "next/link";
import type { ReactNode } from "react";

export interface TabItem {
  id: string;
  label: string;
  count?: number | string;
  /** With `href` the tab is a link (its own URL); without, a button calling `onSelect`. */
  href?: string;
  /** A caution dot before the label: this group needs a person. */
  emphasis?: boolean;
}

/** The underlined tab row used above lists and dashboards. One tab at most is
 * current: `aria-current="page"` for a link tab (its own URL), `"true"` for a
 * button tab (a filter on the same page). Pass `activeId={null}` while a search
 * replaces the groups. The rule sits in an inner div, not on the scrolling `nav`,
 * so the active tab's 2px underline is not clipped by the scroll container. */
export function Tabs({
  items,
  activeId,
  onSelect,
  ariaLabel,
  className = "mb-4",
}: {
  items: ReadonlyArray<TabItem>;
  activeId: string | null;
  onSelect?: (id: string) => void;
  ariaLabel: string;
  className?: string;
}): ReactNode {
  return (
    <nav aria-label={ariaLabel} data-tabs className={`overflow-x-auto ${className}`}>
      <div className="flex min-w-max gap-1 border-b border-line">
        {items.map((item) => {
          const active = item.id === activeId;
          const look = `-mb-px inline-flex min-h-10 shrink-0 items-center gap-2 border-b-2 px-3 text-sm whitespace-nowrap max-sm:min-h-11 ${
            active
              ? "border-ink font-semibold text-ink"
              : "border-transparent font-medium text-muted hover:text-ink"
          }`;
          const body = (
            <>
              {item.emphasis === true && (
                <span aria-hidden="true" className="size-2 rounded-full bg-caution" />
              )}
              {item.label}
              {item.count !== undefined && (
                <span
                  className={`min-w-5 rounded-full px-1.5 text-center text-xs leading-5 font-semibold tabular-nums ${
                    active ? "bg-inv text-inv-ink" : "bg-panel-2 text-muted"
                  }`}
                >
                  {item.count}
                </span>
              )}
            </>
          );
          return item.href !== undefined ? (
            <Link
              key={item.id}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={look}
            >
              {body}
            </Link>
          ) : (
            <button
              key={item.id}
              type="button"
              aria-current={active ? "true" : undefined}
              onClick={() => onSelect?.(item.id)}
              className={look}
            >
              {body}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
