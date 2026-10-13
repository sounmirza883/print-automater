"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { ReportName } from "@print-automated/api-client";
import {
  Permission,
  type OperatorWorkloadReport,
  type OrdersReport,
  type PaperConsumptionReport,
  type PrinterUsageReport,
  type PrintingVolumeReport,
  type ReportGroupBy,
  type RevenueReport,
  type SupplierPurchasesReport,
} from "@print-automated/types";
import { INPUT } from "@/components/form-kit";
import { ColumnChart } from "@/components/reports/column-chart";
import { RequirePermission } from "@/components/resource-boundary";
import { useSession } from "@/components/session-provider";
import {
  BarList,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  LoadingGrid,
  PageHeader,
  Panel,
  StaleBanner,
  Stat,
  StatGrid,
} from "@/components/ui";
import { getApi } from "@/lib/api";
import { errorMessageFor } from "@/lib/error-copy";
import {
  formatCompact,
  formatCompactMoney,
  formatCount,
  formatMoney,
  humanizeEnum,
} from "@/lib/format";
import {
  RANGE_PRESETS,
  REPORTS,
  apiParams,
  bucketLabel,
  csvFileName,
  customRangeProblem,
  defaultGroupBy,
  formatDuration,
  parseReportsQuery,
  presetDates,
  rangeLabel,
  reportDefinition,
  reportsSearch,
  type RangePreset,
  type ReportsQuery,
} from "@/lib/reports-view";
import { useResource } from "@/lib/use-resource";

export type Loaded =
  | { name: "orders"; data: OrdersReport }
  | { name: "revenue"; data: RevenueReport }
  | { name: "printing-volume"; data: PrintingVolumeReport }
  | { name: "printers"; data: PrinterUsageReport }
  | { name: "operator-workload"; data: OperatorWorkloadReport }
  | { name: "paper-consumption"; data: PaperConsumptionReport }
  | { name: "supplier-purchases"; data: SupplierPurchasesReport };

async function loadReport(
  name: ReportName,
  shopId: string,
  params: ReturnType<typeof apiParams>,
): Promise<Loaded> {
  const reports = getApi().reports;
  switch (name) {
    case "orders":
      return { name, data: await reports.orders(shopId, params) };
    case "revenue":
      return { name, data: await reports.revenue(shopId, params) };
    case "printing-volume":
      return { name, data: await reports.printingVolume(shopId, params) };
    case "printers":
      return { name, data: await reports.printers(shopId, params) };
    case "operator-workload":
      return { name, data: await reports.operatorWorkload(shopId, params) };
    case "paper-consumption":
      return { name, data: await reports.paperConsumption(shopId, params) };
    case "supplier-purchases":
      return { name, data: await reports.supplierPurchases(shopId, params) };
  }
}

const LABEL = "grid gap-1 text-xs font-medium text-muted";

/** PRD 72-74 (23.29). Owner and manager (VIEW_REPORTS). One filter row scopes everything
 * below it; the state lives in the URL, so a report can be bookmarked or shared. */
export function ReportsScreen(): ReactNode {
  return (
    <RequirePermission permission={Permission.VIEW_REPORTS} what="reports">
      <ReportsBody />
    </RequirePermission>
  );
}

