import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { appNavItems, type AppNavItem, type AppViewId } from "./app-nav";

/**
 * The shop's (fictional) logo: three grey squares overprinting, the way a print
 * shop might brand itself.
 */
function ShopMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6 shrink-0 isolate">
      {[
        { x: 3, y: 3, fill: "#989797" },
        { x: 9.5, y: 3, fill: "#666667" },
        { x: 6.25, y: 9.5, fill: "#101014" },
      ].map((r) => (
        <rect key={r.fill} {...r} width={11.5} height={11.5} style={{ mixBlendMode: "multiply" }} />
      ))}
    </svg>
  );
}

/**
 * Sidebar nav item styling, shared by the static hero mock (list items) and the
 * interactive preview (tab buttons). Below the shell's 48rem width the sidebar
 * is an icon rail and the label is visually hidden but still read out.
 */
export function navItemClass(active: boolean) {
  return cn(
    "flex h-12 w-full items-center justify-center gap-2.5 text-sm transition-colors @3xl/shell:h-9 @3xl/shell:justify-start @3xl/shell:px-2.5",
    active ? "bg-ink-900 font-medium text-ink-50" : "text-ink-600",
  );
}

export function NavItemContent({ item, active }: { item: AppNavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <>
      <Icon
        aria-hidden="true"
        className={cn("size-4 shrink-0", active ? "text-ink-50" : "text-ink-500")}
      />
      <span className="sr-only @3xl/shell:not-sr-only">{item.label}</span>
      {item.count ? (
        <span
          aria-hidden="true"
          className="ml-auto hidden bg-ink-100 px-1.5 py-px font-mono text-[11px] font-medium text-ink-700 @3xl/shell:inline"
        >
          {item.count}
        </span>
      ) : null}
      {item.flag === "warning" ? (
        <span
          aria-hidden="true"
          className="ml-auto hidden size-1.5 bg-current @3xl/shell:inline-block"
        />
      ) : null}
    </>
  );
}

/** Non-interactive nav for the decorative hero mock. */
export function StaticNav({ active }: { active: AppViewId }) {
  return (
    <ul className="space-y-0.5">
      {appNavItems.map((item) => (
        <li key={item.id} className={navItemClass(item.id === active)}>
          <NavItemContent item={item} active={item.id === active} />
        </li>
      ))}
    </ul>
  );
}

export type AppShellProps = {
  /** The sidebar's navigation: `StaticNav`, or a tablist in the interactive preview. */
  nav: ReactNode;
  children: ReactNode;
  className?: string;
};

/**
 * The product's frame: shop-branded sidebar plus a main column. Both are
 * container-query contexts, so layout follows the mock's own width (hero,
 * product preview, phone) rather than the viewport.
 */
export function AppShell({ nav, children, className }: AppShellProps) {
  return (
    <div data-app-mock className={cn("@container/shell flex text-left", className)}>
      <aside className="flex w-14 shrink-0 flex-col border-r border-ink-200 bg-white @3xl/shell:w-48">
        <div className="flex h-14 shrink-0 items-center justify-center gap-2.5 border-b border-ink-200 @3xl/shell:justify-start @3xl/shell:px-4">
          <ShopMark />
          <span className="hidden font-mono text-xs font-semibold uppercase tracking-[0.18em] text-ink-900 @3xl/shell:inline">
            Copy Corner
          </span>
        </div>
        <div className="flex-1 p-1 @3xl/shell:p-3">{nav}</div>
        <div className="flex items-center justify-center gap-2.5 border-t border-ink-200 py-3 @3xl/shell:justify-start @3xl/shell:px-4">
          <span aria-hidden="true" className="size-2 shrink-0 bg-ink-900" />
          <span className="hidden min-w-0 @3xl/shell:block">
            <span className="block text-xs font-medium text-ink-900">Printer agent</span>
            <span className="block text-[11px] text-ink-600">Connected, 4 of 5 online</span>
          </span>
        </div>
      </aside>
      <div className="@container/main min-w-0 flex-1">{children}</div>
    </div>
  );
}
