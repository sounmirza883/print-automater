"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Permission } from "@print-automated/types";
import type { DashboardPrinter, PrinterDashboardResponse } from "@print-automated/types";
import { RequirePermission, ResourceBoundary } from "@/components/resource-boundary";
import { useSession } from "@/components/session-provider";
import {
  DataTable,
  EmptyState,
  LiveStatus,
  Meter,
  PageHeader,
  Panel,
  Pill,
  Stat,
  StatGrid,
} from "@/components/ui";
import {
  pageAllowanceFraction,
  pageLimitStanding,
  paperNeedingRestock,
  summarizePrinters,
} from "@/lib/dashboard-view";
import { getApi } from "@/lib/api";
import { formatAge, formatCount, humanizeEnum } from "@/lib/format";
import { printerStatusTone } from "@/lib/job-status";
import { useLiveDashboard } from "@/lib/use-live-dashboard";
import { useResource } from "@/lib/use-resource";

const POLL_MS = 15_000;

const PERIOD_UNIT: Record<string, string> = { DAILY: "day", WEEKLY: "week", MONTHLY: "month" };

/** PRD 41: for each printer its state, what it is printing, its queue,
 * pages printed against its limit, errors and maintenance; plus the paper
 * on hand. "Offline" is the API's derived flag (status OFFLINE, or the
 * agent silent past the offline-sweep threshold), so a printer whose
 * agent died shows offline even before the sweep has flipped its row. */
export function PrinterDashboard(): ReactNode {
  return (
    <RequirePermission permission={Permission.VIEW_PRINTER_DASHBOARD} what="the printer dashboard">
      <PrinterDashboardBody />
    </RequirePermission>
  );
}

function PrinterDashboardBody(): ReactNode {
  const { business } = useSession();
  const shopId = business?.id ?? "";
  const state = useResource(() => getApi().dashboard.printers(shopId), [shopId], {
    intervalMs: POLL_MS,
    enabled: shopId !== "",
  });
  useLiveDashboard(shopId === "" ? undefined : shopId, state.reload);

  return (
    <>
      <PageHeader
        title="Printers"
        subtitle="Status, queue and page allowance for every printer"
        actions={
          <LiveStatus
            lastUpdated={state.lastUpdated}
            refreshing={state.refreshing}
            onRefresh={state.reload}
          />
        }
      />
      <ResourceBoundary state={state} what="the printer dashboard">
        {(data) => <PrinterDashboardView data={data} />}
      </ResourceBoundary>
    </>
  );
}

