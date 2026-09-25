"use client";

import { useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import { BarChart3, Boxes, ClipboardList, Printer, type LucideIcon } from "lucide-react";
import {
  BrowserFrame,
  InventoryMeter,
  JobQueueTable,
  MiniBarChart,
  OrderTimeline,
  PrinterStatusList,
  StatCard,
  weeklyPages,
} from "@/components/preview";
import { Reveal, Section, SectionHeader } from "@/components/ui";
import { cn } from "@/lib/cn";

type TabId = "orders" | "printers" | "inventory" | "reports";

const tabs: { id: TabId; label: string; icon: LucideIcon; url: string }[] = [
  { id: "orders", label: "Orders", icon: ClipboardList, url: "app.printautomated.example/orders" },
  { id: "printers", label: "Printers", icon: Printer, url: "app.printautomated.example/printers" },
  {
    id: "inventory",
    label: "Inventory",
    icon: Boxes,
    url: "app.printautomated.example/inventory",
  },
  { id: "reports", label: "Reports", icon: BarChart3, url: "app.printautomated.example/reports" },
];

const ledger = [
  { when: "09:16", what: "PA-10482 consumed", item: "A4 80gsm", qty: "-21 sheets" },
  { when: "09:02", what: "Delivery received", item: "A4 130gsm gloss", qty: "+500 sheets" },
  { when: "08:47", what: "PA-10479 consumed", item: "A5 130gsm", qty: "-125 sheets" },
  { when: "08:30", what: "Manual adjustment (jam)", item: "A3 100gsm", qty: "-4 sheets" },
];

const monthly = [
  { label: "Jan", value: 41 },
  { label: "Feb", value: 48 },
  { label: "Mar", value: 52 },
  { label: "Apr", value: 61 },
  { label: "May", value: 58 },
  { label: "Jun", value: 74 },
];

function OrdersPanel() {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="min-w-0 lg:col-span-2">
        <h3 className="mb-2 text-sm font-semibold text-ink-900">Production queue</h3>
        <JobQueueTable />
      </div>
      <div className="min-w-0">
        <h3 className="mb-2 text-sm font-semibold text-ink-900">Order lifecycle</h3>
        <OrderTimeline />
      </div>
    </div>
  );
}

function PrintersPanel() {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="min-w-0 lg:col-span-2">
        <h3 className="mb-2 text-sm font-semibold text-ink-900">Printers</h3>
        <PrinterStatusList />
      </div>
      <div className="min-w-0 space-y-3">
        <h3 className="text-sm font-semibold text-ink-900">Failover</h3>
        <div className="rounded-lg border border-ink-100 bg-white p-4 text-sm text-ink-700">
          <p className="font-medium text-ink-900">Printer 2 went offline at 09:11</p>
          <p className="mt-1">
            3 queued jobs were moved to Printer 4 and Printer 3. Auto-failover is on for this shop.
          </p>
        </div>
        <StatCard label="Jobs rerouted today" value="3" delta="0 failed, 0 lost" trend="up" />
      </div>
    </div>
  );
}

