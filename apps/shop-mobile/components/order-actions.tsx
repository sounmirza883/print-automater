import { useState, type ReactNode } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { tokens } from "@print-automated/design-tokens";
import {
  availableOrderActions,
  shouldSteerToReprint,
  type ApiClient,
  type Can,
  type ShopOrderResponse,
  type ShopRejectionReason,
} from "@print-automated/api-client";
import { ReprintReason } from "@print-automated/types";
import { ActionForm, Choices, NoteField } from "@/components/form";
import type { RunAction } from "@/components/job-panel";
import { Button, MUTED, TONES } from "@/components/ui";
import {
  QUALITY_VERDICTS,
  REPRINT_REASONS,
  optionalNote,
  type QualityVerdict,
} from "@/lib/job-actions";
import type { PrintersState } from "@/lib/use-printers";

const REJECTION_REASONS: { value: ShopRejectionReason; label: string }[] = [
  { value: "PRINTER_UNAVAILABLE", label: "Printer unavailable" },
  { value: "CAPABILITY_UNAVAILABLE", label: "Requested capability unavailable" },
  { value: "SHOP_UNAVAILABLE", label: "Shop temporarily unavailable" },
  { value: "DOCUMENT_ISSUE", label: "Document issue" },
];

type OpenForm = "reject" | "payment" | "changePrinter" | "quality" | null;

/** 23.34: the order's own actions, from the rules shop-web uses (availableOrderActions,
 * 23.30): what the order's state allows AND the person's role may do. */
export function OrderActions({
  order,
  can,
  apiClient,
  run,
  busy,
  offline,
  printers,
}: {
  order: ShopOrderResponse;
  can: Can;
  apiClient: ApiClient;
  run: RunAction;
  busy: boolean;
  /** No connection: every action is disabled (the order screen says why). */
  offline: boolean;
  printers: PrintersState;
}): ReactNode {
  const actions = availableOrderActions(order, can);
  const [open, setOpen] = useState<OpenForm>(null);
  const paid = order.paymentStatus === "PAID";
  const close = (): void => setOpen(null);
  const done = async (action: () => Promise<unknown>): Promise<void> => {
    if (await run(action)) close();
  };

  return (
    <View style={styles.actions}>
      {shouldSteerToReprint(order) && (
        <View
          style={[
            styles.note,
            { backgroundColor: TONES.caution.bg, borderColor: TONES.caution.border },
          ]}
        >
          <Text style={{ color: TONES.caution.fg }}>
            The quality check failed. To print the bad pages again, use Reprint on the job below.
          </Text>
        </View>
      )}

      {open === null && (
        <>
          {actions.accept && (
            <>
              <Button
                label="Accept & Print"
                variant="primary"
                busy={busy}
                disabled={!paid || offline}
                onPress={() => void done(() => apiClient.shopOrders.accept(order.id))}
              />
              {!paid && (
                <Text style={styles.muted}>The order can be accepted once it is paid.</Text>
              )}
            </>
          )}
          {actions.reject && (
            <Button
              label="Reject order"
              onPress={() => setOpen("reject")}
              disabled={busy || offline}
            />
          )}
          {actions.recordPayment && (
            <Button
              label="Record payment at the counter"
              variant="primary"
              onPress={() => setOpen("payment")}
              disabled={busy || offline}
            />
          )}
          {actions.retry && (
            <Button
              label="Retry print"
              variant="primary"
              busy={busy}
              disabled={offline}
              onPress={() => void done(() => apiClient.shopOrders.retryPrint(order.id))}
            />
          )}
          {actions.changePrinter && (
            <Button
              label="Change printer"
              onPress={() => setOpen("changePrinter")}
              disabled={busy || offline}
            />
          )}
          {actions.qualityCheck && (
            <Button
              label="Quality check"
              variant="primary"
              onPress={() => setOpen("quality")}
              disabled={busy || offline}
            />
          )}
          {actions.markReady && (
            <Button
              label="Mark ready for collection"
              variant="primary"
              busy={busy}
              disabled={offline}
              onPress={() => void done(() => apiClient.shopOrders.markReady(order.id))}
            />
          )}
          {actions.complete && (
            <Button
              label="Complete"
              variant="primary"
              busy={busy}
              disabled={offline}
              onPress={() => void done(() => apiClient.shopOrders.complete(order.id))}
            />
          )}
        </>
      )}

      {open === "reject" && (
        <ActionForm title="Reason for rejecting">
          {REJECTION_REASONS.map((reason) => (
            <Button
              key={reason.value}
              label={reason.label}
              disabled={busy || offline}
              onPress={() => void done(() => apiClient.shopOrders.reject(order.id, reason.value))}
            />
          ))}
          <Button label="Cancel" variant="quiet" onPress={close} />
        </ActionForm>
      )}

      {open === "payment" && (
        <ActionForm title="Record payment">
          <Text>
            The customer has paid at the counter (cash or card terminal). This is recorded against
            the order.
          </Text>
          <Button
            label="Record payment"
            variant="primary"
            busy={busy}
            disabled={offline}
            onPress={() => void done(() => apiClient.shopOrders.recordPayment(order.id))}
          />
          <Button label="Cancel" variant="quiet" onPress={close} />
        </ActionForm>
      )}

      {open === "changePrinter" && (
        <ActionForm title="Choose a printer">
          {printers.phase === "loading" && <ActivityIndicator />}
          {printers.phase === "error" && <Text style={styles.error}>{printers.message}</Text>}
          {printers.phase === "ready" && printers.printers.length === 0 && (
            <Text style={styles.muted}>No printers are registered at this business.</Text>
          )}
          {printers.phase === "ready" &&
            printers.printers.map((printer) => (
              <Button
                key={printer.id}
                label={printer.name}
                disabled={busy || offline}
                onPress={() =>
                  void done(() => apiClient.shopOrders.changePrinter(order.id, printer.id))
                }
              />
            ))}
          <Button label="Cancel" variant="quiet" onPress={close} />
        </ActionForm>
      )}

      {open === "quality" && (
        <QualityForm
          order={order}
          apiClient={apiClient}
          busy={busy}
          offline={offline}
          close={close}
          done={done}
        />
      )}
    </View>
  );
}

