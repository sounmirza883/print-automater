"use client";

import { useState, type ReactNode } from "react";
import type { ShopOrderJobSummary, ShopOrderResponse } from "@print-automated/api-client";
import { JobFailureReason, ReprintReason, ShopRejectionReason } from "@print-automated/types";
import { INPUT } from "@/components/form-kit";
import { FormDialog } from "@/components/modal";
import type { ActionOutcome } from "@/components/orders/use-action-runner";
import { OperatorPicker } from "@/components/orders/operator-picker";
import { PrinterPicker } from "@/components/orders/printer-picker";
import { Notice } from "@/components/ui";
import { getApi } from "@/lib/api";
import { formatMoney, humanizeEnum, parseMoneyToMinor } from "@/lib/format";

export type DialogState =
  | {
      kind:
        | "reject"
        | "retry"
        | "changePrinter"
        | "recordPayment"
        | "qualityCheck"
        | "markReady"
        | "complete";
    }
  | {
      kind:
        | "reassign"
        | "assignOperator"
        | "pause"
        | "resume"
        | "recordFailure"
        | "reprint"
        | "resolveUnknown";
      job: ShopOrderJobSummary;
    }
  | { kind: "latePrint"; job: ShopOrderJobSummary; printerId: string };

export interface Runner {
  busy: boolean;
  error: string | null;
  run: (action: () => Promise<unknown>) => Promise<ActionOutcome>;
}

interface DialogProps {
  order: ShopOrderResponse;
  shopId: string;
  runner: Runner;
  close: () => void;
  open: (next: DialogState) => void;
}

function Field({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <label className="grid gap-1 font-medium">
      {label}
      {children}
    </label>
  );
}

function currencyOf(order: ShopOrderResponse): string {
  return order.pricingSnapshot?.quote?.currency ?? "PKR";
}

/** Every confirm/form dialog on the order screen. Each one submits
 * through the shared runner (one request at a time, precise errors from
 * the API's `error_code`) and closes only on success; a failure stays in
 * the dialog with its explanation so the person can correct and resubmit. */
export function OrderDialogs({
  dialog,
  ...props
}: DialogProps & { dialog: DialogState | null }): ReactNode {
  if (dialog === null) {
    return null;
  }
  switch (dialog.kind) {
    case "reject":
      return <RejectDialog {...props} />;
    case "retry":
      return <RetryDialog {...props} />;
    case "changePrinter":
      return <ChangePrinterDialog {...props} />;
    case "recordPayment":
      return <RecordPaymentDialog {...props} />;
    case "qualityCheck":
      return <QualityCheckDialog {...props} />;
    case "markReady":
      return <SimpleOrderDialog {...props} action="markReady" />;
    case "complete":
      return <SimpleOrderDialog {...props} action="complete" />;
    case "reassign":
      return <ReassignDialog {...props} job={dialog.job} />;
    case "assignOperator":
      return <AssignOperatorDialog {...props} job={dialog.job} />;
    case "pause":
      return <PauseDialog {...props} job={dialog.job} />;
    case "resume":
      return <ResumeDialog {...props} job={dialog.job} />;
    case "recordFailure":
      return <FailureReasonDialog {...props} job={dialog.job} />;
    case "reprint":
      return <ReprintDialog {...props} job={dialog.job} />;
    case "resolveUnknown":
      return <ResolveUnknownDialog {...props} job={dialog.job} />;
    case "latePrint":
      return <LatePrintDialog {...props} job={dialog.job} printerId={dialog.printerId} />;
  }
}

