"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { PaymentReportCurrency, PaymentReportResponse } from "@print-automated/types";
import { ErrorBanner, Field, INPUT, SelectField } from "@/components/form-kit";
import { useActionRunner } from "@/components/orders/use-action-runner";
import { ResourceBoundary } from "@/components/resource-boundary";
import { Button, DataTable, EmptyState, PageHeader, Panel, Stat } from "@/components/ui";
import { getApi } from "@/lib/api";
import { downloadBlob } from "@/lib/download-blob";
import { formatCount, formatMoney } from "@/lib/format";
import {
  RANGE_PRESETS,
  exportFileName,
  periodLabel,
  rangeForPreset,
  rangeFromInputs,
  rangeLabel,
  toInputDate,
  tzOffsetMinutes,
  type RangePreset,
} from "@/lib/report-range";
import { useResource } from "@/lib/use-resource";

const noop = (): void => undefined;

type GroupChoice = "auto" | "day" | "month";

function payments(count: number): string {
  return `${formatCount(count)} ${count === 1 ? "payment" : "payments"}`;
}

/** Platform admin: how much plan money was RECEIVED (approved payments) and NOT ACCEPTED
 * (rejected ones) over any period -- today, a month, a year, or custom dates -- with the same
 * data downloadable as CSV or Excel (one row per payment). Each payment counts on the day it
 * was decided, in the viewer's own time zone. Currencies are never added together. */
export function PaymentReportScreen(): ReactNode {
  const [now] = useState(() => new Date());
  const [preset, setPreset] = useState<RangePreset>("thisMonth");
  const firstOfMonth = rangeForPreset("thisMonth", now);
  const [customFrom, setCustomFrom] = useState(toInputDate(firstOfMonth.from));
  const [customTo, setCustomTo] = useState(toInputDate(now));
  const [group, setGroup] = useState<GroupChoice>("auto");
  const exporter = useActionRunner(noop);

  const custom = useMemo(() => rangeFromInputs(customFrom, customTo), [customFrom, customTo]);
  const range =
    preset === "custom" ? (custom.ok ? custom.range : null) : rangeForPreset(preset, now);
  const query =
    range === null
      ? null
      : {
          from: range.from.toISOString(),
          to: range.to.toISOString(),
          tzOffsetMinutes: tzOffsetMinutes(now),
          ...(group === "auto" ? {} : { groupBy: group }),
        };

  const report = useResource(
    () => getApi().paymentProofs.adminReport(query!),
    [JSON.stringify(query)],
    {
      enabled: query !== null,
    },
  );

  function download(format: "csv" | "xlsx"): void {
    if (query === null || range === null) {
      return;
    }
    void exporter.run(async () => {
      const blob = await getApi().paymentProofs.adminExportReport(query, format);
      downloadBlob(blob, exportFileName(range, format));
    });
  }

  return (
    <>
      <PageHeader
        title="Payment reports"
        subtitle="Money received (approved payments) and not accepted (rejected), for any period."
        actions={
          <>
            <Button onClick={() => download("csv")} disabled={query === null || exporter.busy}>
              Download CSV
            </Button>
            <Button
              variant="primary"
              onClick={() => download("xlsx")}
              disabled={query === null || exporter.busy}
            >
              {exporter.busy ? "Preparing…" : "Download Excel"}
            </Button>
          </>
        }
      />

      <Panel title="Period" className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-48">
            <SelectField
              label="Show"
              value={preset}
              onChange={(value) => setPreset(value as RangePreset)}
              options={RANGE_PRESETS.map((option) => ({ value: option.id, label: option.label }))}
            />
          </div>
          {preset === "custom" && (
            <>
              <Field label="From">
                <input
                  type="date"
                  value={customFrom}
                  max={customTo || undefined}
                  onChange={(event) => setCustomFrom(event.target.value)}
                  className={INPUT}
                />
              </Field>
              <Field label="To (included)">
                <input
                  type="date"
                  value={customTo}
                  min={customFrom || undefined}
                  onChange={(event) => setCustomTo(event.target.value)}
                  className={INPUT}
                />
              </Field>
            </>
          )}
          <div className="w-40">
            <SelectField
              label="Group by"
              value={group}
              onChange={(value) => setGroup(value as GroupChoice)}
              options={[
                { value: "auto", label: "Automatic" },
                { value: "day", label: "Day" },
                { value: "month", label: "Month" },
              ]}
            />
          </div>
        </div>
        {range !== null && <p className="mt-3 text-sm text-muted">{rangeLabel(range)}</p>}
        {!custom.ok && preset === "custom" && (
          <p role="alert" className="mt-3 text-sm text-danger-fg">
            {custom.error}
          </p>
        )}
        <div className="mt-3">
          <ErrorBanner message={exporter.error} />
        </div>
      </Panel>

      {query === null ? null : (
        <ResourceBoundary state={report} what="the report">
          {(data) => <ReportBody data={data} />}
        </ResourceBoundary>
      )}
    </>
  );
}

