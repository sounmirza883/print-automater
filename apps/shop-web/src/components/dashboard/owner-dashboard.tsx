"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { OwnerDashboardResponse } from "@print-automated/types";
import { Permission } from "@print-automated/types";
import { RequirePermission, ResourceBoundary } from "@/components/resource-boundary";
import { useSession } from "@/components/session-provider";
import {
  BarList,
  DataTable,
  EmptyState,
  LiveStatus,
  PageHeader,
  Panel,
  Pill,
  Stat,
  StatGrid,
} from "@/components/ui";
import {
  RANGE_PRESETS,
  attentionItems,
  orderGroupRows,
  rangeFor,
  revenueRows,
  totalAttention,
  type RangePreset,
} from "@/lib/dashboard-view";
import { getApi } from "@/lib/api";
import { formatCount, formatMoney, humanizeEnum } from "@/lib/format";
import { useResource } from "@/lib/use-resource";

const POLL_MS = 30_000;

/** PRD 39, for owners and managers: what the business did today and over
 * the chosen period, what is on the floor right now, and, first, what
 * needs a person. Everything is computed server-side (SQL aggregates
 * scoped to this business); this screen only lays it out. */
export function OwnerDashboard(): ReactNode {
  return (
    <RequirePermission permission={Permission.VIEW_DASHBOARD} what="the business dashboard">
      <OwnerDashboardBody />
    </RequirePermission>
  );
}

function OwnerDashboardBody(): ReactNode {
  const { business } = useSession();
  const [preset, setPreset] = useState<RangePreset>("7d");
  const shopId = business?.id ?? "";
  const state = useResource(
    () => getApi().dashboard.owner(shopId, rangeFor(preset)),
    [shopId, preset],
    { intervalMs: POLL_MS, enabled: shopId !== "" },
  );

  return (
    <>
      <PageHeader
        title="Business dashboard"
        subtitle={business?.name}
        actions={
          <>
            <PeriodPicker value={preset} onChange={setPreset} />
            <LiveStatus
              lastUpdated={state.lastUpdated}
              refreshing={state.refreshing}
              onRefresh={state.reload}
            />
          </>
        }
      />
      <ResourceBoundary state={state} what="the business dashboard">
        {(data) => <OwnerDashboardView data={data} periodLabel={periodLabel(preset)} />}
      </ResourceBoundary>
    </>
  );
}

function periodLabel(preset: RangePreset): string {
  return RANGE_PRESETS.find((option) => option.id === preset)?.label.toLowerCase() ?? "period";
}