function RejectDialog({ order, runner, close }: DialogProps): ReactNode {
  const [reason, setReason] = useState<string>(ShopRejectionReason.PRINTER_UNAVAILABLE);
  return (
    <FormDialog
      title={`Reject ${order.publicOrderNumber}`}
      submitLabel="Reject and refund"
      submitTone="danger"
      busy={runner.busy}
      error={runner.error}
      onCancel={close}
      onSubmit={() =>
        void runner
          .run(() => getApi().shopOrders.reject(order.id, reason as ShopRejectionReason))
          .then((outcome) => outcome === "ok" && close())
      }
    >
      <p>
        The customer is told the order was rejected and, if they paid, refunded. This cannot be
        undone.
      </p>
      <Field label="Reason">
        <select
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className={INPUT}
        >
          {Object.values(ShopRejectionReason).map((value) => (
            <option key={value} value={value}>
              {humanizeEnum(value)}
            </option>
          ))}
        </select>
      </Field>
    </FormDialog>
  );
}

function RetryDialog({ order, runner, close }: DialogProps): ReactNode {
  return (
    <FormDialog
      title={`Retry printing ${order.publicOrderNumber}`}
      submitLabel="Retry printing"
      busy={runner.busy}
      error={runner.error}
      onCancel={close}
      onSubmit={() =>
        void runner
          .run(() => getApi().shopOrders.retryPrint(order.id))
          .then((outcome) => outcome === "ok" && close())
      }
    >
      <p>
        Only failed items are printed again. Check the printer&apos;s output first: retrying
        something that partly printed wastes paper. If a quality check failed, cancel and use
        Reprint on the job instead.
      </p>
    </FormDialog>
  );
}

function ChangePrinterDialog({ order, shopId, runner, close }: DialogProps): ReactNode {
  const [printerId, setPrinterId] = useState("");
  return (
    <FormDialog
      title={`Change printer for ${order.publicOrderNumber}`}
      submitLabel="Change printer and retry"
      busy={runner.busy}
      error={runner.error}
      disabled={printerId === ""}
      onCancel={close}
      onSubmit={() =>
        void runner
          .run(() => getApi().shopOrders.changePrinter(order.id, printerId))
          .then((outcome) => outcome === "ok" && close())
      }
    >
      <p>The failed job is sent to the printer you choose.</p>
      <PrinterPicker
        shopId={shopId}
        config={order.printConfiguration}
        value={printerId}
        onChange={setPrinterId}
      />
    </FormDialog>
  );
}

function RecordPaymentDialog({ order, runner, close }: DialogProps): ReactNode {
  const quote = order.pricingSnapshot?.quote;
  return (
    <FormDialog
      title={`Record payment for ${order.publicOrderNumber}`}
      submitLabel="Record payment received"
      busy={runner.busy}
      error={runner.error}
      onCancel={close}
      onSubmit={() =>
        void runner
          .run(() => getApi().shopOrders.recordPayment(order.id))
          .then((outcome) => outcome === "ok" && close())
      }
    >
      <p>
        Confirm you have received{" "}
        <strong className="num">
          {quote !== undefined ? formatMoney(quote.totalMinor, quote.currency) : "the full amount"}
        </strong>{" "}
        in cash or another way outside the system. The order then moves on to the shop.
      </p>
    </FormDialog>
  );
}

function SimpleOrderDialog({
  order,
  runner,
  close,
  action,
}: DialogProps & { action: "markReady" | "complete" }): ReactNode {
  const ready = action === "markReady";
  return (
    <FormDialog
      title={`${ready ? "Mark ready" : "Complete"} ${order.publicOrderNumber}`}
      submitLabel={ready ? "Mark ready for collection" : "Complete order"}
      busy={runner.busy}
      error={runner.error}
      onCancel={close}
      onSubmit={() =>
        void runner
          .run(() =>
            ready
              ? getApi().shopOrders.markReady(order.id)
              : getApi().shopOrders.complete(order.id),
          )
          .then((outcome) => outcome === "ok" && close())
      }
    >
      <p>
        {ready
          ? "The customer is told their order is ready to collect."
          : "The customer has collected the order (or it was delivered). It is closed and can no longer be changed."}
      </p>
    </FormDialog>
  );
}