function ReportBody({ data }: { data: PaymentReportResponse }): ReactNode {
  if (data.currencies.length === 0) {
    return (
      <EmptyState title="No payments in this period">
        Nothing was approved, rejected or submitted between these dates.
      </EmptyState>
    );
  }
  return (
    <div className="grid gap-4">
      {data.currencies.map((block) => (
        <CurrencyBlock key={block.currency} block={block} groupBy={data.groupBy} />
      ))}
    </div>
  );
}

function CurrencyBlock({
  block,
  groupBy,
}: {
  block: PaymentReportCurrency;
  groupBy: "day" | "month";
}): ReactNode {
  const active = block.periods.filter((p) => p.receivedCount > 0 || p.rejectedCount > 0);
  return (
    <section aria-label={`${block.currency} payments`} className="grid gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          label={`Received (${block.currency})`}
          value={formatMoney(block.receivedMinor, block.currency)}
          hint={payments(block.receivedCount)}
          tone="good"
        />
        <Stat
          label="Not accepted"
          value={formatMoney(block.rejectedMinor, block.currency)}
          hint={payments(block.rejectedCount)}
          tone={block.rejectedCount > 0 ? "danger" : "neutral"}
        />
        <Stat
          label="Waiting for review"
          value={formatMoney(block.waitingMinor, block.currency)}
          hint={`${payments(block.waitingCount)} · not in the totals`}
          tone={block.waitingCount > 0 ? "caution" : "neutral"}
        />
      </div>

      <Panel title={groupBy === "month" ? "By month" : "By day"}>
        {active.length === 0 ? (
          <p className="text-sm text-muted">No payments were decided in this period.</p>
        ) : (
          <DataTable
            caption={`${block.currency} payments by ${groupBy}`}
            head={[
              "Period",
              { label: "Received", align: "right" },
              { label: "Payments", align: "right" },
              { label: "Not accepted", align: "right" },
              { label: "Rejected", align: "right" },
            ]}
          >
            {active.map((period) => (
              <tr key={period.period}>
                <td className="px-4 py-2 whitespace-nowrap">
                  {periodLabel(period.period, groupBy)}
                </td>
                <td className="num px-4 py-2 text-right">
                  {formatMoney(period.receivedMinor, block.currency)}
                </td>
                <td className="num px-4 py-2 text-right">{formatCount(period.receivedCount)}</td>
                <td className="num px-4 py-2 text-right">
                  {formatMoney(period.rejectedMinor, block.currency)}
                </td>
                <td className="num px-4 py-2 text-right">{formatCount(period.rejectedCount)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      {block.byPlan.length > 0 && (
        <Panel title="Received by plan">
          <DataTable
            caption={`${block.currency} received by plan`}
            head={[
              "Plan",
              { label: "Payments", align: "right" },
              { label: "Received", align: "right" },
            ]}
          >
            {block.byPlan.map((line) => (
              <tr key={line.planName}>
                <td className="px-4 py-2 font-medium">{line.planName}</td>
                <td className="num px-4 py-2 text-right">{formatCount(line.receivedCount)}</td>
                <td className="num px-4 py-2 text-right">
                  {formatMoney(line.receivedMinor, block.currency)}
                </td>
              </tr>
            ))}
          </DataTable>
        </Panel>
      )}
    </section>
  );
}
