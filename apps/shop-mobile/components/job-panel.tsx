import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { tokens } from "@print-automated/design-tokens";
import {
  availableJobActions,
  humanizeEnum,
  type ApiClient,
  type Can,
  type ShopOrderJobSummary,
  type ShopOrderResponse,
  type StaffDirectoryItem,
} from "@print-automated/api-client";
import { JobFailureReason, ReprintReason } from "@print-automated/types";
import { ActionForm, Choices, NoteField } from "@/components/form";
import { BlockedNote, Button, MUTED, Pills } from "@/components/ui";
import {
  FAILURE_REASONS,
  REPRINT_REASONS,
  UNKNOWN_RESOLUTIONS,
  needsLatePrintAck,
  optionalNote,
  type UnknownResolution,
} from "@/lib/job-actions";
import { jobBadges } from "@/lib/job-view";
import type { PrintersState } from "@/lib/use-printers";

export type JobActionKind =
  "pause" | "latePrint" | "failure" | "reprint" | "reassign" | "operator" | "resolve";

export type RunAction = (
  action: () => Promise<unknown>,
  onError?: (error: unknown) => boolean,
) => Promise<boolean>;

/** 23.34: one print job on the order screen. Its facts (status, priority, printer, operator,
 * attempt, reprint, failure, why it is blocked), then only the actions its state and the
 * person's role allow (availableJobActions, shared with shop-web, 23.30). An action that
 * needs details opens a small form under the job; the API re-checks everything and its
 * refusal is shown as said. */
