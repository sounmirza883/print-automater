import type { ReactElement } from "react";
import { cn } from "@/lib/cn";
import type { AppViewId } from "./app-nav";
import { ContextBar } from "./ContextBar";
import {
  mockClock,
  mockTime,
  orderRows,
  overviewStats,
  weeklyPages,
  weeklyPagesLabel,
} from "./data";
import { InventoryMeter } from "./InventoryMeter";
import { JobQueueTable } from "./JobQueueTable";
import { MiniBarChart } from "./MiniBarChart";
import { OrderTimeline } from "./OrderTimeline";
import { PrinterStatusList } from "./PrinterStatusList";
import { StatCard } from "./StatCard";
import { surface } from "./surface";

/**
 * The screens of the dashboard mock. Each renders its own ContextBar (the
 * app's page header) and body, and sizes itself with @container/main queries
 * from AppShell. Pure presentation: shared by the hero mock and the
 * interactive product preview.
 */

const body = "p-3 @2xl/main:p-5";
const gap = "gap-3 @2xl/main:gap-4";
const blockTitle = "mb-2 text-sm font-semibold text-ink-900";

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

const weekSoFar = weeklyPages.reduce((sum, d) => sum + (d.value ?? 0), 0);

function WeeklyPagesCard({ className }: { className?: string }) {
  return (
    <div className={cn(surface, "flex flex-col p-4", className)}>
      <h4 className="text-xs font-medium text-ink-600">Pages printed this week</h4>
      <MiniBarChart
        data={weeklyPages}
        highlight={4}
        ariaLabel={weeklyPagesLabel}
        className="mt-3"
      />
      <dl className="mt-auto grid grid-cols-2 gap-3 border-t border-ink-100 pt-3 text-xs">
        <div>
          <dt className="text-ink-600">Week so far</dt>
          <dd className="mt-0.5 font-mono font-semibold tabular-nums text-ink-900">
            {weekSoFar.toLocaleString("en-US")} pages
          </dd>
        </div>
        <div>
          <dt className="text-ink-600">Busiest day</dt>
          <dd className="mt-0.5 font-mono font-semibold tabular-nums text-ink-900">Thu, 2,680</dd>
        </div>
      </dl>
    </div>
  );
}

export function OverviewView() {
  return (
    <>
      <ContextBar
        title="Today at Copy Corner"
        subtitle={`Live production overview, ${mockClock}`}
        badge={{ tone: "live", text: "Auto-allocation on" }}
      />
      <div className={cn(body, "space-y-3 @2xl/main:space-y-4")}>
        <div className="grid grid-cols-2 gap-2.5 @2xl/main:grid-cols-4 @2xl/main:gap-3">
          {overviewStats.map((s) => (
            <StatCard key={s.label} {...s} />
          ))}
        </div>
        <div className={cn("grid items-start @4xl/main:grid-cols-5", gap)}>
          <JobQueueTable className="min-w-0 @4xl/main:col-span-3" />
          <PrinterStatusList className="min-w-0 @4xl/main:col-span-2" />
        </div>
        <div className={cn("grid @xl/main:grid-cols-2", gap)}>
          <WeeklyPagesCard />
          <InventoryMeter title="Paper stock" />
        </div>
      </div>
    </>
  );
}

export function OrdersView() {
  return (
    <>
      <ContextBar
        title="Orders"
        subtitle="Today, newest first. 7 open, 1 waiting for you to accept."
        badge={{ tone: "live", text: "Accepting orders" }}
      />
      <div className={cn(body, "grid @4xl/main:grid-cols-3", gap)}>
        <div className="min-w-0 @4xl/main:col-span-2">
          <h4 className={blockTitle}>Today&apos;s orders</h4>
          <JobQueueTable rows={orderRows} caption="Today's orders with job, printer and status" />
        </div>
        <div className="min-w-0">
          <h4 className={blockTitle}>Order lifecycle</h4>
          <OrderTimeline />
        </div>
      </div>
    </>
  );
}

