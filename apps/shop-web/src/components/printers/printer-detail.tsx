"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { PrinterResponse, UpdatePrinterInput } from "@print-automated/api-client";
import { Permission } from "@print-automated/types";
import { FormDialog } from "@/components/modal";
import { useActionRunner } from "@/components/orders/use-action-runner";
import { CapabilityToggles } from "@/components/printers/printers-screen";
import { usePrinterRows } from "@/components/printers/use-printer-rows";
import { RequirePermission, ResourceBoundary } from "@/components/resource-boundary";
import {
  Button,
  LiveStatus,
  Meter,
  PageHeader,
  Panel,
  Pill,
  Stat,
  StatGrid,
} from "@/components/ui";
import { getApi } from "@/lib/api";
import { formatAge, formatCount, formatDateTime, humanizeEnum } from "@/lib/format";
import { printerStatusTone } from "@/lib/job-status";
import {
  PERIOD_LABELS,
  effectiveStatus,
  parsePageLimit,
  periodWord,
  supportedCapabilities,
  usageStanding,
  type PrinterRow,
} from "@/lib/printers-view";
import type { ActionOutcome } from "@/components/orders/use-action-runner";

const FIELD = "rounded-md border border-line bg-panel px-2 py-1.5 text-sm";

interface Runner {
  busy: boolean;
  error: string | null;
  run: (action: () => Promise<unknown>) => Promise<ActionOutcome>;
}

/** PRD 109: one printer: its state and queue, profile, capabilities, page
 * limits with usage, enable/disable, and removal. There is no
 * "get printer" endpoint, so it is read from the printer list (a
 * backend carry-forward); a printer that is not in the list (removed, or
 * another business's) reads as not found. */
export function PrinterDetail({ printerId }: { printerId: string }): ReactNode {
  return (
    <RequirePermission permission={Permission.MANAGE_PRINTERS} what="printers">
      <PrinterDetailBody printerId={printerId} />
    </RequirePermission>
  );
}

function PrinterDetailBody({ printerId }: { printerId: string }): ReactNode {
  const { state } = usePrinterRows();
  const runner = useActionRunner(state.reload);
  const row = state.data?.find((entry) => entry.printer.id === printerId) ?? null;

  return (
    <>
      <p className="mb-3 text-sm">
        <Link href="/printers" className="underline underline-offset-2">
          &larr; Printers
        </Link>
      </p>
      <PageHeader
        title={row?.printer.name ?? "Printer"}
        actions={
          <LiveStatus
            lastUpdated={state.lastUpdated}
            refreshing={state.refreshing}
            onRefresh={state.reload}
          />
        }
      />
      <ResourceBoundary state={state} what="this printer">
        {() =>
          row === null ? (
            <Panel>
              <p className="font-semibold">Printer not found</p>
              <p className="text-muted">
                It may have been removed, or it belongs to another business. Go back to the list.
              </p>
            </Panel>
          ) : (
            <PrinterBody row={row} runner={runner} />
          )
        }
      </ResourceBoundary>
    </>
  );
}