export function JobPanel({
  job,
  order,
  can,
  shopId,
  apiClient,
  open,
  onOpen,
  run,
  busy,
  offline,
  printers,
}: {
  job: ShopOrderJobSummary;
  order: ShopOrderResponse;
  can: Can;
  shopId: string;
  apiClient: ApiClient;
  open: JobActionKind | null;
  onOpen: (kind: JobActionKind | null) => void;
  run: RunAction;
  busy: boolean;
  /** No connection: every action is disabled (the order screen says why). */
  offline: boolean;
  printers: PrintersState;
}): ReactNode {
  const actions = availableJobActions(job, order, can);
  const close = (): void => onOpen(null);

  return (
    <View style={styles.card}>
      <Pills badges={jobBadges(job)} />
      <Fact label="Printer" value={job.printerName ?? "Not assigned yet"} />
      <Fact label="Operator" value={job.operatorName ?? "Nobody"} />
      {(job.attempt ?? 1) > 1 && <Fact label="Attempt" value={String(job.attempt)} />}
      {job.reprint !== null && (
        <Fact label="Reprint" value={`of an earlier job: ${humanizeEnum(job.reprint.reason)}`} />
      )}
      {job.failureReason !== null && (
        <Fact
          label="Failure"
          value={`${humanizeEnum(job.failureReason)}${job.failureNote ? `: ${job.failureNote}` : ""}`}
        />
      )}
      <BlockedNote reason={job.blockedReason} />

      {open === null && (
        <View style={styles.actions}>
          {actions.resolveUnknown && (
            <Button
              label="Resolve: check the printer"
              variant="primary"
              onPress={() => onOpen("resolve")}
              disabled={busy || offline}
            />
          )}
          {actions.resume && (
            <Button
              label="Resume"
              variant="primary"
              busy={busy}
              disabled={offline}
              onPress={() =>
                void run(
                  () => apiClient.printJobs.resume(job.id),
                  (error) => {
                    if (!needsLatePrintAck(error)) return false;
                    onOpen("latePrint");
                    return true;
                  },
                )
              }
            />
          )}
          {actions.pause && (
            <Button label="Pause" onPress={() => onOpen("pause")} disabled={busy || offline} />
          )}
          {actions.recordFailure && (
            <Button
              label="Record why it failed"
              onPress={() => onOpen("failure")}
              disabled={busy || offline}
            />
          )}
          {actions.reprint && (
            <Button label="Reprint" onPress={() => onOpen("reprint")} disabled={busy || offline} />
          )}
          {actions.reassign && (
            <Button
              label="Send to another printer"
              onPress={() => onOpen("reassign")}
              disabled={busy || offline}
            />
          )}
          {actions.assignOperator && (
            <Button
              label="Assign operator"
              onPress={() => onOpen("operator")}
              disabled={busy || offline}
            />
          )}
        </View>
      )}

      {open === "pause" && (
        <PauseForm
          job={job}
          apiClient={apiClient}
          run={run}
          busy={busy}
          offline={offline}
          close={close}
        />
      )}
      {open === "latePrint" && (
        <ActionForm title="This job may already have printed" tone="danger">
          <Text>
            A printer reported this job as printed after it had been given up on, so paper may
            already have come out. Resuming prints it AGAIN. Look at the output tray first.
          </Text>
          <Button
            label="I checked: resume anyway"
            variant="danger"
            busy={busy}
            disabled={offline}
            onPress={() =>
              void run(() => apiClient.printJobs.resume(job.id, { acknowledgeLatePrint: true }))
            }
          />
          <Button label="Cancel" variant="quiet" onPress={close} />
        </ActionForm>
      )}
      {open === "failure" && (
        <FailureForm
          job={job}
          apiClient={apiClient}
          run={run}
          busy={busy}
          offline={offline}
          close={close}
        />
      )}
      {open === "reprint" && (
        <ReprintForm
          job={job}
          apiClient={apiClient}
          run={run}
          busy={busy}
          offline={offline}
          close={close}
        />
      )}
      {open === "reassign" && (
        <ReassignForm
          job={job}
          apiClient={apiClient}
          run={run}
          busy={busy}
          offline={offline}
          close={close}
          printers={printers}
        />
      )}
      {open === "operator" && (
        <OperatorForm
          job={job}
          apiClient={apiClient}
          shopId={shopId}
          run={run}
          busy={busy}
          offline={offline}
          close={close}
        />
      )}
      {open === "resolve" && (
        <ResolveForm
          job={job}
          order={order}
          apiClient={apiClient}
          run={run}
          busy={busy}
          offline={offline}
          close={close}
        />
      )}
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

interface FormProps {
  job: ShopOrderJobSummary;
  apiClient: ApiClient;
  run: RunAction;
  busy: boolean;
  offline: boolean;
  close: () => void;
}

function FormButtons({
  label,
  onSubmit,
  busy,
  offline,
  close,
  disabled = false,
  danger = false,
}: {
  label: string;
  onSubmit: () => void;
  busy: boolean;
  offline: boolean;
  close: () => void;
  disabled?: boolean;
  danger?: boolean;
}): ReactNode {
  return (
    <>
      <Button
        label={label}
        variant={danger ? "danger" : "primary"}
        busy={busy}
        disabled={disabled || offline}
        onPress={onSubmit}
      />
      <Button label="Cancel" variant="quiet" onPress={close} disabled={busy || offline} />
    </>
  );
}

function PauseForm({ job, apiClient, run, busy, offline, close }: FormProps): ReactNode {
  const [note, setNote] = useState("");
  return (
    <ActionForm title="Pause job">
      <Text>A paused job is not sent to a printer until someone resumes it.</Text>
      <NoteField label="Reason (optional)" value={note} onChange={setNote} />
      <FormButtons
        label="Pause job"
        busy={busy}
        offline={offline}
        close={close}
        onSubmit={() => void run(() => apiClient.printJobs.pause(job.id, optionalNote(note)))}
      />
    </ActionForm>
  );
}

function FailureForm({ job, apiClient, run, busy, offline, close }: FormProps): ReactNode {
  const [reason, setReason] = useState<JobFailureReason>(
    (job.failureReason as JobFailureReason | null) ?? JobFailureReason.PRINTER_ERROR,
  );
  const [note, setNote] = useState(job.failureNote ?? "");
  return (
    <ActionForm title="Record why it failed">
      <Choices
        label="What went wrong?"
        options={FAILURE_REASONS}
        value={reason}
        onChange={setReason}
      />
      <NoteField label="Note (optional)" value={note} onChange={setNote} />
      <FormButtons
        label="Save reason"
        busy={busy}
        offline={offline}
        close={close}
        onSubmit={() =>
          void run(() =>
            apiClient.printJobs.recordFailureReason(job.id, reason, optionalNote(note)),
          )
        }
      />
    </ActionForm>
  );
}

function ReprintForm({ job, apiClient, run, busy, offline, close }: FormProps): ReactNode {
  // One key per opening of this form: a retry of the same attempt replays instead of
  // creating a second reprint, while opening the form again is a new, deliberate attempt.
  const [idempotencyKey] = useState(
    () => `${job.id}:reprint:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`,
  );
  const [reason, setReason] = useState<ReprintReason>(ReprintReason.POOR_QUALITY);
  const [note, setNote] = useState("");
  return (
    <ActionForm title="Reprint job">
      <Text>
        Prints the job again as a new job that refers to this one. A job can be reprinted once; an
        extra charge is recorded in the back office.
      </Text>
      <Choices label="Why?" options={REPRINT_REASONS} value={reason} onChange={setReason} />
      <NoteField label="Note (optional)" value={note} onChange={setNote} />
      <FormButtons
        label="Create reprint"
        busy={busy}
        offline={offline}
        close={close}
        onSubmit={() =>
          void run(() =>
            apiClient.printJobs.reprint(
              job.id,
              { reason, note: optionalNote(note) },
              idempotencyKey,
            ),
          )
        }
      />
    </ActionForm>
  );
}

function ReassignForm({
  job,
  apiClient,
  run,
  busy,
  offline,
  close,
  printers,
}: FormProps & { printers: PrintersState }): ReactNode {
  const [printerId, setPrinterId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const options =
    printers.phase === "ready"
      ? printers.printers
          .filter((printer) => printer.name !== job.printerName)
          .map((printer) => ({
            value: printer.id,
            label: `${printer.name} (${humanizeEnum(printer.status)})`,
          }))
      : [];
  return (
    <ActionForm title="Send to another printer">
      {printers.phase === "loading" && <ActivityIndicator />}
      {printers.phase === "error" && <Text style={styles.error}>{printers.message}</Text>}
      {printers.phase === "ready" && options.length === 0 && (
        <Text style={styles.muted}>There is no other printer to send it to.</Text>
      )}
      {options.length > 0 && (
        <Choices label="Printer" options={options} value={printerId} onChange={setPrinterId} />
      )}
      <NoteField label="Reason (required)" value={reason} onChange={setReason} />
      <FormButtons
        label="Send it there"
        busy={busy}
        offline={offline}
        close={close}
        disabled={printerId === null || reason.trim() === ""}
        onSubmit={() => {
          if (printerId !== null) {
            void run(() => apiClient.printJobs.reassign(job.id, printerId, reason.trim()));
          }
        }}
      />
    </ActionForm>
  );
}

const NOBODY = "__nobody__";

function OperatorForm({
  job,
  apiClient,
  shopId,
  run,
  busy,
  offline,
  close,
}: FormProps & { shopId: string }): ReactNode {
  const [operators, setOperators] = useState<StaffDirectoryItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [choice, setChoice] = useState<string>(job.operatorId ?? NOBODY);

  useEffect(() => {
    let cancelled = false;
    apiClient.shopStaff
      .directory(shopId, { role: "OPERATOR", limit: 100 })
      .then((page) => !cancelled && setOperators(page.items))
      .catch((error: unknown) => {
        if (!cancelled)
          setLoadError(error instanceof Error ? error.message : "Could not load operators.");
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, shopId]);

  const options = [
    { value: NOBODY, label: "Nobody" },
    ...(operators ?? []).map((operator) => ({ value: operator.userId, label: operator.name })),
  ];
  return (
    <ActionForm title="Assign operator">
      {operators === null && loadError === null && <ActivityIndicator />}
      {loadError !== null && <Text style={styles.error}>{loadError}</Text>}
      {operators !== null && (
        <Choices label="Who runs this job?" options={options} value={choice} onChange={setChoice} />
      )}
      <FormButtons
        label="Assign"
        busy={busy}
        offline={offline}
        close={close}
        disabled={operators === null}
        onSubmit={() =>
          void run(() =>
            apiClient.printJobs.assignOperator(job.id, choice === NOBODY ? null : choice),
          )
        }
      />
    </ActionForm>
  );
}

function ResolveForm({
  job,
  order,
  apiClient,
  run,
  busy,
  offline,
  close,
}: FormProps & { order: ShopOrderResponse }): ReactNode {
  const [resolution, setResolution] = useState<UnknownResolution | null>(null);
  const [reason, setReason] = useState<JobFailureReason>(JobFailureReason.PRINTER_ERROR);
  const [note, setNote] = useState("");
  return (
    <ActionForm title="What happened at the printer?" tone="danger">
      <Text>
        The system cannot tell whether this job printed. Check the printer&apos;s output tray, then
        say what you found. Never print it again before looking: it may make a second copy.
      </Text>
      <Choices
        label="What you found"
        options={UNKNOWN_RESOLUTIONS}
        value={resolution}
        onChange={setResolution}
      />
      {resolution === "MARK_FAILED" && (
        <>
          <Choices
            label="Failure reason"
            options={FAILURE_REASONS}
            value={reason}
            onChange={setReason}
          />
          <NoteField label="Note (optional)" value={note} onChange={setNote} />
        </>
      )}
      <FormButtons
        label={resolution === "RETRY" ? "Print it again" : "Save"}
        danger={resolution === "RETRY"}
        busy={busy}
        offline={offline}
        close={close}
        disabled={resolution === null}
        onSubmit={() => {
          if (resolution === null) return;
          void run(() =>
            apiClient.shopOrders.resolveUnknownPrint(order.id, {
              resolution,
              jobId: job.id,
              ...(resolution === "MARK_FAILED"
                ? { failureReason: reason, failureNote: optionalNote(note) }
                : {}),
            }),
          );
        }}
      />
    </ActionForm>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: tokens.borders.color,
    borderRadius: tokens.radius.md,
    padding: 12,
    gap: 8,
    backgroundColor: "#fff",
  },
  fact: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  factLabel: { color: MUTED },
  factValue: { fontWeight: "600", flexShrink: 1, textAlign: "right" },
  actions: { gap: 8, marginTop: 4 },
  muted: { color: MUTED },
  error: { color: tokens.colors.error },
});