function PrinterCard({ printer }: { printer: DashboardPrinter }): ReactNode {
  const standing = pageLimitStanding(printer);
  const fraction = pageAllowanceFraction(printer);
  const { pageLimit, errors } = printer;
  const statusTone = printerStatusTone(printer.status, printer.offline);

  return (
    <li>
      <Panel
        className="h-full"
        tone={printer.offline || printer.status === "ERROR" ? "danger" : "neutral"}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate font-semibold">{printer.name}</h3>
            <p className="text-xs text-muted">
              {printer.agent === null
                ? "No agent paired"
                : `Agent seen ${formatAge(printer.agent.lastSeenAt)}`}
            </p>
          </div>
          <Pill tone={statusTone}>
            {printer.offline ? "Offline" : humanizeEnum(printer.status)}
          </Pill>
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div className="col-span-2">
            <dt className="text-xs text-muted">Current job</dt>
            <dd>
              {printer.currentJob === null ? (
                <span className="text-muted">Idle</span>
              ) : (
                <Link
                  href={`/orders/${encodeURIComponent(printer.currentJob.orderId)}?job=${encodeURIComponent(printer.currentJob.id)}`}
                  className="num font-medium underline-offset-2 hover:underline"
                >
                  {printer.currentJob.publicOrderNumber}{" "}
                  <span className="font-sans text-xs text-muted">
                    {humanizeEnum(printer.currentJob.status)}
                  </span>
                </Link>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Queue</dt>
            <dd className="num">
              {formatCount(printer.queue.jobs)} jobs / {formatCount(printer.queue.pages)} pp
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Maintenance</dt>
            <dd>{printer.maintenanceStatus ?? <span className="text-muted">None</span>}</dd>
          </div>
        </dl>

        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="text-muted">
              Pages this {PERIOD_UNIT[pageLimit.period] ?? "period"}
            </span>
            <span className="num">
              {formatCount(pageLimit.pagesUsed)}
              {pageLimit.enabled &&
                pageLimit.limit !== null &&
                ` / ${formatCount(pageLimit.limit)}`}
            </span>
          </div>
          {fraction !== null && pageLimit.limit !== null ? (
            <>
              <Meter
                value={pageLimit.pagesUsed}
                max={pageLimit.limit}
                label={`${printer.name} page allowance used`}
                tone={standing === "reached" ? "danger" : standing === "low" ? "caution" : "accent"}
              />
              <p className="mt-1 text-xs">
                {standing === "reached" ? (
                  <span className="font-medium text-danger-fg">
                    Limit reached. New jobs skip this printer unless assigned by hand.
                  </span>
                ) : (
                  <span className="text-muted">
                    <span className="num">{formatCount(pageLimit.remaining ?? 0)}</span> pages
                    remaining
                  </span>
                )}
              </p>
            </>
          ) : (
            <p className="text-xs text-muted">No page limit enforced.</p>
          )}
        </div>

        <p
          className={`mt-3 text-xs ${errors.failedJobs24h > 0 ? "font-medium text-danger-fg" : "text-muted"}`}
        >
          {errors.failedJobs24h === 0
            ? "No failed jobs in the last 24 hours."
            : `${formatCount(errors.failedJobs24h)} failed job${errors.failedJobs24h === 1 ? "" : "s"} in the last 24 hours${
                errors.lastFailureReason !== null
                  ? ` (last: ${humanizeEnum(errors.lastFailureReason)})`
                  : ""
              }.`}
        </p>
      </Panel>
    </li>
  );
}

export function PrinterDashboardView({ data }: { data: PrinterDashboardResponse }): ReactNode {
  const summary = summarizePrinters(data.items);
  const restock = paperNeedingRestock(data.paper);

  return (
    <div className="grid gap-4">
      <StatGrid>
        <Stat label="Printers" value={formatCount(data.total)} />
        <Stat label="Online" value={formatCount(summary.online)} tone="good" />
        <Stat
          label="Offline"
          value={formatCount(summary.offline)}
          tone={summary.offline > 0 ? "danger" : "neutral"}
        />
        <Stat
          label="Needs help"
          value={formatCount(summary.needsHelp)}
          tone={summary.needsHelp > 0 ? "caution" : "neutral"}
          hint="Error or maintenance"
        />
      </StatGrid>

      {data.items.length === 0 ? (
        <EmptyState title="No printers registered">
          Register a printer to start receiving print jobs.
        </EmptyState>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {data.items.map((printer) => (
            <PrinterCard key={printer.id} printer={printer} />
          ))}
        </ul>
      )}

      <Panel
        title="Paper on hand"
        id="paper"
        tone={restock.length > 0 ? "caution" : "neutral"}
        aside={
          <Link href="/inventory" className="underline">
            Open inventory
          </Link>
        }
      >
        {!data.paper.trackingEnabled ? (
          <p className="text-muted">
            Paper stock tracking is switched off for this business, so paper availability is not
            being kept. Turn it on in Settings to have jobs wait for paper automatically.
          </p>
        ) : data.paper.bySize.length === 0 ? (
          <p className="text-muted">No paper stock lines have been added yet.</p>
        ) : (
          <>
            {restock.length > 0 && (
              <p role="status" className="mb-3 font-medium text-caution-fg">
                Restock soon: {restock.map((row) => row.paperSize).join(", ")}. Jobs needing that
                paper will wait as &ldquo;Out of paper&rdquo; once it runs out.
              </p>
            )}
            <DataTable
              caption="Paper on hand by size"
              head={["Paper size", "On hand", "Low lines"]}
            >
              {data.paper.bySize.map((row) => (
                <tr key={row.paperSize}>
                  <th scope="row" className="px-4 py-2 font-medium">
                    {humanizeEnum(row.paperSize)}
                  </th>
                  <td className="num px-4 py-2">{formatCount(row.quantity)}</td>
                  <td className="px-4 py-2">
                    {row.quantity <= 0 ? (
                      <Pill tone="danger">Out of stock</Pill>
                    ) : row.lowStockItems > 0 ? (
                      <Pill tone="caution">{row.lowStockItems} low</Pill>
                    ) : (
                      <span className="text-muted">OK</span>
                    )}
                  </td>
                </tr>
              ))}
            </DataTable>
          </>
        )}
      </Panel>
    </div>
  );
}
