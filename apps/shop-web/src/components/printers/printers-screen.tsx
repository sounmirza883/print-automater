"use client";

import Link from "next/link";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { PairingCode, RegisterPrinterInput } from "@print-automated/api-client";
import { Permission } from "@print-automated/types";
import { INPUT, SelectField } from "@/components/form-kit";
import { FormDialog } from "@/components/modal";
import { useActionRunner } from "@/components/orders/use-action-runner";
import { usePrinterRows } from "@/components/printers/use-printer-rows";
import { RequirePermission, ResourceBoundary } from "@/components/resource-boundary";
import { useSession } from "@/components/session-provider";
import { Button, EmptyState, LiveStatus, Meter, PageHeader, Pill } from "@/components/ui";
import { getApi } from "@/lib/api";
import { formatCount, formatDateTime, humanizeEnum } from "@/lib/format";
import { printerStatusTone } from "@/lib/job-status";
import {
  effectiveStatus,
  pairingBranchOptions,
  periodWord,
  supportedCapabilities,
  usageStanding,
  type PrinterRow,
} from "@/lib/printers-view";
import { resolveBranchChoice } from "@/lib/staff-view";

/** PRD 109 (fleet view): every printer with its state, queue, pages used
 * against its limit and what it can do; add a printer; open one to manage
 * it. Live queue/agent data appears for roles that may read the printer
 * dashboard; the profile list works for everyone who manages printers. */
export function PrintersScreen(): ReactNode {
  return (
    <RequirePermission permission={Permission.MANAGE_PRINTERS} what="printers">
      <PrintersBody />
    </RequirePermission>
  );
}

function PrintersBody(): ReactNode {
  const { business, showBranchColumn } = useSession();
  const { state, hasLiveData } = usePrinterRows();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [adding, setAdding] = useState(false);
  const [pairing, setPairing] = useState(false);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (state.data ?? []).filter((row) => {
      const matchesName = needle === "" || row.printer.name.toLowerCase().includes(needle);
      const matchesStatus = status === "" || effectiveStatus(row).label === status;
      return matchesName && matchesStatus;
    });
  }, [state.data, query, status]);

  return (
    <>
      <PageHeader
        title="Printers"
        subtitle={business?.name}
        actions={
          <>
            <LiveStatus
              lastUpdated={state.lastUpdated}
              refreshing={state.refreshing}
              onRefresh={state.reload}
            />
            <Button onClick={() => setAdding(true)}>Add printer</Button>
            <Button variant="primary" onClick={() => setPairing(true)}>
              Pair a computer
            </Button>
          </>
        }
      />
      <ResourceBoundary state={state} what="printers">
        {(all) => (
          <>
            {all.length > 0 && (
              <div className="mb-4 flex flex-wrap items-end gap-3">
                <label className="grid gap-1 text-xs font-medium text-muted">
                  Find a printer
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    className={`${INPUT} w-64`}
                  />
                </label>
                <label className="grid gap-1 text-xs font-medium text-muted">
                  Status
                  <select
                    value={status}
                    onChange={(event) => setStatus(event.target.value)}
                    className={INPUT}
                  >
                    <option value="">Any</option>
                    {[
                      "ONLINE",
                      "BUSY",
                      "OFFLINE",
                      "ERROR",
                      "MAINTENANCE",
                      "PAUSED",
                      "DISABLED",
                    ].map((value) => (
                      <option key={value} value={value}>
                        {humanizeEnum(value)}
                      </option>
                    ))}
                  </select>
                </label>
                {!hasLiveData && (
                  <p className="text-xs text-muted">
                    Live queue and agent details are shown to roles with the printer dashboard.
                  </p>
                )}
              </div>
            )}
            {all.length === 0 ? (
              <EmptyState
                title="No printers yet"
                action={
                  <Button variant="primary" onClick={() => setPairing(true)}>
                    Pair a computer
                  </Button>
                }
              >
                Pair the print agent on the shop computer and the printers it finds appear here.
              </EmptyState>
            ) : rows.length === 0 ? (
              <EmptyState title="No printer matches">Try a different name or status.</EmptyState>
            ) : (
              <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3" aria-label="Printers">
                {rows.map((row) => (
                  <PrinterCard key={row.printer.id} row={row} showBranch={showBranchColumn} />
                ))}
              </ul>
            )}
          </>
        )}
      </ResourceBoundary>
      {adding && business !== null && (
        <AddPrinterDialog
          shopId={business.id}
          onClose={() => setAdding(false)}
          onAdded={state.reload}
        />
      )}
      {pairing && business !== null && (
        <PairComputerDialog
          shopId={business.id}
          onClose={() => {
            setPairing(false);
            state.reload();
          }}
        />
      )}
    </>
  );
}