function ReportsBody(): ReactNode {
  const { business } = useSession();
  const shopId = business?.id ?? "";
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = parseReportsQuery(searchParams);
  const definition = reportDefinition(query.report);
  const params = apiParams(query);

  const state = useResource(
    () => loadReport(query.report, shopId, params),
    [shopId, query.report, params.from, params.to, params.groupBy, params.currency ?? ""],
    { enabled: shopId !== "" },
  );
  // Refetch keeps the frame: while a new range loads, the same report's last render stays,
  // dimmed, instead of flashing a skeleton.
  // (Remembered during render, React's pattern for state derived from a changing value.)
  const [lastShown, setLastShown] = useState<Loaded | null>(null);
  if (state.data !== null && state.data !== lastShown) {
    setLastShown(state.data);
  }
  const view = state.data ?? (lastShown?.name === query.report ? lastShown : null);
  const holding = state.data === null && view !== null;

  function go(next: ReportsQuery): void {
    router.replace(`/reports?${reportsSearch(next)}`, { scroll: false });
  }

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle={`${business?.name ?? ""} · ${rangeLabel(query.from, query.to)} (UTC)`}
      />
      <nav aria-label="Reports" className="mb-4 flex flex-wrap gap-1.5">
        {REPORTS.map((report) => {
          const current = report.name === query.report;
          return (
            <button
              key={report.name}
              type="button"
              aria-current={current ? "page" : undefined}
              onClick={() => go({ ...query, report: report.name })}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                current
                  ? "border-ink bg-panel-2 text-ink"
                  : "border-line bg-panel hover:border-line-strong"
              }`}
            >
              {report.title}
            </button>
          );
        })}
      </nav>
      <Filters
        query={query}
        periodic={definition.periodic}
        view={view}
        shopId={shopId}
        onChange={go}
      />
      <p className="mb-4 text-sm text-muted">{definition.summary}</p>
      {view === null ? (
        state.error !== null ? (
          <ErrorState error={state.error} onRetry={state.reload} what={definition.title} />
        ) : (
          <LoadingGrid label={`Loading ${definition.title.toLowerCase()}`} />
        )
      ) : (
        <div
          aria-busy={state.refreshing || holding}
          className={`grid gap-4 transition-opacity [&>*]:min-w-0 ${holding ? "opacity-50" : ""}`}
        >
          <StaleBanner error={state.error} lastUpdated={state.lastUpdated} onRetry={state.reload} />
          <ReportView loaded={view} onCurrency={(currency) => go({ ...query, currency })} />
        </div>
      )}
    </>
  );
}

function Filters({
  query,
  periodic,
  view,
  shopId,
  onChange,
}: {
  query: ReportsQuery;
  periodic: boolean;
  view: Loaded | null;
  shopId: string;
  onChange: (next: ReportsQuery) => void;
}): ReactNode {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const otherCurrencies =
    view?.name === "revenue" ? view.data.totals.otherCurrencies.map((c) => c.currency) : [];

  function setRange(range: RangePreset): void {
    if (range === "custom") {
      onChange({ ...query, range });
      return;
    }
    onChange({
      ...query,
      range,
      ...presetDates(range, new Date()),
      groupBy: defaultGroupBy(range),
    });
  }

  async function download(): Promise<void> {
    if (downloading) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const blob = await getApi().reports.csv(query.report, shopId, apiParams(query));
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = csvFileName(query);
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (error) {
      setDownloadError(errorMessageFor(error));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="mb-3 grid gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <label className={LABEL}>
          Period
          <select
            value={query.range}
            onChange={(event) => setRange(event.target.value as RangePreset)}
            className={INPUT}
          >
            {RANGE_PRESETS.map((preset) => (
              <option key={preset.value} value={preset.value}>
                {preset.label}
              </option>
            ))}
            <option value="custom">Choose dates…</option>
          </select>
        </label>
        {query.range === "custom" && (
          // Keyed by the applied dates, so it starts from them again whenever they change.
          <CustomRange
            key={`${query.from}/${query.to}`}
            initialFrom={query.from}
            initialTo={query.to}
            onApply={(from, to) => onChange({ ...query, from, to })}
          />
        )}
        {periodic && (
          <label className={LABEL}>
            Group by
            <select
              value={query.groupBy}
              onChange={(event) =>
                onChange({ ...query, groupBy: event.target.value as ReportGroupBy })
              }
              className={INPUT}
            >
              <option value="day">Day</option>
              <option value="week">Week (from Monday)</option>
              <option value="month">Month</option>
            </select>
          </label>
        )}
        {(otherCurrencies.length > 0 || query.currency !== "") && view !== null && (
          <label className={LABEL}>
            Currency
            <select
              value={query.currency}
              onChange={(event) => onChange({ ...query, currency: event.target.value })}
              className={INPUT}
            >
              <option value="">
                Main ({query.currency === "" ? view.data.currency : "default"})
              </option>
              {[...new Set([query.currency, ...otherCurrencies])]
                .filter((code) => code !== "")
                .map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
            </select>
          </label>
        )}
        <div className="ml-auto">
          <Button onClick={() => void download()} disabled={downloading || shopId === ""}>
            {downloading ? "Preparing…" : "Download CSV"}
          </Button>
        </div>
      </div>
      {downloadError !== null && (
        <p role="alert" className="text-xs text-danger-fg">
          {downloadError}
        </p>
      )}
    </div>
  );
}

export /** The custom from/to dates, applied together (one refetch, never a half-typed range). */
function CustomRange({
  initialFrom,
  initialTo,
  onApply,
}: {
  initialFrom: string;
  initialTo: string;
  onApply: (from: string, to: string) => void;
}): ReactNode {
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const problem = customRangeProblem(from, to);
  return (
    <form
      noValidate
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (problem === null) onApply(from, to);
      }}
    >
      <label className={LABEL}>
        From
        <input
          type="date"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
          className={INPUT}
        />
      </label>
      <label className={LABEL}>
        To
        <input
          type="date"
          value={to}
          onChange={(event) => setTo(event.target.value)}
          className={INPUT}
        />
      </label>
      <Button type="submit" disabled={problem !== null}>
        Apply
      </Button>
      {problem !== null && <p className="basis-full text-xs text-danger-fg">{problem}</p>}
    </form>
  );
}

export function ReportView({
  loaded,
  onCurrency,
}: {
  loaded: Loaded;
  onCurrency: (currency: string) => void;
}): ReactNode {
  switch (loaded.name) {
    case "orders":
      return <OrdersView report={loaded.data} />;
    case "revenue":
      return <RevenueView report={loaded.data} onCurrency={onCurrency} />;
    case "printing-volume":
      return <VolumeView report={loaded.data} />;
    case "printers":
      return <PrintersView report={loaded.data} />;
    case "operator-workload":
      return <WorkloadView report={loaded.data} />;
    case "paper-consumption":
      return <PaperView report={loaded.data} />;
    case "supplier-purchases":
      return <SuppliersView report={loaded.data} />;
  }
}

const PERIOD_WORD: Record<ReportGroupBy, string> = { day: "day", week: "week", month: "month" };

function per(groupBy: ReportGroupBy | null): string {
  return groupBy === null ? "" : ` per ${PERIOD_WORD[groupBy]}`;
}

function Cell({ children, right = false }: { children: ReactNode; right?: boolean }): ReactNode {
  return (
    <td className={`px-4 py-2 whitespace-nowrap ${right ? "num text-right" : ""}`}>{children}</td>
  );
}

function Truncated({ shown, what }: { shown: boolean; what: string }): ReactNode {
  return shown ? (
    <p className="text-xs text-muted">
      Only the first 200 {what} are listed. Narrow the period to see the rest.
    </p>
  ) : null;
}

function OrdersView({ report }: { report: OrdersReport }): ReactNode {
  const t = report.totals;
  const money = (minor: number) => formatMoney(minor, report.currency);
  return (
    <>
      <StatGrid>
        <Stat label="Orders placed" value={formatCount(t.total)} />
        <Stat label="Completed" value={formatCount(t.completed)} tone="good" />
        <Stat label="Still open" value={formatCount(t.open)} />
        <Stat
          label="Cancelled or rejected"
          value={formatCount(t.cancelled + t.rejected)}
          hint={`${formatCount(t.cancelled)} cancelled, ${formatCount(t.rejected)} rejected`}
        />
        <Stat label="Print failed" value={formatCount(t.printFailed)} tone="caution" />
        <Stat
          label="Paid value"
          value={money(t.paidValueMinor)}
          hint="Orders that were paid, before refunds"
        />
        <Stat
          label="Quoted value"
          value={money(t.quotedValueMinor)}
          hint="Every order's quote, whatever became of it"
        />
      </StatGrid>
      <Panel>
        <ColumnChart
          title={`Orders placed${per(report.groupBy)}`}
          data={report.rows.map((row) => ({
            label: bucketLabel(row.bucket, report.groupBy),
            value: row.total,
          }))}
          format={formatCount}
          formatTick={formatCompact}
        />
      </Panel>
      <Panel title="By period">
        <DataTable
          caption="Orders by period"
          head={[
            "Period",
            ...[
              "Placed",
              "Completed",
              "Open",
              "Cancelled",
              "Rejected",
              "Print failed",
              "Paid value",
              "Quoted value",
            ].map((label) => ({ label, align: "right" as const })),
          ]}
        >
          {report.rows.map((row) => (
            <tr key={row.bucket}>
              <Cell>{bucketLabel(row.bucket, report.groupBy)}</Cell>
              <Cell right>{formatCount(row.total)}</Cell>
              <Cell right>{formatCount(row.completed)}</Cell>
              <Cell right>{formatCount(row.open)}</Cell>
              <Cell right>{formatCount(row.cancelled)}</Cell>
              <Cell right>{formatCount(row.rejected)}</Cell>
              <Cell right>{formatCount(row.printFailed)}</Cell>
              <Cell right>{money(row.paidValueMinor)}</Cell>
              <Cell right>{money(row.quotedValueMinor)}</Cell>
            </tr>
          ))}
        </DataTable>
      </Panel>
    </>
  );
}

function RevenueView({
  report,
  onCurrency,
}: {
  report: RevenueReport;
  onCurrency: (currency: string) => void;
}): ReactNode {
  const t = report.totals;
  const money = (minor: number) => formatMoney(minor, report.currency);
  return (
    <>
      <StatGrid>
        <Stat
          label="Money taken"
          value={money(t.grossRevenueMinor)}
          hint={`${formatCount(t.paidOrders)} paid orders`}
        />
        <Stat
          label="Refunded"
          value={money(t.refundedMinor)}
          hint={`${formatCount(t.refundedOrders)} refunds completed`}
        />
        <Stat label="Net revenue" value={money(t.netRevenueMinor)} tone="good" />
      </StatGrid>
      {t.otherCurrencies.length > 0 && (
        <p role="note" className="rounded-md border border-line bg-panel px-3 py-2 text-sm">
          This period also had money in{" "}
          {t.otherCurrencies.map((other, index) => (
            <span key={other.currency}>
              {index > 0 && ", "}
              <button
                type="button"
                onClick={() => onCurrency(other.currency)}
                className="font-medium text-accent-fg underline underline-offset-2"
              >
                {other.currency} ({formatMoney(other.netRevenueMinor, other.currency)} net)
              </button>
            </span>
          ))}
          . Amounts in different currencies are never added together.
        </p>
      )}
      <Panel>
        <ColumnChart
          title={`Money taken${per(report.groupBy)}`}
          subtitle={`${report.currency}, dated by when each payment was made`}
          data={report.rows.map((row) => ({
            label: bucketLabel(row.bucket, report.groupBy),
            value: row.grossRevenueMinor,
          }))}
          format={money}
          formatTick={(minor) => formatCompactMoney(minor, report.currency)}
        />
      </Panel>
      <Panel title="By period">
        <DataTable
          caption="Revenue by period"
          head={[
            "Period",
            ...["Taken", "Paid orders", "Refunded", "Refunds", "Net"].map((label) => ({
              label,
              align: "right" as const,
            })),
          ]}
        >
          {report.rows.map((row) => (
            <tr key={row.bucket}>
              <Cell>{bucketLabel(row.bucket, report.groupBy)}</Cell>
              <Cell right>{money(row.grossRevenueMinor)}</Cell>
              <Cell right>{formatCount(row.paidOrders)}</Cell>
              <Cell right>{money(row.refundedMinor)}</Cell>
              <Cell right>{formatCount(row.refundedOrders)}</Cell>
              <Cell right>{money(row.netRevenueMinor)}</Cell>
            </tr>
          ))}
        </DataTable>
        <p className="mt-3 text-xs text-muted">
          Refunds count when they complete; a refund still pending or failed is not taken off. Net
          is money taken minus refunds completed.
        </p>
      </Panel>
    </>
  );
}

function VolumeView({ report }: { report: PrintingVolumeReport }): ReactNode {
  const t = report.totals;
  return (
    <>
      <StatGrid>
        <Stat label="Jobs printed" value={formatCount(t.jobsPrinted)} />
        <Stat label="Pages printed" value={formatCount(t.pagesPrinted)} hint="Pages × copies" />
        <Stat label="Colour pages" value={formatCount(t.colorPages)} />
        <Stat label="Black and white pages" value={formatCount(t.bwPages)} />
      </StatGrid>
      <Panel>
        <ColumnChart
          title={`Pages printed${per(report.groupBy)}`}
          data={report.rows.map((row) => ({
            label: bucketLabel(row.bucket, report.groupBy),
            value: row.pagesPrinted,
          }))}
          format={formatCount}
          formatTick={formatCompact}
        />
      </Panel>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Panel title="Pages by paper size">
          <BarList
            ariaLabel="Pages printed by paper size"
            rows={t.byPaperSize.map((size) => ({
              label: humanizeEnum(size.paperSize),
              value: size.pages,
            }))}
          />
        </Panel>
        <Panel title="By period">
          <DataTable
            caption="Printing volume by period"
            head={[
              "Period",
              ...["Jobs", "Pages", "Colour", "Black and white"].map((label) => ({
                label,
                align: "right" as const,
              })),
            ]}
          >
            {report.rows.map((row) => (
              <tr key={row.bucket}>
                <Cell>{bucketLabel(row.bucket, report.groupBy)}</Cell>
                <Cell right>{formatCount(row.jobsPrinted)}</Cell>
                <Cell right>{formatCount(row.pagesPrinted)}</Cell>
                <Cell right>{formatCount(row.colorPages)}</Cell>
                <Cell right>{formatCount(row.bwPages)}</Cell>
              </tr>
            ))}
          </DataTable>
        </Panel>
      </div>
    </>
  );
}

function allowance(limit: PrinterUsageReport["rows"][number]["pageLimit"]): string {
  if (!limit.enabled || limit.limit === null) return "No limit";
  const period = humanizeEnum(limit.period).toLowerCase();
  return `${formatCount(limit.remaining ?? 0)} of ${formatCount(limit.limit)} left (${period})`;
}

function PrintersView({ report }: { report: PrinterUsageReport }): ReactNode {
  const t = report.totals;
  return (
    <>
      <StatGrid>
        <Stat label="Jobs completed" value={formatCount(t.jobsCompleted)} tone="good" />
        <Stat label="Jobs failed" value={formatCount(t.jobsFailed)} tone="caution" />
        <Stat
          label="Outcome unknown"
          value={formatCount(t.jobsUnknown)}
          hint="Staff decide whether these printed"
        />
        <Stat label="Pages printed" value={formatCount(t.pagesPrinted)} />
      </StatGrid>
      {report.rows.length === 0 ? (
        <EmptyState title="No printers">This business has no printers yet.</EmptyState>
      ) : (
        <Panel title="Each printer">
          <DataTable
            caption="Printer usage"
            head={[
              "Printer",
              "Status",
              ...["Completed", "Failed", "Unknown", "Pages", "Average job"].map((label) => ({
                label,
                align: "right" as const,
              })),
              "Page allowance now",
            ]}
          >
            {report.rows.map((row) => (
              <tr key={row.printerId}>
                <Cell>{row.name}</Cell>
                <Cell>{humanizeEnum(row.status)}</Cell>
                <Cell right>{formatCount(row.jobsCompleted)}</Cell>
                <Cell right>{formatCount(row.jobsFailed)}</Cell>
                <Cell right>{formatCount(row.jobsUnknown)}</Cell>
                <Cell right>{formatCount(row.pagesPrinted)}</Cell>
                <Cell right>{formatDuration(row.avgJobDurationSeconds)}</Cell>
                <Cell>{allowance(row.pageLimit)}</Cell>
              </tr>
            ))}
          </DataTable>
          <Truncated shown={report.truncated} what="printers" />
          <p className="mt-3 text-xs text-muted">
            Average job is from the printer agent picking the job up to it printing. The page
            allowance is the printer&apos;s current period, not the report period.
          </p>
        </Panel>
      )}
    </>
  );
}

/** PRD 74: descriptive only. Alphabetical (as the API returns it), no ranking, no chart that
 * would invite comparing people, and the API's own notice shown with it. */
function WorkloadView({ report }: { report: OperatorWorkloadReport }): ReactNode {
  const t = report.totals;
  return (
    <>
      <p role="note" className="rounded-md border border-line bg-panel px-3 py-2 text-sm">
        {t.notice}
      </p>
      <StatGrid>
        <Stat label="Jobs assigned" value={formatCount(t.jobsAssigned)} />
        <Stat label="Jobs completed" value={formatCount(t.jobsCompleted)} />
        <Stat label="Jobs failed" value={formatCount(t.jobsFailed)} />
        <Stat label="Assigned now" value={formatCount(t.currentAssignedJobs)} />
      </StatGrid>
      {report.rows.length === 0 ? (
        <EmptyState title="No operator activity">
          No jobs were assigned to operators in this period.
        </EmptyState>
      ) : (
        <Panel title="Operators (A to Z)">
          <DataTable
            caption="Operator workload, alphabetical"
            head={[
              "Operator",
              ...["Assigned", "Completed", "Failed", "Average completion", "Assigned now"].map(
                (label) => ({ label, align: "right" as const }),
              ),
            ]}
          >
            {report.rows.map((row) => (
              <tr key={row.operatorId}>
                <Cell>{row.name}</Cell>
                <Cell right>{formatCount(row.jobsAssigned)}</Cell>
                <Cell right>{formatCount(row.jobsCompleted)}</Cell>
                <Cell right>{formatCount(row.jobsFailed)}</Cell>
                <Cell right>{formatDuration(row.avgCompletionSeconds)}</Cell>
                <Cell right>{formatCount(row.currentAssignedJobs)}</Cell>
              </tr>
            ))}
          </DataTable>
          <Truncated shown={report.truncated} what="operators" />
        </Panel>
      )}
    </>
  );
}

function PaperView({ report }: { report: PaperConsumptionReport }): ReactNode {
  const t = report.totals;
  return (
    <>
      <StatGrid>
        <Stat label="Sheets used" value={formatCount(t.sheetsConsumed)} />
      </StatGrid>
      <Panel>
        <ColumnChart
          title={`Sheets used${per(report.groupBy)}`}
          data={t.series.map((point) => ({
            label: bucketLabel(point.bucket, report.groupBy),
            value: point.sheets,
          }))}
          format={formatCount}
          formatTick={formatCompact}
        />
      </Panel>
      {report.rows.length === 0 ? (
        <EmptyState title="No paper used">
          No stock was taken by printed jobs in this period (or stock tracking is off).
        </EmptyState>
      ) : (
        <Panel title="Each stock item">
          <DataTable
            caption="Paper used by stock item"
            head={[
              "Stock item",
              "Paper",
              ...["Sheets used", "Movements"].map((label) => ({
                label,
                align: "right" as const,
              })),
            ]}
          >
            {report.rows.map((row) => (
              <tr key={row.inventoryItemId}>
                <Cell>{row.name}</Cell>
                <Cell>
                  {[row.paperSize, row.paperType]
                    .filter((part): part is string => part !== null)
                    .map(humanizeEnum)
                    .join(" · ") || "—"}
                </Cell>
                <Cell right>{formatCount(row.sheetsConsumed)}</Cell>
                <Cell right>{formatCount(row.movements)}</Cell>
              </tr>
            ))}
          </DataTable>
          <Truncated shown={report.truncated} what="stock items" />
        </Panel>
      )}
    </>
  );
}

function SuppliersView({ report }: { report: SupplierPurchasesReport }): ReactNode {
  const t = report.totals;
  const money = (minor: number) => formatMoney(minor, report.currency);
  return (
    <>
      <StatGrid>
        <Stat label="Purchase orders" value={formatCount(t.purchaseOrders)} />
        <Stat label="Received" value={formatCount(t.received)} tone="good" />
        <Stat label="Cancelled" value={formatCount(t.cancelled)} />
        <Stat label="Cost" value={money(t.totalCostMinor)} hint="Orders not cancelled" />
      </StatGrid>
      <Panel>
        <ColumnChart
          title={`Purchase cost${per(report.groupBy)}`}
          subtitle={`${report.currency}, orders not cancelled`}
          data={t.series.map((point) => ({
            label: bucketLabel(point.bucket, report.groupBy),
            value: point.totalCostMinor,
          }))}
          format={money}
          formatTick={(minor) => formatCompactMoney(minor, report.currency)}
        />
      </Panel>
      {report.rows.length === 0 ? (
        <EmptyState title="No purchases">No purchase orders were raised in this period.</EmptyState>
      ) : (
        <Panel title="Each supplier">
          <DataTable
            caption="Purchases by supplier"
            head={[
              "Supplier",
              ...["Purchase orders", "Received", "Cancelled", "Cost"].map((label) => ({
                label,
                align: "right" as const,
              })),
            ]}
          >
            {report.rows.map((row) => (
              <tr key={row.supplierId}>
                <Cell>{row.name}</Cell>
                <Cell right>{formatCount(row.purchaseOrders)}</Cell>
                <Cell right>{formatCount(row.received)}</Cell>
                <Cell right>{formatCount(row.cancelled)}</Cell>
                <Cell right>{money(row.totalCostMinor)}</Cell>
              </tr>
            ))}
          </DataTable>
          <Truncated shown={report.truncated} what="suppliers" />
        </Panel>
      )}
    </>
  );
}
