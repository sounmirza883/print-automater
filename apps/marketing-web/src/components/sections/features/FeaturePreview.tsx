import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { FeaturePreviewKind } from "@/content/features";

/**
 * Small self-contained illustrative UI mocks for the feature blocks.
 * Static, decorative: exposed to assistive tech as a single labelled image.
 */

const labels: Record<FeaturePreviewKind, string> = {
  ordering: "Illustration: an order form showing a live price of 24.50 for 40 colour pages",
  allocation: "Illustration: a job re-routed from an offline printer to an available one",
  queue: "Illustration: a production queue with jobs in printing, queued and ready states",
  inventory: "Illustration: paper stock meters with one item flagged low",
  payments: "Illustration: an invoice with line items and a paid status",
  dashboards: "Illustration: a revenue bar chart and role list",
};

function Frame({ kind, children }: { kind: FeaturePreviewKind; children: ReactNode }) {
  return (
    <div
      role="img"
      aria-label={labels[kind]}
      className="relative overflow-hidden rounded-2xl border border-ink-100 bg-white p-4 shadow-lg shadow-ink-900/5 ring-1 ring-ink-900/[0.02] sm:p-5"
    >
      <div aria-hidden="true" className="select-none text-ink-900">
        <div className="mb-3 flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-cmyk-cyan" />
          <span className="size-2 rounded-full bg-cmyk-magenta" />
          <span className="size-2 rounded-full bg-cmyk-yellow" />
        </div>
        {children}
      </div>
    </div>
  );
}

function Dot({ className }: { className: string }) {
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", className)} />;
}

function Ordering() {
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between rounded-lg border border-dashed border-ink-200 bg-ink-50 px-3 py-2.5">
        <span className="truncate font-medium">thesis-final.pdf</span>
        <span className="font-mono text-xs text-ink-600">40 pages · colour</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {[
          ["Paper", "A4 · 80gsm"],
          ["Sides", "Double"],
          ["Finish", "Spiral bind"],
          ["Copies", "2"],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-ink-100 px-3 py-2">
            <p className="text-xs text-ink-600">{k}</p>
            <p className="font-medium">{v}</p>
          </div>
        ))}
      </div>
      <div className="flex items-end justify-between rounded-lg bg-brand-600 px-4 py-3 text-white">
        <span className="text-sm text-brand-50">Your price</span>
        <span className="font-mono text-2xl font-semibold">24.50</span>
      </div>
    </div>
  );
}

function Allocation() {
  const printers = [
    { name: "Printer 2", note: "Offline", dot: "bg-red-500", off: true },
    { name: "Printer 3", note: "Busy · 6 jobs", dot: "bg-cmyk-yellow", off: false },
    { name: "Printer 4", note: "Ready · colour", dot: "bg-emerald-500", off: false },
  ];
  return (
    <div className="space-y-3 text-sm">
      <ul className="space-y-2">
        {printers.map((p) => (
          <li
            key={p.name}
            className={cn(
              "flex items-center justify-between rounded-lg border px-3 py-2.5",
              p.off ? "border-red-200 bg-red-50" : "border-ink-100",
              p.name === "Printer 4" && "border-brand-300 ring-2 ring-brand-100",
            )}
          >
            <span className="flex items-center gap-2 font-medium">
              <Dot className={p.dot} />
              {p.name}
            </span>
            <span className="text-xs text-ink-600">{p.note}</span>
          </li>
        ))}
      </ul>
      <p className="rounded-lg bg-ink-950 px-3 py-2.5 font-mono text-xs text-ink-100">
        Job #1042 rerouted: Printer 2 <span className="text-brand-300">→</span> Printer 4
      </p>
    </div>
  );
}

function Queue() {
  const rows = [
    { id: "#1041", name: "Flyers A5 x 500", state: "Printing", cls: "bg-brand-50 text-brand-700" },
    { id: "#1042", name: "Thesis, bound", state: "Queued", cls: "bg-ink-100 text-ink-700" },
    { id: "#1039", name: "Menu cards", state: "Ready", cls: "bg-emerald-50 text-emerald-800" },
  ];
  return (
    <ul className="space-y-2 text-sm">
      {rows.map((r) => (
        <li
          key={r.id}
          className="flex items-center justify-between gap-3 rounded-lg border border-ink-100 px-3 py-2.5"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="font-mono text-xs text-ink-500">{r.id}</span>
            <span className="truncate font-medium">{r.name}</span>
          </span>
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", r.cls)}>
            {r.state}
          </span>
        </li>
      ))}
      <li className="pt-1">
        <div className="h-1.5 overflow-hidden rounded-full bg-ink-100">
          <div className="h-full w-2/3 rounded-full bg-brand-500" />
        </div>
        <p className="mt-1.5 text-xs text-ink-600">Job #1041: 320 of 500 pages</p>
      </li>
    </ul>
  );
}

function Inventory() {
  const items = [
    { name: "A4 80gsm", pct: 72, cls: "bg-brand-500", note: "3,600 sheets" },
    { name: "A3 100gsm", pct: 45, cls: "bg-brand-500", note: "900 sheets" },
    { name: "A4 photo gloss", pct: 12, cls: "bg-cmyk-magenta", note: "Low · reorder" },
  ];
  return (
    <ul className="space-y-3 text-sm">
      {items.map((i) => (
        <li key={i.name}>
          <div className="mb-1 flex justify-between">
            <span className="font-medium">{i.name}</span>
            <span className="text-xs text-ink-600">{i.note}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-ink-100">
            <div className={cn("h-full rounded-full", i.cls)} style={{ width: `${i.pct}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Payments() {
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-ink-600">INV-2026-0318</span>
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
          Paid
        </span>
      </div>
      <dl className="divide-y divide-ink-100 rounded-lg border border-ink-100">
        {[
          ["Colour prints x 40", "20.00"],
          ["Spiral binding", "4.50"],
          ["Tax", "0.00"],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between px-3 py-2">
            <dt className="text-ink-600">{k}</dt>
            <dd className="font-mono">{v}</dd>
          </div>
        ))}
        <div className="flex justify-between bg-ink-50 px-3 py-2 font-semibold">
          <dt>Total</dt>
          <dd className="font-mono">24.50</dd>
        </div>
      </dl>
    </div>
  );
}

function Dashboards() {
  const bars = [38, 52, 44, 68, 60, 82, 74];
  return (
    <div className="space-y-3 text-sm">
      <div className="flex h-24 items-end gap-2 rounded-lg bg-ink-50 p-3">
        {bars.map((h, i) => (
          <div
            key={i}
            className={cn("flex-1 rounded-t", i === 5 ? "bg-brand-600" : "bg-brand-200")}
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {["Owner", "Manager", "Counter", "Operator"].map((r) => (
          <span key={r} className="rounded-full bg-ink-100 px-2.5 py-0.5 text-xs text-ink-700">
            {r}
          </span>
        ))}
      </div>
    </div>
  );
}

export function FeaturePreview({ kind }: { kind: FeaturePreviewKind }) {
  const body = {
    ordering: <Ordering />,
    allocation: <Allocation />,
    queue: <Queue />,
    inventory: <Inventory />,
    payments: <Payments />,
    dashboards: <Dashboards />,
  }[kind];
  return <Frame kind={kind}>{body}</Frame>;
}