function QualityForm({
  order,
  apiClient,
  busy,
  offline,
  close,
  done,
}: {
  order: ShopOrderResponse;
  apiClient: ApiClient;
  busy: boolean;
  offline: boolean;
  close: () => void;
  done: (action: () => Promise<unknown>) => Promise<void>;
}): ReactNode {
  const [verdict, setVerdict] = useState<QualityVerdict | null>(null);
  const [reason, setReason] = useState<ReprintReason>(ReprintReason.POOR_QUALITY);
  const [note, setNote] = useState("");
  const printed = order.printJobs.filter((job) => job.status === "PRINTED").map((job) => job.id);
  return (
    <ActionForm title="Quality check" tone={verdict === "FAILED" ? "danger" : "neutral"}>
      <Choices label="Verdict" options={QUALITY_VERDICTS} value={verdict} onChange={setVerdict} />
      {verdict === "NEEDS_REPRINT" && (
        <>
          <Text style={styles.muted}>
            Every printed job of this order ({printed.length}) is reprinted. To reprint only some,
            use Reprint on each job instead.
          </Text>
          <Choices label="Why?" options={REPRINT_REASONS} value={reason} onChange={setReason} />
        </>
      )}
      {verdict === "FAILED" && (
        <Text>
          A failed check cannot simply be retried: choose Needs reprint to print it again.
        </Text>
      )}
      <NoteField label="Note (optional)" value={note} onChange={setNote} />
      <Button
        label={verdict === "NEEDS_REPRINT" ? "Record and reprint" : "Record verdict"}
        variant={verdict === "FAILED" ? "danger" : "primary"}
        busy={busy}
        disabled={
          offline || verdict === null || (verdict === "NEEDS_REPRINT" && printed.length === 0)
        }
        onPress={() => {
          if (verdict === null) return;
          void done(() =>
            apiClient.shopOrders.qualityCheck(order.id, {
              result: verdict,
              note: optionalNote(note),
              ...(verdict === "NEEDS_REPRINT" ? { jobIds: printed, reprintReason: reason } : {}),
            }),
          );
        }}
      />
      <Button label="Cancel" variant="quiet" onPress={close} />
    </ActionForm>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 8, marginTop: 8 },
  note: { borderWidth: 1, borderRadius: tokens.radius.md, padding: 10 },
  muted: { color: MUTED },
  error: { color: tokens.colors.error },
});
