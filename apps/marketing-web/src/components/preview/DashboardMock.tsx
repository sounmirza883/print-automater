import { BarChart3, Boxes, ClipboardList, LayoutDashboard, Printer, Settings } from "lucide-react";
import { cn } from "@/lib/cn";
import { weeklyPages } from "./data";
import { InventoryMeter } from "./InventoryMeter";
import { JobQueueTable } from "./JobQueueTable";
import { MiniBarChart } from "./MiniBarChart";
import { PrinterStatusList } from "./PrinterStatusList";
import { StatCard } from "./StatCard";

const nav = [
  { icon: LayoutDashboard, label: "Overview", active: true },
  { icon: ClipboardList, label: "Orders" },
  { icon: Printer, label: "Printers" },
  { icon: Boxes, label: "Inventory" },
  { icon: BarChart3, label: "Reports" },
  { icon: Settings, label: "Settings" },
];

/** Full shop dashboard mock. Pure presentation; wrap in aria-hidden where decorative. */
export function DashboardMock({ className }: { className?: string }) {
  return (
    <div className={cn("flex min-h-0 text-left", className)}>
      <aside className="hidden w-44 shrink-0 border-r border-ink-100 bg-white p-3 lg:block">
        <p className="px-2 py-1.5 font-mono text-xs font-semibold uppercase tracking-widest text-ink-900">
          Copy Corner
        </p>
        <ul className="mt-2 space-y-0.5">
          {nav.map(({ icon: Icon, label, active }) => (
            <li
              key={label}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                active ? "bg-brand-50 font-medium text-brand-800" : "text-ink-600",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {label}
            </li>
          ))}
        </ul>
      </aside>
      <div className="min-w-0 flex-1 p-3 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-ink-900">Today at Copy Corner</p>
            <p className="text-xs text-ink-600">Live production overview</p>
          </div>
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">
            Auto-allocation on
          </span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
          <StatCard label="Orders today" value="86" delta="+14% vs last Fri" trend="up" />
          <StatCard label="Pages printed" value="3,120" delta="+9%" trend="up" />
          <StatCard label="In queue" value="7" delta="avg wait 4 min" />
          <StatCard label="Revenue" value="$642" delta="+6%" trend="up" />
        </div>
        <div className="mt-3 grid gap-3 sm:mt-4 sm:gap-4 xl:grid-cols-5">
          <div className="min-w-0 xl:col-span-3">
            <JobQueueTable />
          </div>
          <div className="min-w-0 xl:col-span-2">
            <PrinterStatusList />
          </div>
        </div>
        <div className="mt-3 hidden gap-3 sm:mt-4 sm:grid sm:grid-cols-2 sm:gap-4">
          <div className="rounded-lg border border-ink-100 bg-white p-4">
            <p className="text-xs font-medium text-ink-600">Pages printed this week</p>
            <MiniBarChart
              data={weeklyPages}
              highlight={4}
              ariaLabel="Bar chart of pages printed per day this week, peaking on Friday at 3,120"
              className="mt-2"
            />
          </div>
          <InventoryMeter />
        </div>
      </div>
    </div>
  );
}