function InventoryPanel() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="min-w-0">
        <h3 className="mb-2 text-sm font-semibold text-ink-900">Paper stock</h3>
        <InventoryMeter />
      </div>
      <div className="min-w-0">
        <h3 className="mb-2 text-sm font-semibold text-ink-900">Recent movements</h3>
        <div className="relative overflow-x-auto rounded-lg border border-ink-100 bg-white">
          <table className="w-full text-left text-xs sm:text-sm">
            <caption className="sr-only">Recent paper stock movements</caption>
            <thead className="border-b border-ink-100 bg-ink-50 text-xs text-ink-600">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Time
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Movement
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Qty
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {ledger.map((l) => (
                <tr key={l.when + l.what}>
                  <td className="px-3 py-2.5 font-mono text-xs text-ink-600">{l.when}</td>
                  <td className="px-3 py-2.5">
                    <span className="block text-ink-900">{l.what}</span>
                    <span className="block text-xs text-ink-600">{l.item}</span>
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2.5 text-right font-mono text-xs font-medium",
                      l.qty.startsWith("+") ? "text-emerald-700" : "text-ink-700",
                    )}
                  >
                    {l.qty}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ReportsPanel() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Revenue (June)" value="$7,420" delta="+27% vs May" trend="up" />
        <StatCard label="Orders" value="1,912" delta="+11%" trend="up" />
        <StatCard label="Avg. turnaround" value="18 min" delta="-3 min" trend="up" />
        <StatCard label="Paper waste" value="1.4%" delta="-0.6 pts" trend="up" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-ink-100 bg-white p-4">
          <h3 className="text-sm font-semibold text-ink-900">Pages printed, this week</h3>
          <MiniBarChart
            data={weeklyPages}
            highlight={4}
            ariaLabel="Pages printed per day this week: Monday 1,840, Tuesday 2,210, Wednesday 1,960, Thursday 2,680, Friday 3,120, Saturday 1,490, Sunday 620"
            className="mt-3"
          />
        </div>
        <div className="rounded-lg border border-ink-100 bg-white p-4">
          <h3 className="text-sm font-semibold text-ink-900">Revenue by month ($ hundreds)</h3>
          <MiniBarChart
            data={monthly}
            highlight={5}
            ariaLabel="Monthly revenue in hundreds of dollars, rising from 41 in January to 74 in June"
            className="mt-3"
          />
        </div>
      </div>
    </div>
  );
}

const panels: Record<TabId, () => ReactElement> = {
  orders: OrdersPanel,
  printers: PrintersPanel,
  inventory: InventoryPanel,
  reports: ReportsPanel,
};

export function ProductPreview() {
  const [active, setActive] = useState<TabId>("orders");
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const focusTab = (index: number) => {
    const next = tabs[(index + tabs.length) % tabs.length]!;
    setActive(next.id);
    refs.current[next.id]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        focusTab(index + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        focusTab(index - 1);
        break;
      case "Home":
        e.preventDefault();
        focusTab(0);
        break;
      case "End":
        e.preventDefault();
        focusTab(tabs.length - 1);
        break;
    }
  };

  const current = tabs.find((t) => t.id === active)!;
  const Panel = panels[active];

  return (
    <Section id="product-preview" tone="dark">
      <SectionHeader
        id="product-preview"
        tone="dark"
        eyebrow="Product preview"
        title="One workspace for the whole shop floor"
        lede="Take a look at the screens your team lives in: orders moving through the queue, printers and their load, paper on the shelf, and the numbers that show how the shop is doing."
      />

      <Reveal className="mx-auto mt-10 max-w-6xl md:mt-14">
        <div
          role="tablist"
          aria-label="Product areas"
          className="mx-auto mb-6 grid w-full max-w-xl grid-cols-2 gap-1 rounded-xl border border-white/10 bg-white/5 p-1 sm:grid-cols-4"
        >
          {tabs.map((t, i) => {
            const selected = t.id === active;
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                ref={(el) => {
                  refs.current[t.id] = el;
                }}
                type="button"
                role="tab"
                id={`preview-tab-${t.id}`}
                aria-selected={selected}
                aria-controls={`preview-panel-${t.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActive(t.id)}
                onKeyDown={(e) => onKeyDown(e, i)}
                className={cn(
                  "flex h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300",
                  selected
                    ? "bg-white text-ink-900 shadow-sm"
                    : "text-ink-200 hover:bg-white/10 hover:text-white",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                {t.label}
              </button>
            );
          })}
        </div>

        <BrowserFrame url={current.url}>
          <div
            role="tabpanel"
            id={`preview-panel-${active}`}
            aria-labelledby={`preview-tab-${active}`}
            tabIndex={0}
            className="p-3 focus-visible:-outline-offset-2 sm:p-5"
          >
            <Panel />
          </div>
        </BrowserFrame>
        <p className="mt-4 text-center text-xs text-ink-300">
          Illustrative sample data. Names, orders and figures are placeholders.
        </p>
      </Reveal>
    </Section>
  );
}