export function PrintersView() {
  return (
    <>
      <ContextBar
        title="Printers"
        subtitle="4 of 5 online. Jobs move automatically when one goes down."
        badge={{ tone: "live", text: "Auto-failover on" }}
      />
      <div className={cn(body, "grid @4xl/main:grid-cols-3", gap)}>
        <div className="min-w-0 @4xl/main:col-span-2">
          <h4 className={blockTitle}>Printers</h4>
          <PrinterStatusList />
        </div>
        <div className="min-w-0 space-y-3">
          <h4 className="text-sm font-semibold text-ink-900">Failover</h4>
          <div className={cn(surface, "border-l-2 border-l-ink-900 p-4 text-sm text-ink-700")}>
            <p className="font-medium text-ink-900">Printer 2 went offline at 09:11</p>
            <p className="mt-1">
              3 queued jobs were moved to Printer 4 and Printer 3. Auto-failover is on for this
              shop.
            </p>
          </div>
          <StatCard label="Jobs rerouted today" value="3" delta="0 failed, 0 lost" trend="up" />
        </div>
      </div>
    </>
  );
}

export function InventoryView() {
  return (
    <>
      <ContextBar
        title="Paper stock"
        subtitle="Levels drop as jobs print. Deliveries add them back."
        badge={{ tone: "warning", text: "2 items to reorder" }}
      />
      <div className={cn(body, "grid @3xl/main:grid-cols-2", gap)}>
        <div className="min-w-0">
          <h4 className={blockTitle}>Stock levels</h4>
          <InventoryMeter />
        </div>
        <div className="min-w-0">
          <h4 className={blockTitle}>Recent movements</h4>
          <div className={cn(surface, "relative overflow-x-auto")}>
            <table className="w-full text-left text-xs @2xl/main:text-sm">
              <caption className="sr-only">Recent paper stock movements</caption>
              <thead className="border-b border-ink-100 bg-ink-50/70 text-xs text-ink-600">
                <tr>
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    Time
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    Movement
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">
                    Qty
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {ledger.map((l) => (
                  <tr key={l.when + l.what}>
                    <td className="px-3 py-3 font-mono text-xs text-ink-600">{l.when}</td>
                    <td className="px-3 py-3">
                      <span className="block text-ink-900">{l.what}</span>
                      <span className="block text-xs text-ink-600">{l.item}</span>
                    </td>
                    <td
                      className={cn(
                        "whitespace-nowrap px-3 py-3 text-right font-mono text-xs font-medium tabular-nums",
                        l.qty.startsWith("+") ? "font-medium text-ink-950" : "text-ink-700",
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
    </>
  );
}

export function ReportsView() {
  return (
    <>
      <ContextBar
        title="Reports"
        subtitle="Month to date, compared with last month."
        badge={{ tone: "neutral", text: `Updated ${mockTime}` }}
      />
      <div className={cn(body, "space-y-3 @2xl/main:space-y-4")}>
        <div className="grid grid-cols-2 gap-2.5 @2xl/main:grid-cols-4 @2xl/main:gap-3">
          <StatCard label="Revenue (June)" value="$7,420" delta="+27% vs May" trend="up" />
          <StatCard label="Orders" value="1,912" delta="+11%" trend="up" />
          <StatCard label="Avg. turnaround" value="18 min" delta="-3 min" trend="up" />
          <StatCard label="Paper waste" value="1.4%" delta="-0.6 pts" trend="up" />
        </div>
        <div className={cn("grid @xl/main:grid-cols-2", gap)}>
          <WeeklyPagesCard />
          <div className={cn(surface, "p-4")}>
            <h4 className="text-xs font-medium text-ink-600">Revenue by month ($ hundreds)</h4>
            <MiniBarChart
              data={monthly}
              highlight={5}
              ariaLabel="Monthly revenue in hundreds of dollars, rising from 41 in January to 74 in June"
              className="mt-3"
            />
          </div>
        </div>
      </div>
    </>
  );
}

export const appViews: Record<AppViewId, () => ReactElement> = {
  overview: OverviewView,
  orders: OrdersView,
  printers: PrintersView,
  inventory: InventoryView,
  reports: ReportsView,
};