/** Where a new computer or printer will be, asked the way the staff invitation asks where a person
 * works: a business with one location has nothing to choose; a branch-bound person's is their own
 * branch (the server uses it); anyone who works at all branches must pick one, with nothing
 * pre-chosen. A computer sits at a single place, so "All branches" is never an option. */
function useBranchPlacement(): {
  /** Whether the person has to pick (and the select is shown). */
  mustChoose: boolean;
  /** A branch-bound person's own branch, named for them; null otherwise. */
  ownBranchName: string | null;
  options: Array<{ value: string; label: string }>;
  choice: string;
  setChoice: (value: string) => void;
  error: string | null;
  /** What to send as `branchId`: the pick, or undefined when the server knows the branch. */
  branchId: string | undefined;
} {
  const { business, branches, branchMode } = useSession();
  const options = pairingBranchOptions({ branchId: business?.branchId ?? null }, branches);
  const [chosen, setChosen] = useState("");
  const mustChoose = branchMode === "choice" && options.length > 1;
  const choice = resolveBranchChoice(options, chosen);
  return {
    mustChoose,
    ownBranchName: branchMode === "bound" ? (business?.branchName ?? null) : null,
    options,
    choice,
    setChoice: setChosen,
    error: mustChoose && choice === "" ? "Choose which branch this is at." : null,
    branchId: mustChoose ? choice : undefined,
  };
}

function BranchPlacementField({
  placement,
  touched,
  hint,
}: {
  placement: ReturnType<typeof useBranchPlacement>;
  touched: boolean;
  hint: string;
}): ReactNode {
  if (placement.mustChoose) {
    return (
      <SelectField
        label="Branch"
        value={placement.choice}
        onChange={placement.setChoice}
        options={placement.options}
        emptyLabel="Choose a branch"
        hint={hint}
        error={touched ? placement.error : null}
      />
    );
  }
  if (placement.ownBranchName !== null) {
    return (
      <p>
        Branch: <strong>{placement.ownBranchName}</strong>
      </p>
    );
  }
  return null;
}

/** Issues a one-time pairing code for the print agent on a shop computer. The code is only
 * issued on request (each one is audited), and shown until the dialog closes. It is issued for
 * one branch: the computer, and every printer it reports, belong to that branch. */