function PeriodPicker({
  value,
  onChange,
}: {
  value: RangePreset;
  onChange: (next: RangePreset) => void;
}): ReactNode {
  return (
    <div
      role="group"
      aria-label="Reporting period"
      className="flex rounded-md border border-line bg-panel p-0.5"
    >
      {RANGE_PRESETS.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={`rounded px-3 py-1 text-sm font-medium ${
            value === option.id ? "bg-accent text-white" : "text-muted hover:text-ink"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function OwnerDashboardView({
  data,
  periodLabel: period,
}: {
  data: OwnerDashboardResponse;
  periodLabel: string;
}): ReactNode {
  const { orders, revenue, printing, printers, inventory } = data;
  const attention = attentionItems(data);
  const attentionTotal = totalAttention(data);

  return (
    <div className="grid gap-4">
      <Panel
        title="Needs a person"
        tone={attentionTotal > 0 ? "caution" : "good"}
        aside={attentionTotal > 0 ? `${formatCount(attentionTotal)} open` : "All clear"}
        id="attention"
      >
        {attentionTotal === 0 ? (
          <p className="text-muted">
            Nothing is blocked, failed or waiting on a decision right now.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {attention
              .filter((item) => item.count > 0)
              .map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    className="flex items-start justify-between gap-3 rounded-md border border-line bg-panel-2 px-3 py-2 hover:border-accent"
                  >
                    <span>
                      <span className="block font-medium">{item.label}</span>
                      <span className="block text-xs text-muted">{item.explanation}</span>
                    </span>
                    <Pill tone={item.tone}>
                      <span className="num">{formatCount(item.count)}</span>
                    </Pill>
                  </Link>
                </li>
              ))}
          </ul>
        )}
      </Panel>

      <StatGrid>
        <Stat
          label="Orders today"
          value={formatCount(orders.today)}
          hint={`${formatCount(orders.inPeriod)} orders, ${period}`}
        />
        <Stat
          label="Pending acceptance"
          value={formatCount(orders.pending)}
          tone={orders.pending > 0 ? "caution" : "neutral"}
          hint="Waiting for the business to accept"
          href="/orders?group=needsAttention"
        />
        <Stat
          label="Printing now"
          value={formatCount(printing.printingNow)}
          tone={printing.printingNow > 0 ? "accent" : "neutral"}
          href="/orders?group=printing"
        />
        <Stat
          label="Waiting in queue"
          value={formatCount(printing.waitingInQueue)}
          hint="Jobs not yet printing"
          href="/orders"
        />
        <Stat
          label="Completed"
          value={formatCount(orders.completedInPeriod)}
          tone="good"
          hint={period}
          href="/orders?group=completed"
        />
        <Stat
          label="Failed jobs"
          value={formatCount(printing.jobsFailedInPeriod)}
          tone={printing.jobsFailedInPeriod > 0 ? "danger" : "neutral"}
          hint={period}
          href="/orders?group=failed"
        />
        <Stat
          label="Net revenue today"
          value={formatMoney(revenue.netTodayMinor, revenue.currency)}
          tone="good"
          hint={`Gross ${formatMoney(revenue.grossTodayMinor, revenue.currency)}`}
        />
        <Stat
          label="Net revenue"
          value={formatMoney(revenue.netPeriodMinor, revenue.currency)}
          hint={`${period}, ${formatCount(revenue.paidOrdersInPeriod)} paid orders`}
        />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Revenue" aside={revenue.currency} id="revenue" className="lg:col-span-2">
          <DataTable
            caption={`Revenue in ${revenue.currency}: gross, refunded and net`}
            head={[
              "",
              { label: "Gross", align: "right" },
              { label: "Refunded", align: "right" },
              { label: "Net", align: "right" },
            ]}
          >
            {revenueRows(revenue).map((row) => (
              <tr key={row.period}>
                <th scope="row" className="px-4 py-2 font-medium whitespace-nowrap">
                  {row.period}
                </th>
                <td className="num px-4 py-2 text-right whitespace-nowrap">
                  {formatMoney(row.grossMinor, revenue.currency)}
                </td>
                <td className="num px-4 py-2 text-right whitespace-nowrap">
                  {formatMoney(row.refundedMinor, revenue.currency)}
                </td>
                <td className="num px-4 py-2 text-right font-semibold whitespace-nowrap">
                  {formatMoney(row.netMinor, revenue.currency)}
                </td>
              </tr>
            ))}
          </DataTable>
          <p className="mt-3 text-xs text-muted">
            Gross is every payment received; refunded is refunds that have completed; net is the
            difference. Amounts are in {revenue.currency} only and are never mixed with another
            currency.
          </p>
        </Panel>

        <Panel
          title={`Orders, ${period}`}
          aside={`${formatCount(orders.inPeriod)} total`}
          id="orders-by-group"
        >
          <BarList ariaLabel={`Orders by group, ${period}`} rows={orderGroupRows(orders.byGroup)} />
          {Object.keys(orders.byStatus).length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-medium">By exact status</summary>
              <div className="mt-2">
                <BarList
                  ariaLabel={`Orders by status, ${period}`}
                  rows={Object.entries(orders.byStatus)
                    .sort(([, a], [, b]) => b - a)
                    .map(([status, value]) => ({
                      label: humanizeEnum(status),
                      value,
                      tone: "neutral" as const,
                    }))}
                />
              </div>
            </details>
          )}
        </Panel>

        <Panel
          title="Printers"
          aside={
            <Link href="/dashboard/printers" className="underline">
              Printer status
            </Link>
          }
          id="printers"
        >
          {printers.total === 0 ? (
            <EmptyState title="No printers registered">
              Register a printer to start receiving print jobs.
            </EmptyState>
          ) : (
            <>
              <StatGrid>
                <Stat label="Online" value={formatCount(printers.online)} tone="good" />
                <Stat
                  label="Offline"
                  value={formatCount(printers.offline)}
                  tone={printers.offline > 0 ? "danger" : "neutral"}
                />
                <Stat label="Other" value={formatCount(printers.other)} />
              </StatGrid>
              <p className="mt-3 text-xs text-muted">
                {Object.entries(printers.byStatus)
                  .map(([status, count]) => `${humanizeEnum(status)} ${count}`)
                  .join(" · ")}
              </p>
            </>
          )}
        </Panel>

        <Panel
          title="Inventory"
          aside={
            <Link href="/inventory" className="underline">
              Open inventory
            </Link>
          }
          id="inventory"
        >
          {!inventory.trackingEnabled ? (
            <p className="text-muted">
              Paper stock tracking is switched off for this business, so stock levels and low-stock
              alerts are not being kept.
            </p>
          ) : (
            <StatGrid>
              <Stat label="Stock lines" value={formatCount(inventory.activeItems)} />
              <Stat
                label="Low stock"
                value={formatCount(inventory.lowStockCount)}
                tone={inventory.lowStockCount > 0 ? "caution" : "neutral"}
              />
              <Stat
                label="Out of stock"
                value={formatCount(inventory.outOfStockCount)}
                tone={inventory.outOfStockCount > 0 ? "danger" : "neutral"}
              />
              <Stat
                label="Open alerts"
                value={formatCount(inventory.openAlertCount)}
                tone={inventory.openAlertCount > 0 ? "caution" : "neutral"}
              />
            </StatGrid>
          )}
        </Panel>

        <Panel title={`Printing volume, ${period}`} id="volume">
          <StatGrid>
            <Stat label="Jobs printed" value={formatCount(printing.jobsPrintedInPeriod)} />
            <Stat
              label="Pages printed"
              value={formatCount(printing.pagesPrintedInPeriod)}
              hint="Pages x copies"
            />
            <Stat
              label="Jobs failed"
              value={formatCount(printing.jobsFailedInPeriod)}
              tone={printing.jobsFailedInPeriod > 0 ? "danger" : "neutral"}
            />
          </StatGrid>
        </Panel>
      </div>
    </div>
  );
}
