"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import {
  AppShell,
  BrowserFrame,
  NavItemContent,
  appNavItems,
  appViews,
  navItemClass,
  nextTabIndex,
  type AppViewId,
} from "@/components/preview";
import { Reveal, Section, SectionHeader } from "@/components/ui";
import { cn } from "@/lib/cn";

export function ProductPreview() {
  const [active, setActive] = useState<AppViewId>("overview");
  const refs = useRef<Partial<Record<AppViewId, HTMLButtonElement | null>>>({});

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = nextTabIndex(e.key, index, appNavItems.length);
    if (next === null) return;
    e.preventDefault();
    const id = appNavItems[next]!.id;
    setActive(id);
    refs.current[id]?.focus();
  };

  const current = appNavItems.find((t) => t.id === active)!;

  const nav = (
    <div
      role="tablist"
      aria-label="Dashboard screens"
      aria-orientation="vertical"
      className="space-y-0.5"
    >
      {appNavItems.map((item, i) => {
        const selected = item.id === active;
        return (
          <button
            key={item.id}
            ref={(el) => {
              refs.current[item.id] = el;
            }}
            type="button"
            role="tab"
            id={`preview-tab-${item.id}`}
            aria-selected={selected}
            aria-controls={`preview-panel-${item.id}`}
            tabIndex={selected ? 0 : -1}
            title={item.label}
            onClick={() => setActive(item.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              navItemClass(selected),
              "cursor-pointer",
              !selected && "hover:bg-ink-50 hover:text-ink-900",
            )}
          >
            <NavItemContent item={item} active={selected} />
          </button>
        );
      })}
    </div>
  );

  return (
    <Section id="product-preview" tone="dark">
      <SectionHeader
        id="product-preview"
        tone="dark"
        eyebrow="Product preview"
        title="One workspace for the whole shop floor"
        lede="This is the screen your team opens first thing: today's orders, every printer and its load, paper on the shelf, and how the day compares. Use the sidebar to look around."
      />

      <Reveal className="mx-auto mt-10 max-w-6xl md:mt-14">
        <BrowserFrame url={current.url}>
          <AppShell nav={nav} className="min-h-[34rem] lg:min-h-[46rem]">
            {appNavItems.map((item) => {
              const View = appViews[item.id];
              return (
                <div
                  key={item.id}
                  role="tabpanel"
                  id={`preview-panel-${item.id}`}
                  aria-labelledby={`preview-tab-${item.id}`}
                  hidden={item.id !== active}
                  tabIndex={0}
                  // Inset ring: the panel runs to the frame's clipped edges. `!` beats the
                  // unlayered global :focus-visible offset in globals.css.
                  className="focus-visible:-outline-offset-2!"
                >
                  <View />
                </div>
              );
            })}
          </AppShell>
        </BrowserFrame>
        <p className="mt-4 text-center text-xs text-ink-300">
          Illustrative sample data. Names, orders and figures are placeholders.
        </p>
      </Reveal>
    </Section>
  );
}