function QualityCheckDialog({ order, runner, close }: DialogProps): ReactNode {
  const printed = order.printJobs.filter((job) => job.status === "PRINTED");
  const [result, setResult] = useState<"PASSED" | "FAILED" | "NEEDS_REPRINT">("PASSED");
  const [note, setNote] = useState("");
  const [jobIds, setJobIds] = useState<string[]>(printed.map((job) => job.id));
  const [reason, setReason] = useState<string>(ReprintReason.POOR_QUALITY);
  const [cost, setCost] = useState("");
  const currency = currencyOf(order);
  const costMinor = cost.trim() === "" ? undefined : parseMoneyToMinor(cost, currency);
  const costInvalid = cost.trim() !== "" && costMinor === null;

  return (
    <FormDialog
      title={`Quality check ${order.publicOrderNumber}`}
      submitLabel={
        result === "PASSED"
          ? "Record: passed"
          : result === "NEEDS_REPRINT"
            ? "Record and reprint"
            : "Record: failed"
      }
      submitTone={result === "PASSED" ? "primary" : "danger"}
      busy={runner.busy}
      error={runner.error}
      disabled={costInvalid || (result === "NEEDS_REPRINT" && jobIds.length === 0)}
      onCancel={close}
      onSubmit={() =>
        void runner
          .run(() =>
            getApi().shopOrders.qualityCheck(order.id, {
              result,
              note: note.trim() || undefined,
              ...(result === "NEEDS_REPRINT"
                ? {
                    jobIds,
                    reprintReason: reason as ReprintReason,
                    additionalCostMinor: costMinor ?? undefined,
                  }
                : {}),
            }),
          )
          .then((outcome) => outcome === "ok" && close())
      }
    >
      <fieldset className="grid gap-2">
        <legend className="mb-1 font-medium">Verdict</legend>
        {[
          ["PASSED", "Passed: the output is good"],
          ["NEEDS_REPRINT", "Needs reprint: print the bad job(s) again"],
          ["FAILED", "Failed: the output is unusable"],
        ].map(([value, label]) => (
          <label key={value} className="flex items-center gap-2">
            <input
              type="radio"
              name="verdict"
              checked={result === value}
              onChange={() => setResult(value as typeof result)}
            />
            {label}
          </label>
        ))}
      </fieldset>
      {result === "FAILED" && (
        <Notice tone="caution" role="note">
          A failed check cannot simply be retried. To print the bad pages again, choose{" "}
          <button
            type="button"
            className="font-medium underline"
            onClick={() => setResult("NEEDS_REPRINT")}
          >
            Needs reprint
          </button>{" "}
          instead, or use Reprint on the job afterwards.
        </Notice>
      )}
      {result === "NEEDS_REPRINT" && (
        <>
          <fieldset className="grid gap-1">
            <legend className="mb-1 font-medium">Jobs to reprint</legend>
            {printed.map((job) => (
              <label key={job.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={jobIds.includes(job.id)}
                  onChange={(event) =>
                    setJobIds(
                      event.target.checked
                        ? [...jobIds, job.id]
                        : jobIds.filter((id) => id !== job.id),
                    )
                  }
                />
                <span className="num">{job.id.slice(0, 8)}</span>
                {job.printerName !== null && (
                  <span className="text-muted">on {job.printerName}</span>
                )}
              </label>
            ))}
            {printed.length === 0 && <p className="text-muted">No printed jobs to reprint.</p>}
          </fieldset>
          <Field label="Reason">
            <select
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className={INPUT}
            >
              {Object.values(ReprintReason).map((value) => (
                <option key={value} value={value}>
                  {humanizeEnum(value)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`Extra cost, ${currency} (optional)`}>
            <input
              inputMode="decimal"
              value={cost}
              onChange={(event) => setCost(event.target.value)}
              aria-invalid={costInvalid}
              className={`${INPUT} num`}
            />
            {costInvalid && (
              <span className="text-xs text-danger-fg">Enter an amount like 125.50.</span>
            )}
          </Field>
        </>
      )}
      <Field label="Note (optional)">
        <input
          value={note}
          maxLength={500}
          onChange={(event) => setNote(event.target.value)}
          className={INPUT}
        />
      </Field>
    </FormDialog>
  );
}

function ReassignDialog({
  order,
  shopId,
  runner,
  close,
  job,
}: DialogProps & { job: ShopOrderJobSummary }): ReactNode {
  const [printerId, setPrinterId] = useState("");
  const [reason, setReason] = useState("");
  return (
    <FormDialog
      title="Assign printer"
      submitLabel="Assign printer"
      busy={runner.busy}
      error={runner.error}
      disabled={printerId === "" || reason.trim() === ""}
      onCancel={close}
      onSubmit={() =>
        void runner
          .run(() => getApi().printJobs.reassign(job.id, printerId, reason.trim()))
          .then((outcome) => outcome === "ok" && close())
      }
    >
      <p>
        Manual assignment overrides automatic allocation and ignores page limits. The printer must
        still support the job.
      </p>
      <PrinterPicker
        shopId={shopId}
        config={order.printConfiguration}
        value={printerId}
        onChange={setPrinterId}
      />
      <Field label="Reason (recorded in the audit log)">
        <input
          value={reason}
          maxLength={500}
          onChange={(event) => setReason(event.target.value)}
          className={INPUT}
        />
      </Field>
    </FormDialog>
  );
}

/** 23.26 (PRD 21, manual operator allocation): who runs this job. Only people who work
 * here as operators are offered; choosing nobody clears it. */
function AssignOperatorDialog({
  shopId,
  runner,
  close,
  job,
}: DialogProps & { job: ShopOrderJobSummary }): ReactNode {
  const current = job.operatorId ?? "";
  const [operatorId, setOperatorId] = useState(current);
  return (
    <FormDialog
      title="Assign an operator"
      submitLabel={operatorId === "" ? "Clear operator" : "Assign"}
      busy={runner.busy}
      error={runner.error}
      disabled={operatorId === current}
      onCancel={close}
      onSubmit={() =>
        void runner
          .run(() =>
            getApi().printJobs.assignOperator(job.id, operatorId === "" ? null : operatorId),
          )
          .then((outcome) => outcome === "ok" && close())
      }
    >
      <p>
        {job.operatorName ? `Now: ${job.operatorName}.` : "Nobody is assigned to this job yet."} The
        operator is who runs this job on the floor; it does not change the printer.
      </p>
      <OperatorPicker
        shopId={shopId}
        value={operatorId}
        onChange={setOperatorId}
        emptyLabel="Nobody"
      />
    </FormDialog>
  );
}

function PauseDialog({
  runner,
  close,
  job,
}: DialogProps & { job: ShopOrderJobSummary }): ReactNode {
  const [reason, setReason] = useState("");
  return (
    <FormDialog
      title="Pause job"
      submitLabel="Pause job"
      busy={runner.busy}
      error={runner.error}
      onCancel={close}
      onSubmit={() =>
        void runner
          .run(() => getApi().printJobs.pause(job.id, reason.trim() || undefined))
          .then((outcome) => outcome === "ok" && close())
      }
    >
      <p>A paused job is not sent to a printer until someone resumes it.</p>
      <Field label="Reason (optional)">
        <input
          value={reason}
          maxLength={500}
          onChange={(event) => setReason(event.target.value)}
          className={INPUT}
        />
      </Field>
    </FormDialog>
  );
}

function ResumeDialog({
  order,
  shopId,
  runner,
  close,
  open,
  job,
}: DialogProps & { job: ShopOrderJobSummary }): ReactNode {
  const [printerId, setPrinterId] = useState("");
  return (
    <FormDialog
      title="Resume job"
      submitLabel="Resume job"
      busy={runner.busy}
      error={runner.error}
      onCancel={close}
      onSubmit={() =>
        void runner
          .run(() => getApi().printJobs.resume(job.id, printerId === "" ? {} : { printerId }))
          .then((outcome) => {
            if (outcome === "ok") {
              close();
            } else if (outcome === "late-print") {
              // 409 LATE_PRINT_ACK_REQUIRED: ask for the explicit acknowledgement.
              open({ kind: "latePrint", job, printerId });
            }
          })
      }
    >
      <p>
        The job goes back to the queue and a printer is chosen automatically, unless you pick one
        here.
      </p>
      <PrinterPicker
        shopId={shopId}
        config={order.printConfiguration}
        value={printerId}
        onChange={setPrinterId}
        emptyLabel="Choose automatically"
      />
    </FormDialog>
  );
}

/** Shown only after the API answered LATE_PRINT_ACK_REQUIRED: the ONLY
 * way forward is to resend the resume with `acknowledgeLatePrint: true`,
 * which this dialog does after the person confirms they checked the tray. */
function LatePrintDialog({
  runner,
  close,
  job,
  printerId,
}: DialogProps & { job: ShopOrderJobSummary; printerId: string }): ReactNode {
  return (
    <FormDialog
      title="This job may already have printed"
      submitLabel="I checked: resume anyway"
      submitTone="danger"
      busy={runner.busy}
      error={runner.error}
      onCancel={close}
      onSubmit={() =>
        void runner
          .run(() =>
            getApi().printJobs.resume(job.id, {
              ...(printerId === "" ? {} : { printerId }),
              acknowledgeLatePrint: true,
            }),
          )
          .then((outcome) => outcome === "ok" && close())
      }
    >
      <p>
        A printer reported this job as printed after it had been given up on, so paper may already
        have come out. Resuming prints it AGAIN. Look at the output tray first.
      </p>
    </FormDialog>
  );
}

function FailureReasonDialog({
  runner,
  close,
  job,
}: DialogProps & { job: ShopOrderJobSummary }): ReactNode {
  const [reason, setReason] = useState<string>(job.failureReason ?? JobFailureReason.PRINTER_ERROR);
  const [note, setNote] = useState(job.failureNote ?? "");
  return (
    <FormDialog
      title="Record failure reason"
      submitLabel="Save reason"
      busy={runner.busy}
      error={runner.error}
      onCancel={close}
      onSubmit={() =>
        void runner
          .run(() =>
            getApi().printJobs.recordFailureReason(
              job.id,
              reason as JobFailureReason,
              note.trim() || undefined,
            ),
          )
          .then((outcome) => outcome === "ok" && close())
      }
    >
      <Field label="What went wrong?">
        <select
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className={INPUT}
        >
          {Object.values(JobFailureReason).map((value) => (
            <option key={value} value={value}>
              {humanizeEnum(value)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Note (optional)">
        <input
          value={note}
          maxLength={500}
          onChange={(event) => setNote(event.target.value)}
          className={INPUT}
        />
      </Field>
    </FormDialog>
  );
}

function ReprintDialog({
  order,
  shopId,
  runner,
  close,
  job,
}: DialogProps & { job: ShopOrderJobSummary }): ReactNode {
  // One key per opening of this dialog: a retry of the SAME attempt (after a
  // timeout, say) replays instead of creating a second reprint, while
  // reopening the dialog is a new, deliberate attempt.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [reason, setReason] = useState<string>(ReprintReason.POOR_QUALITY);
  const [note, setNote] = useState("");
  const [cost, setCost] = useState("");
  const [printerId, setPrinterId] = useState("");
  const currency = currencyOf(order);
  const costMinor = cost.trim() === "" ? undefined : parseMoneyToMinor(cost, currency);
  const costInvalid = cost.trim() !== "" && costMinor === null;
  return (
    <FormDialog
      title="Reprint job"
      submitLabel="Create reprint"
      busy={runner.busy}
      error={runner.error}
      disabled={costInvalid}
      onCancel={close}
      onSubmit={() =>
        void runner
          .run(() =>
            getApi().printJobs.reprint(
              job.id,
              {
                reason: reason as ReprintReason,
                note: note.trim() || undefined,
                additionalCostMinor: costMinor ?? undefined,
                printerId: printerId || undefined,
              },
              idempotencyKey,
            ),
          )
          .then((outcome) => outcome === "ok" && close())
      }
    >
      <p>
        Prints the job again as a NEW job that references this one. Only one reprint can exist per
        job.
      </p>
      <Field label="Reason">
        <select
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className={INPUT}
        >
          {Object.values(ReprintReason).map((value) => (
            <option key={value} value={value}>
              {humanizeEnum(value)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={`Extra cost, ${currency} (optional, recorded on the reprint)`}>
        <input
          inputMode="decimal"
          value={cost}
          onChange={(event) => setCost(event.target.value)}
          aria-invalid={costInvalid}
          className={`${INPUT} num`}
        />
        {costInvalid && (
          <span className="text-xs text-danger-fg">Enter an amount like 125.50.</span>
        )}
      </Field>
      <PrinterPicker
        shopId={shopId}
        config={order.printConfiguration}
        value={printerId}
        onChange={setPrinterId}
        emptyLabel="Choose automatically"
      />
      <Field label="Note (optional)">
        <input
          value={note}
          maxLength={500}
          onChange={(event) => setNote(event.target.value)}
          className={INPUT}
        />
      </Field>
    </FormDialog>
  );
}

function ResolveUnknownDialog({
  runner,
  close,
  job,
  order,
}: DialogProps & { job: ShopOrderJobSummary }): ReactNode {
  const [resolution, setResolution] = useState<"CONFIRMED_PRINTED" | "RETRY" | "MARK_FAILED">(
    "CONFIRMED_PRINTED",
  );
  const [reason, setReason] = useState<string>(JobFailureReason.PRINTER_ERROR);
  const [note, setNote] = useState("");
  return (
    <FormDialog
      title={`Resolve ${order.publicOrderNumber}`}
      submitLabel="Resolve"
      submitTone={resolution === "RETRY" ? "danger" : "primary"}
      busy={runner.busy}
      error={runner.error}
      onCancel={close}
      onSubmit={() =>
        void runner
          .run(() =>
            getApi().shopOrders.resolveUnknownPrint(order.id, {
              resolution,
              jobId: job.id,
              ...(resolution === "MARK_FAILED"
                ? {
                    failureReason: reason as JobFailureReason,
                    failureNote: note.trim() || undefined,
                  }
                : {}),
            }),
          )
          .then((outcome) => outcome === "ok" && close())
      }
    >
      <p>
        The system cannot tell whether this job printed. Check the printer&apos;s output tray, then
        say what you found. Never retry before looking: it may print a second copy.
      </p>
      <fieldset className="grid gap-2">
        <legend className="sr-only">What happened</legend>
        {[
          ["CONFIRMED_PRINTED", "It printed: the paper is there"],
          ["MARK_FAILED", "It did not print, and should be marked failed"],
          ["RETRY", "It did not print: print it again now"],
        ].map(([value, label]) => (
          <label key={value} className="flex items-center gap-2">
            <input
              type="radio"
              name="resolution"
              checked={resolution === value}
              onChange={() => setResolution(value as typeof resolution)}
            />
            {label}
          </label>
        ))}
      </fieldset>
      {resolution === "MARK_FAILED" && (
        <>
          <Field label="Failure reason">
            <select
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className={INPUT}
            >
              {Object.values(JobFailureReason).map((value) => (
                <option key={value} value={value}>
                  {humanizeEnum(value)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Note (optional)">
            <input
              value={note}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
              className={INPUT}
            />
          </Field>
        </>
      )}
    </FormDialog>
  );
}
