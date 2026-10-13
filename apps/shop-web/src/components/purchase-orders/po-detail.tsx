"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { PurchaseOrder } from "@print-automated/api-client";
import { Permission } from "@print-automated/types";
import { Field, INPUT, SelectField, TextField } from "@/components/form-kit";
import { FormDialog } from "@/components/modal";
import { useActionRunner } from "@/components/orders/use-action-runner";
import { RequirePermission, ResourceBoundary } from "@/components/resource-boundary";
import { useCurrency } from "@/components/use-currency";
import {
  BackLink,
  Button,
  DataTable,
  DetailGrid,
  LiveStatus,
  Notice,
  PageHeader,
  Panel,
  Pill,
  Stat,
  StatGrid,
} from "@/components/ui";
import { getApi } from "@/lib/api";
import { formatCount, formatDate, formatDateTime, formatMoney, humanizeEnum } from "@/lib/format";
import { nullableText } from "@/lib/form-values";
import {
  PO_PAYMENT_STATUSES,
  availablePoActions,
  checkReceipt,
  poStatusTone,
} from "@/lib/purchase-orders-view";
import { useResource } from "@/lib/use-resource";

type Dialog = "place" | "receive" | "cancel" | "details" | null;

/** One purchase order: its lines, and place / receive / cancel / payment,
 * each only in the states where it makes sense. Receiving is idempotent on
 * the server (receiving twice changes nothing), and it adds the received
 * quantities to stock. */
export function PurchaseOrderDetail({ orderId }: { orderId: string }): ReactNode {
  return (
    <RequirePermission permission={Permission.MANAGE_INVENTORY} what="purchase orders">
      <PoBody orderId={orderId} />
    </RequirePermission>
  );
}