function PairComputerDialog({
  shopId,
  onClose,
}: {
  shopId: string;
  onClose: () => void;
}): ReactNode {
  const nothingToReload = useCallback(() => {}, []);
  const runner = useActionRunner(nothingToReload);
  const { branchMode } = useSession();
  const placement = useBranchPlacement();
  const [issued, setIssued] = useState<PairingCode | null>(null);
  const [touched, setTouched] = useState(false);
  return (
    <FormDialog
      title="Pair a computer"
      submitLabel={issued === null ? "Show a pairing code" : "Done"}
      busy={runner.busy}
      error={runner.error}
      onCancel={onClose}
      onSubmit={() => {
        if (issued !== null) {
          onClose();
          return;
        }
        setTouched(true);
        if (placement.error !== null) return;
        void runner.run(async () => {
          setIssued(await getApi().printers.issuePairingCode(shopId, placement.branchId));
        });
      }}
    >
      {issued === null ? (
        <BranchPlacementField
          placement={placement}
          touched={touched}
          hint="The computer and every printer it finds belong to this branch, and only this branch's jobs print on them."
        />
      ) : (
        branchMode !== "single" &&
        issued.branchName !== undefined && (
          <p>
            This code pairs a computer with <strong>{issued.branchName}</strong>.
          </p>
        )
      )}
      <ol className="grid list-decimal gap-1 pl-5">
        <li>Install the Print Automated agent on the computer the printers are connected to.</li>
        <li>
          Open its page: it opens after installing, or click its printer icon near the clock (the
          address is <span className="num">http://127.0.0.1:7171</span>).
        </li>
        <li>Enter the pairing code. The computer&rsquo;s printers then appear on this page.</li>
      </ol>
      {issued !== null && (
        <div className="grid gap-1 rounded-md border border-line bg-panel-2 px-4 py-3 text-center">
          <p className="text-xs font-medium text-muted">Pairing code</p>
          <p
            className="num select-all text-3xl font-semibold tracking-[0.3em]"
            aria-label={`Pairing code ${issued.code.split("").join(" ")}`}
          >
            {issued.code}
          </p>
          <p className="text-xs text-muted">
            Works once, until {formatDateTime(issued.expiresAt)}.
          </p>
        </div>
      )}
    </FormDialog>
  );
}

function PrinterCard({ row, showBranch }: { row: PrinterRow; showBranch: boolean }): ReactNode {
  const { printer, live } = row;
  const status = effectiveStatus(row);
  const { standing, fraction } = usageStanding(printer);
  const capabilities = supportedCapabilities(printer.capabilities);
  return (
    <li className="grid gap-3 rounded-lg border border-line bg-panel px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            href={`/printers/${encodeURIComponent(printer.id)}`}
            className="block truncate font-semibold underline-offset-2 hover:underline"
          >
            {printer.name}
          </Link>
          {showBranch && printer.branchName !== undefined && (
            <p className="truncate text-xs text-muted">Branch: {printer.branchName}</p>
          )}
        </div>
        <Pill tone={printerStatusTone(status.label, status.offline)}>
          {humanizeEnum(status.label)}
        </Pill>
      </div>
      <p className="text-xs text-muted">
        {capabilities.length > 0 ? capabilities.join(" · ") : "Capabilities not set"}
      </p>
      {live !== null && (
        <p className="text-sm">
          <span className="num">{formatCount(live.queue.jobs)}</span> queued (
          <span className="num">{formatCount(live.queue.pages)}</span> pp)
          {live.currentJob !== null && (
            <>
              {" "}
              &middot; printing{" "}
              <Link
                href={`/orders/${encodeURIComponent(live.currentJob.orderId)}?job=${encodeURIComponent(live.currentJob.id)}`}
                className="num underline"
              >
                {live.currentJob.publicOrderNumber}
              </Link>
            </>
          )}
        </p>
      )}
      <div>
        <div className="mb-1 flex justify-between text-xs">
          <span className="text-muted">Pages this {periodWord(printer.pageLimitPeriod)}</span>
          <span className="num">
            {formatCount(printer.pagesUsedInPeriod)}
            {printer.pageLimitEnabled &&
              printer.pageLimit !== null &&
              ` / ${formatCount(printer.pageLimit)}`}
          </span>
        </div>
        {fraction !== null && printer.pageLimit !== null ? (
          <Meter
            value={printer.pagesUsedInPeriod}
            max={printer.pageLimit}
            label={`${printer.name} page allowance used`}
            tone={standing === "reached" ? "danger" : standing === "low" ? "caution" : "accent"}
          />
        ) : (
          <p className="text-xs text-muted">No page limit enforced.</p>
        )}
      </div>
      {live !== null && live.errors.failedJobs24h > 0 && (
        <p className="text-xs font-medium text-danger-fg">
          {live.errors.failedJobs24h} failed job{live.errors.failedJobs24h === 1 ? "" : "s"} in the
          last 24 hours
        </p>
      )}
    </li>
  );
}

function AddPrinterDialog({
  shopId,
  onClose,
  onAdded,
}: {
  shopId: string;
  onClose: () => void;
  onAdded: () => void;
}): ReactNode {
  const runner = useActionRunner(onAdded);
  const placement = useBranchPlacement();
  const [name, setName] = useState("");
  const [caps, setCaps] = useState({ color: false, duplex: false, a4: true, a3: false });
  const [touched, setTouched] = useState(false);
  return (
    <FormDialog
      title="Add printer"
      submitLabel="Add printer"
      busy={runner.busy}
      error={runner.error}
      disabled={name.trim() === ""}
      onCancel={onClose}
      onSubmit={() => {
        setTouched(true);
        if (placement.error !== null) return;
        // The branch goes in the body next to the rest; the client's input type does not name it yet.
        const input: RegisterPrinterInput & { branchId?: string } = {
          shopId,
          name: name.trim(),
          capabilities: caps,
          ...(placement.branchId !== undefined ? { branchId: placement.branchId } : {}),
        };
        void runner
          .run(() => getApi().printers.register(input))
          .then((outcome) => outcome === "ok" && onClose());
      }}
    >
      <label className="grid gap-1 font-medium">
        Name
        <input
          value={name}
          maxLength={200}
          onChange={(event) => setName(event.target.value)}
          className={`${INPUT} font-normal`}
        />
      </label>
      <BranchPlacementField
        placement={placement}
        touched={touched}
        hint="Only jobs from this branch print on this printer."
      />
      <CapabilityToggles value={caps} onChange={setCaps} />
      <p className="text-xs text-muted">
        After adding, pair a print agent on the shop computer so this printer can receive jobs.
      </p>
    </FormDialog>
  );
}

export function CapabilityToggles({
  value,
  onChange,
}: {
  value: { color: boolean; duplex: boolean; a4: boolean; a3: boolean };
  onChange: (next: { color: boolean; duplex: boolean; a4: boolean; a3: boolean }) => void;
}): ReactNode {
  const items: Array<[keyof typeof value, string]> = [
    ["color", "Colour"],
    ["duplex", "Double-sided"],
    ["a4", "A4"],
    ["a3", "A3"],
  ];
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 font-medium">Can print</legend>
      <div className="flex flex-wrap gap-4">
        {items.map(([key, label]) => (
          <label key={key} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={value[key]}
              onChange={(event) => onChange({ ...value, [key]: event.target.checked })}
            />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