function PrinterBody({ row, runner }: { row: PrinterRow; runner: Runner }): ReactNode {
  const { printer, live } = row;
  const status = effectiveStatus(row);
  const disabled = printer.status === "DISABLED";
  const { standing, fraction } = usageStanding(printer);

  return (
    <div className="grid gap-4">
      {runner.error !== null && (
        <p
          role="alert"
          className="rounded-md border border-danger/50 bg-danger-soft px-3 py-2 text-danger-fg"
        >
          {runner.error}
        </p>
      )}

      <StatGrid>
        <Stat
          label="Status"
          value={humanizeEnum(status.label)}
          tone={printerStatusTone(status.label, status.offline)}
          hint={
            live?.agent
              ? `Agent seen ${formatAge(live.agent.lastSeenAt)}`
              : live
                ? "No agent paired"
                : undefined
          }
        />
        {live !== null && (
          <>
            <Stat
              label="Queue"
              value={`${formatCount(live.queue.jobs)} jobs`}
              hint={`${formatCount(live.queue.pages)} pages`}
            />
            <Stat
              label="Failed, 24 h"
              value={formatCount(live.errors.failedJobs24h)}
              tone={live.errors.failedJobs24h > 0 ? "danger" : "neutral"}
              hint={
                live.errors.lastFailureReason
                  ? `Last: ${humanizeEnum(live.errors.lastFailureReason)}`
                  : undefined
              }
            />
          </>
        )}
        <Stat
          label={`Pages this ${periodWord(printer.pageLimitPeriod)}`}
          value={formatCount(printer.pagesUsedInPeriod)}
          hint={
            printer.remainingAllowance !== null
              ? `${formatCount(printer.remainingAllowance)} remaining`
              : "No limit enforced"
          }
        />
      </StatGrid>

      {live?.currentJob != null && (
        <Panel title="Current job" id="current">
          <Link
            href={`/orders/${encodeURIComponent(live.currentJob.orderId)}?job=${encodeURIComponent(live.currentJob.id)}`}
            className="num font-semibold underline"
          >
            {live.currentJob.publicOrderNumber}
          </Link>{" "}
          <Pill tone="accent">{humanizeEnum(live.currentJob.status)}</Pill>
        </Panel>
      )}
      {live?.maintenanceStatus != null && (
        <Panel title="Maintenance" tone="caution">
          {live.maintenanceStatus}
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <ProfileForm key={`name:${printer.name}`} printer={printer} runner={runner} />
        <CapabilitiesForm
          key={`caps:${JSON.stringify(printer.capabilities)}`}
          printer={printer}
          runner={runner}
        />
        <LimitForm
          key={`limit:${printer.pageLimit}:${printer.pageLimitEnabled}:${printer.pageLimitPeriod}`}
          printer={printer}
          runner={runner}
          fraction={fraction}
          standing={standing}
        />
        <Panel title="Availability and rules" id="availability">
          <div className="grid gap-3 text-sm">
            <p>
              {disabled
                ? "This printer is disabled: no job is sent to it until it is enabled again."
                : "Disabling stops new jobs going to this printer. Jobs already queued on it are re-evaluated."}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={runner.busy}
                onClick={() =>
                  void runner.run(() => getApi().printers.update(printer.id, { enabled: disabled }))
                }
              >
                {disabled ? "Enable printer" : "Disable printer"}
              </Button>
              <RemovePrinter printer={printer} runner={runner} />
            </div>
            <p className="text-xs text-muted">
              Which printer new jobs prefer or avoid is set in{" "}
              <Link href="/settings" className="underline">
                Settings, printer rules
              </Link>
              .
            </p>
            <p className="text-xs text-muted">
              Added {formatDateTime(printer.createdAt)}. Capabilities:{" "}
              {supportedCapabilities(printer.capabilities).join(", ") || "not set"}.
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}

async function save(
  runner: Runner,
  printerId: string,
  input: UpdatePrinterInput,
): Promise<ActionOutcome> {
  return runner.run(() => getApi().printers.update(printerId, input));
}

function ProfileForm({ printer, runner }: { printer: PrinterResponse; runner: Runner }): ReactNode {
  const [name, setName] = useState(printer.name);
  const changed = name.trim() !== printer.name && name.trim() !== "";
  return (
    <Panel title="Profile" id="profile">
      <form
        className="grid gap-3 text-sm"
        onSubmit={(event) => {
          event.preventDefault();
          void save(runner, printer.id, { name: name.trim() });
        }}
      >
        <label className="grid gap-1 font-medium">
          Name
          <input
            value={name}
            maxLength={200}
            onChange={(event) => setName(event.target.value)}
            className={`${FIELD} font-normal`}
          />
        </label>
        <div>
          <button
            type="submit"
            disabled={runner.busy || !changed}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            Save name
          </button>
        </div>
      </form>
    </Panel>
  );
}

function CapabilitiesForm({
  printer,
  runner,
}: {
  printer: PrinterResponse;
  runner: Runner;
}): ReactNode {
  const initial = printer.capabilities ?? { color: false, duplex: false, a4: true, a3: false };
  const [caps, setCaps] = useState(initial);
  const changed = JSON.stringify(caps) !== JSON.stringify(initial);
  return (
    <Panel title="Capabilities" id="capabilities">
      <form
        className="grid gap-3 text-sm"
        onSubmit={(event) => {
          event.preventDefault();
          void save(runner, printer.id, { capabilities: caps });
        }}
      >
        <CapabilityToggles value={caps} onChange={setCaps} />
        <p className="text-xs text-muted">
          Jobs are only allocated to printers that support their paper size, colour and sides.
        </p>
        <div>
          <button
            type="submit"
            disabled={runner.busy || !changed}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            Save capabilities
          </button>
        </div>
      </form>
    </Panel>
  );
}

function LimitForm({
  printer,
  runner,
  fraction,
  standing,
}: {
  printer: PrinterResponse;
  runner: Runner;
  fraction: number | null;
  standing: string;
}): ReactNode {
  const [limit, setLimit] = useState(printer.pageLimit === null ? "" : String(printer.pageLimit));
  const [enabled, setEnabled] = useState(printer.pageLimitEnabled);
  const [period, setPeriod] = useState(printer.pageLimitPeriod);
  const parsed = parsePageLimit(limit);
  const invalid = parsed === undefined;
  const changed =
    parsed !== undefined &&
    (parsed !== printer.pageLimit ||
      enabled !== printer.pageLimitEnabled ||
      period !== printer.pageLimitPeriod);

  return (
    <Panel title="Page limit" id="limit">
      <form
        className="grid gap-3 text-sm"
        onSubmit={(event) => {
          event.preventDefault();
          if (parsed === undefined) {
            return;
          }
          void save(runner, printer.id, {
            pageLimit: parsed,
            pageLimitEnabled: enabled && parsed !== null,
            pageLimitPeriod: period,
          });
        }}
      >
        {fraction !== null && printer.pageLimit !== null && (
          <div>
            <Meter
              value={printer.pagesUsedInPeriod}
              max={printer.pageLimit}
              label="Page allowance used"
              tone={standing === "reached" ? "danger" : standing === "low" ? "caution" : "accent"}
            />
            <p className="mt-1 text-xs text-muted">
              <span className="num">{formatCount(printer.pagesUsedInPeriod)}</span> of{" "}
              <span className="num">{formatCount(printer.pageLimit)}</span> pages used this{" "}
              {PERIOD_LABELS[printer.pageLimitPeriod]}.
            </p>
          </div>
        )}
        <label className="flex items-center gap-2 font-medium">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          Enforce the limit
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 font-medium">
            Pages allowed
            <input
              inputMode="numeric"
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
              aria-invalid={invalid}
              placeholder="No limit"
              className={`${FIELD} num font-normal`}
            />
            {invalid && (
              <span className="text-xs text-danger-fg">Enter a whole number, or leave blank.</span>
            )}
          </label>
          <label className="grid gap-1 font-medium">
            Per
            <select
              value={period}
              onChange={(event) => setPeriod(event.target.value as typeof period)}
              className={`${FIELD} font-normal`}
            >
              <option value="DAILY">Day</option>
              <option value="WEEKLY">Week (from Monday, UTC)</option>
              <option value="MONTHLY">Month (UTC)</option>
            </select>
          </label>
        </div>
        <p className="text-xs text-muted">
          A soft cap: completed pages count, so jobs already sent can slightly overshoot. Manual
          assignment ignores the limit. Changing the period starts a fresh allowance.
        </p>
        <div>
          <button
            type="submit"
            disabled={runner.busy || !changed}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            Save page limit
          </button>
        </div>
      </form>
    </Panel>
  );
}

function RemovePrinter({
  printer,
  runner,
}: {
  printer: PrinterResponse;
  runner: Runner;
}): ReactNode {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button disabled={runner.busy} onClick={() => setOpen(true)}>
        Remove printer
      </Button>
      {open && (
        <FormDialog
          title={`Remove ${printer.name}`}
          submitLabel="Remove printer"
          submitTone="danger"
          busy={runner.busy}
          error={runner.error}
          onCancel={() => setOpen(false)}
          onSubmit={() =>
            void runner
              .run(() => getApi().printers.remove(printer.id))
              .then((outcome) => {
                if (outcome === "ok") {
                  router.push("/printers");
                }
              })
          }
        >
          <p>
            This removes the printer from the business. It cannot be removed while it has an active
            job. To just stop using it for now, disable it instead.
          </p>
        </FormDialog>
      )}
    </>
  );
}
