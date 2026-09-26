"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Permission } from "@print-automated/types";
import { Field, INPUT, Pager, SelectField, TextField } from "@/components/form-kit";
import { FormDialog } from "@/components/modal";
import { useActionRunner } from "@/components/orders/use-action-runner";
import { RequirePermission, ResourceBoundary } from "@/components/resource-boundary";
import { useSession } from "@/components/session-provider";
import { useCurrency } from "@/components/use-currency";
import {
  Button,
  DataTable,
  EmptyState,
  LiveStatus,
  PageHeader,
  Panel,
  Pill,
} from "@/components/ui";
import { getApi } from "@/lib/api";
import { formatDate, formatMoney, humanizeEnum } from "@/lib/format";
import { optionalText } from "@/lib/form-values";
import { PO_STATUSES, checkPoLines, poStatusTone, type LineForm } from "@/lib/purchase-orders-view";
import { useResource } from "@/lib/use-resource";

const PAGE = 25;

/** PRD 33: purchase orders (restocking). MANAGE_INVENTORY (owner, manager). */
export function PurchaseOrdersScreen(): ReactNode {
  return (
    <RequirePermission permission={Permission.MANAGE_INVENTORY} what="purchase orders">
      <PoBody />
    </RequirePermission>
  );
}

function PoBody(): ReactNode {
  const { business } = useSession();
  const shopId = business?.id ?? "";
  const currency = useCurrency();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const list = useResource(
    () =>
      getApi().purchaseOrders.list(shopId, {
        status: status || undefined,
        limit: PAGE,
        offset: page * PAGE,
      }),
    [shopId, status, page],
    { intervalMs: 60_000, enabled: shopId !== "" },
  );

  return (
    <>
      <PageHeader
        title="Purchase orders"
        subtitle={business?.name}
        actions={
          <>
            <LiveStatus
              lastUpdated={list.lastUpdated}
              refreshing={list.refreshing}
              onRefresh={list.reload}
            />
            <Button variant="primary" onClick={() => setCreating(true)}>
              New purchase order
            </Button>
          </>
        }
      />
      <div className="mb-4 max-w-xs">
        <SelectField
          label="Status"
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(0);
          }}
          options={PO_STATUSES.map((value) => ({ value, label: humanizeEnum(value) }))}
          emptyLabel="Any"
        />
      </div>
      <ResourceBoundary state={list} what="purchase orders">
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState
              title={status ? "No purchase order with that status" : "No purchase orders yet"}
            >
              Create one to restock paper from a supplier, then receive it when it arrives.
            </EmptyState>
          ) : (
            <Panel>
              <DataTable
                caption="Purchase orders"
                head={["Number", "Supplier", "Status", "Payment", "Total", "Expected", "Created"]}
              >
                {data.items.map((po) => (
                  <tr key={po.id}>
                    <td className="px-4 py-2">
                      <Link
                        href={`/purchase-orders/${po.id}`}
                        className="num font-medium underline-offset-2 hover:underline"
                      >
                        {po.poNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{po.supplierName}</td>
                    <td className="px-4 py-2">
                      <Pill tone={poStatusTone(po.status)}>{humanizeEnum(po.status)}</Pill>
                    </td>
                    <td className="px-4 py-2 text-muted">{humanizeEnum(po.paymentStatus)}</td>
                    <td className="num px-4 py-2 text-right">
                      {formatMoney(po.totalCostMinor, currency)}
                    </td>
                    <td className="px-4 py-2 text-muted">
                      {po.expectedDeliveryAt ? formatDate(po.expectedDeliveryAt) : "-"}
                    </td>
                    <td className="px-4 py-2 text-muted">{formatDate(po.createdAt)}</td>
                  </tr>
                ))}
              </DataTable>
              <Pager page={page} pageSize={PAGE} total={data.total} onPage={setPage} />
            </Panel>
          )
        }
      </ResourceBoundary>
      {creating && (
        <CreatePoDialog
          shopId={shopId}
          currency={currency}
          onClose={() => setCreating(false)}
          onSaved={list.reload}
        />
      )}
    </>
  );
}