function PoBody({ orderId }: { orderId: string }): ReactNode {
  const currency = useCurrency();
  const po = useResource(() => getApi().purchaseOrders.get(orderId), [orderId], {
    intervalMs: 30_000,
  });
  const runner = useActionRunner(po.reload);
  const [dialog, setDialog] = useState<Dialog>(null);
  const open = (next: Dialog): void => setDialog(next);

  return (
    <>
      <BackLink href="/purchase-orders">Purchase orders</BackLink>
      <PageHeader
        title={po.data?.poNumber ?? "Purchase order"}
        subtitle={po.data?.supplierName}
        actions={
          <LiveStatus
            lastUpdated={po.lastUpdated}
            refreshing={po.refreshing}
            onRefresh={po.reload}
          />
        }
      />
      <ResourceBoundary state={po} what="this purchase order">
        {(data) => {
          const actions = availablePoActions(data.status);
          return (
            <div className="grid gap-4">
              <Panel>
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone={poStatusTone(data.status)}>{humanizeEnum(data.status)}</Pill>
                  <Pill>Payment: {humanizeEnum(data.paymentStatus)}</Pill>
                </div>
                {runner.error !== null && dialog === null && (
                  <Notice tone="danger" role="alert" className="mt-3">
                    {runner.error}
                  </Notice>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {actions.place && (
                    <Button variant="primary" disabled={runner.busy} onClick={() => open("place")}>
                      Place order with supplier
                    </Button>
                  )}
                  {actions.receive && (
                    <Button
                      variant="primary"
                      disabled={runner.busy}
                      onClick={() => open("receive")}
                    >
                      Receive delivery
                    </Button>
                  )}
                  {actions.editDetails && (
                    <Button disabled={runner.busy} onClick={() => open("details")}>
                      Edit notes and date
                    </Button>
                  )}
                  {actions.cancel && (
                    <Button disabled={runner.busy} onClick={() => open("cancel")}>
                      Cancel order
                    </Button>
                  )}
                </div>
                {data.status === "DRAFT" && (
                  <p className="mt-2 text-xs text-muted">
                    A draft is not sent anywhere until you place it.
                  </p>
                )}
              </Panel>

              <StatGrid>
                <Stat label="Total" value={formatMoney(data.totalCostMinor, currency)} />
                <Stat label="Lines" value={formatCount(data.lines.length)} />
                <Stat
                  label="Expected"
                  value={data.expectedDeliveryAt ? formatDate(data.expectedDeliveryAt) : "-"}
                />
                <Stat
                  label="Received"
                  value={data.actualDeliveryAt ? formatDate(data.actualDeliveryAt) : "-"}
                />
              </StatGrid>

              <DetailGrid
                main={
                  <>
                    <Panel title="Lines" id="lines">
                      <DataTable
                        caption="Purchase order lines"
                        head={["Item", "Ordered", "Received", "Unit cost", "Line total"]}
                      >
                        {data.lines.map((line) => (
                          <tr key={line.id}>
                            <td className="px-4 py-2">
                              <Link
                                href={`/inventory/${line.inventoryItemId}`}
                                className="font-medium underline"
                              >
                                {line.itemName}
                              </Link>
                            </td>
                            <td className="num px-4 py-2 text-right">
                              {formatCount(line.quantityOrdered)}
                            </td>
                            <td className="num px-4 py-2 text-right">
                              {line.quantityReceived === null
                                ? "-"
                                : formatCount(line.quantityReceived)}
                            </td>
                            <td className="num px-4 py-2 text-right">
                              {formatMoney(line.unitCostMinor, currency)}
                            </td>
                            <td className="num px-4 py-2 text-right">
                              {formatMoney(line.quantityOrdered * line.unitCostMinor, currency)}
                            </td>
                          </tr>
                        ))}
                      </DataTable>
                      {data.notes !== null && (
                        <p className="mt-3 text-sm text-muted">Notes: {data.notes}</p>
                      )}
                    </Panel>
                  </>
                }
                aside={
                  <>
                    {actions.setPayment && (
                      <Panel title="Payment" id="payment">
                        <div className="flex flex-wrap items-end gap-3">
                          <SelectField
                            label="Payment status"
                            value={data.paymentStatus}
                            onChange={(value) =>
                              void runner.run(() =>
                                getApi().purchaseOrders.setPayment(data.id, value),
                              )
                            }
                            options={PO_PAYMENT_STATUSES.map((value) => ({
                              value,
                              label: humanizeEnum(value),
                            }))}
                          />
                          <p className="text-xs text-muted">
                            Recording payment does not move any money; it is your own record.
                          </p>
                        </div>
                      </Panel>
                    )}
                  </>
                }
              />

              {dialog === "place" && (
                <PlaceDialog po={data} runner={runner} onClose={() => setDialog(null)} />
              )}
              {dialog === "cancel" && (
                <CancelDialog po={data} runner={runner} onClose={() => setDialog(null)} />
              )}
              {dialog === "receive" && (
                <ReceiveDialog po={data} runner={runner} onClose={() => setDialog(null)} />
              )}
              {dialog === "details" && (
                <DetailsDialog po={data} runner={runner} onClose={() => setDialog(null)} />
              )}
            </div>
          );
        }}
      </ResourceBoundary>
    </>
  );
}

interface Runner {
  busy: boolean;
  error: string | null;
  run: (action: () => Promise<unknown>) => Promise<"ok" | "failed" | "late-print" | "busy">;
}

function PlaceDialog({
  po,
  runner,
  onClose,
}: {
  po: PurchaseOrder;
  runner: Runner;
  onClose: () => void;
}): ReactNode {
  return (
    <FormDialog
      title={`Place ${po.poNumber}`}
      submitLabel="Place order"
      busy={runner.busy}
      error={runner.error}
      onCancel={onClose}
      onSubmit={() =>
        void runner
          .run(() => getApi().purchaseOrders.place(po.id))
          .then((o) => o === "ok" && onClose())
      }
    >
      <p>
        The order is marked as sent to {po.supplierName}. You can still cancel it until it is
        received.
      </p>
    </FormDialog>
  );
}

function CancelDialog({
  po,
  runner,
  onClose,
}: {
  po: PurchaseOrder;
  runner: Runner;
  onClose: () => void;
}): ReactNode {
  return (
    <FormDialog
      title={`Cancel ${po.poNumber}`}
      submitLabel="Cancel order"
      submitTone="danger"
      busy={runner.busy}
      error={runner.error}
      onCancel={onClose}
      onSubmit={() =>
        void runner
          .run(() => getApi().purchaseOrders.cancel(po.id))
          .then((o) => o === "ok" && onClose())
      }
    >
      <p>A cancelled order cannot be reopened. No stock changes.</p>
    </FormDialog>
  );
}

function ReceiveDialog({
  po,
  runner,
  onClose,
}: {
  po: PurchaseOrder;
  runner: Runner;
  onClose: () => void;
}): ReactNode {
  const [received, setReceived] = useState<Record<string, string>>(
    Object.fromEntries(po.lines.map((line) => [line.id, String(line.quantityOrdered)])),
  );
  const [date, setDate] = useState("");
  const [touched, setTouched] = useState(false);
  const check = checkReceipt(po, received);
  return (
    <FormDialog
      title={`Receive ${po.poNumber}`}
      submitLabel="Receive into stock"
      busy={runner.busy}
      error={runner.error}
      onCancel={onClose}
      onSubmit={() => {
        setTouched(true);
        if (!check.ok) return;
        void runner
          .run(() =>
            getApi().purchaseOrders.receive(po.id, {
              lines: check.lines,
              actualDeliveryAt: date ? new Date(`${date}T00:00:00.000Z`).toISOString() : undefined,
            }),
          )
          .then((o) => o === "ok" && onClose());
      }}
    >
      <p>
        Enter what actually arrived. The received quantities are added to stock; receiving the same
        order twice changes nothing.
      </p>
      <div className="grid gap-2">
        {po.lines.map((line) => (
          <Field
            key={line.id}
            label={`${line.itemName} (ordered ${formatCount(line.quantityOrdered)})`}
          >
            <input
              inputMode="numeric"
              value={received[line.id] ?? ""}
              onChange={(event) => setReceived({ ...received, [line.id]: event.target.value })}
              className={`${INPUT} num`}
            />
          </Field>
        ))}
      </div>
      <Field label="Delivered on (optional)">
        <input
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className={INPUT}
        />
      </Field>
      {touched && !check.ok && (
        <p role="alert" className="text-xs text-danger-fg">
          {check.error}
        </p>
      )}
    </FormDialog>
  );
}

function DetailsDialog({
  po,
  runner,
  onClose,
}: {
  po: PurchaseOrder;
  runner: Runner;
  onClose: () => void;
}): ReactNode {
  const [notes, setNotes] = useState(po.notes ?? "");
  const [expected, setExpected] = useState(
    po.expectedDeliveryAt ? po.expectedDeliveryAt.slice(0, 10) : "",
  );
  return (
    <FormDialog
      title={`Edit ${po.poNumber}`}
      submitLabel="Save"
      busy={runner.busy}
      error={runner.error}
      onCancel={onClose}
      onSubmit={() =>
        void runner
          .run(() =>
            getApi().purchaseOrders.update(po.id, {
              notes: nullableText(notes),
              expectedDeliveryAt: expected
                ? new Date(`${expected}T00:00:00.000Z`).toISOString()
                : null,
            }),
          )
          .then((o) => o === "ok" && onClose())
      }
    >
      <TextField label="Notes" value={notes} onChange={setNotes} maxLength={2000} />
      <Field label="Expected delivery">
        <input
          type="date"
          value={expected}
          onChange={(event) => setExpected(event.target.value)}
          className={INPUT}
        />
      </Field>
      <p className="text-xs text-muted">Last updated {formatDateTime(po.updatedAt)}.</p>
    </FormDialog>
  );
}