let lineSeq = 0;
const newLine = (): LineForm => ({
  key: `l${++lineSeq}`,
  inventoryItemId: "",
  quantity: "",
  unitCost: "",
});

function CreatePoDialog({
  shopId,
  currency,
  onClose,
  onSaved,
}: {
  shopId: string;
  currency: string;
  onClose: () => void;
  onSaved: () => void;
}): ReactNode {
  const runner = useActionRunner(onSaved);
  const suppliers = useResource(
    () => getApi().suppliers.list(shopId, { status: "ACTIVE", limit: 100 }),
    [shopId],
  );
  const items = useResource(
    () => getApi().inventory.listItems(shopId, { active: true, limit: 100 }),
    [shopId],
  );
  const [supplierId, setSupplierId] = useState("");
  const [expected, setExpected] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineForm[]>(() => [newLine()]);
  const [touched, setTouched] = useState(false);
  const check = checkPoLines(lines, currency);
  const setLine = (key: string, patch: Partial<LineForm>): void =>
    setLines(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  return (
    <FormDialog
      title="New purchase order"
      submitLabel="Create purchase order"
      busy={runner.busy}
      error={runner.error}
      disabled={supplierId === ""}
      onCancel={onClose}
      onSubmit={() => {
        setTouched(true);
        if (!check.ok) return;
        void runner
          .run(() =>
            getApi().purchaseOrders.create({
              shopId,
              supplierId,
              expectedDeliveryAt: expected
                ? new Date(`${expected}T00:00:00.000Z`).toISOString()
                : undefined,
              notes: optionalText(notes),
              lines: check.lines,
            }),
          )
          .then((outcome) => outcome === "ok" && onClose());
      }}
    >
      <SelectField
        label="Supplier"
        value={supplierId}
        onChange={setSupplierId}
        options={(suppliers.data?.items ?? []).map((supplier) => ({
          value: supplier.id,
          label: supplier.name,
        }))}
        emptyLabel={suppliers.data === null ? "Loading suppliers…" : "Choose a supplier"}
        hint="Only active suppliers are listed."
      />
      <div className="grid gap-2">
        <span className="font-medium">Lines</span>
        {lines.map((line, index) => (
          <div
            key={line.key}
            className="grid grid-cols-[minmax(0,1fr)_5.5rem_6.5rem_auto] items-end gap-2"
          >
            <Field label={index === 0 ? "Item" : ""}>
              <select
                aria-label={`Line ${index + 1} item`}
                value={line.inventoryItemId}
                onChange={(event) => setLine(line.key, { inventoryItemId: event.target.value })}
                className={INPUT}
              >
                <option value="">Choose an item</option>
                {(items.data?.items ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={index === 0 ? "Quantity" : ""}>
              <input
                aria-label={`Line ${index + 1} quantity`}
                inputMode="numeric"
                value={line.quantity}
                onChange={(event) => setLine(line.key, { quantity: event.target.value })}
                className={`${INPUT} num`}
              />
            </Field>
            <Field label={index === 0 ? `Unit cost` : ""}>
              <input
                aria-label={`Line ${index + 1} unit cost`}
                inputMode="decimal"
                placeholder="item cost"
                value={line.unitCost}
                onChange={(event) => setLine(line.key, { unitCost: event.target.value })}
                className={`${INPUT} num`}
              />
            </Field>
            <Button
              variant="ghost"
              disabled={lines.length === 1}
              onClick={() => setLines(lines.filter((l) => l.key !== line.key))}
            >
              Remove
            </Button>
          </div>
        ))}
        <div>
          <Button onClick={() => setLines([...lines, newLine()])}>Add line</Button>
        </div>
        {touched && !check.ok && (
          <p role="alert" className="text-xs text-danger-fg">
            {check.error}
          </p>
        )}
        <p className="text-xs text-muted">
          A blank unit cost uses the item&apos;s own cost. Costs are in {currency}.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Expected delivery (optional)">
          <input
            type="date"
            value={expected}
            onChange={(event) => setExpected(event.target.value)}
            className={INPUT}
          />
        </Field>
        <TextField label="Notes (optional)" value={notes} onChange={setNotes} maxLength={2000} />
      </div>
    </FormDialog>
  );
}
