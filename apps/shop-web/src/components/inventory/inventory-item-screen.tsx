"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { InventoryItem } from "@print-automated/api-client";
import { Permission } from "@print-automated/types";
import { ItemDialog } from "@/components/inventory/inventory-screen";
import { NumberField, Pager, SelectField, TextField } from "@/components/form-kit";
import { FormDialog } from "@/components/modal";
import { useActionRunner } from "@/components/orders/use-action-runner";
import { RequirePermission, ResourceBoundary } from "@/components/resource-boundary";
import { useSession } from "@/components/session-provider";
import { useCurrency } from "@/components/use-currency";
import {
  BackLink,
  Button,
  DataTable,
  DetailGrid,
  EmptyState,
  LiveStatus,
  PageHeader,
  Panel,
  Pill,
  Stat,
  StatGrid,
} from "@/components/ui";
import { getApi } from "@/lib/api";
import { formatCount, formatDateTime, formatMoney, humanizeEnum } from "@/lib/format";
import { MANUAL_MOVEMENT_TYPES, checkMovement, stockLabel, stockTone } from "@/lib/inventory-view";
import { useResource } from "@/lib/use-resource";

const PAGE = 20;

/** One stock item: its state, an edit form, the movement history (paged,
 * newest first), manual movements, and the suppliers that provide it. */
export function InventoryItemScreen({ itemId }: { itemId: string }): ReactNode {
  return (
    <RequirePermission permission={Permission.VIEW_INVENTORY} what="inventory">
      <ItemBody itemId={itemId} />
    </RequirePermission>
  );
}

function ItemBody({ itemId }: { itemId: string }): ReactNode {
  const { business, can } = useSession();
  const shopId = business?.id ?? "";
  const canManage = can(Permission.MANAGE_INVENTORY);
  const currency = useCurrency();
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState(false);
  const [moving, setMoving] = useState(false);

  const item = useResource(() => getApi().inventory.getItem(itemId), [itemId], {
    intervalMs: 30_000,
  });
  const movements = useResource(
    () => getApi().inventory.movements(itemId, { limit: PAGE, offset: page * PAGE }),
    [itemId, page],
    {
      intervalMs: 30_000,
    },
  );
  const reload = (): void => {
    item.reload();
    movements.reload();
  };
  const runner = useActionRunner(reload);

  return (
    <>
      <BackLink href="/inventory">Inventory</BackLink>
      <PageHeader
        title={item.data?.name ?? "Stock item"}
        subtitle={item.data?.sku ?? undefined}
        actions={
          <>
            <LiveStatus
              lastUpdated={item.lastUpdated}
              refreshing={item.refreshing}
              onRefresh={reload}
            />
            {canManage && item.data !== null && (
              <>
                <Button onClick={() => setEditing(true)}>Edit item</Button>
                <Button variant="primary" onClick={() => setMoving(true)}>
                  Record stock movement
                </Button>
              </>
            )}
          </>
        }
      />
      <ResourceBoundary state={item} what="this stock item">
        {(data) => (
          <div className="grid gap-4">
            <StatGrid>
              <Stat
                label="On hand"
                value={formatCount(data.quantity)}
                tone={stockTone(data)}
                hint={stockLabel(data)}
              />
              <Stat label="Minimum" value={formatCount(data.minQuantity)} hint="Alert below this" />
              <Stat
                label="Maximum"
                value={data.maxQuantity === null ? "-" : formatCount(data.maxQuantity)}
              />
              <Stat
                label="Unit cost"
                value={
                  data.unitCostMinor === null ? "-" : formatMoney(data.unitCostMinor, currency)
                }
              />
            </StatGrid>
            <DetailGrid
              main={
                <>
                  <Panel
                    title="Stock movements"
                    id="movements"
                    aside={movements.data ? `${movements.data.total} total` : undefined}
                  >
                    <ResourceBoundary state={movements} what="movements">
                      {(list) =>
                        list.items.length === 0 ? (
                          <EmptyState title="No movements yet" />
                        ) : (
                          <>
                            <DataTable
                              caption="Stock movements, newest first"
                              head={["When", "Type", "Change", "Balance", "Reason"]}
                            >
                              {list.items.map((move) => (
                                <tr key={move.id}>
                                  <td className="px-4 py-2 whitespace-nowrap">
                                    {formatDateTime(move.createdAt)}
                                  </td>
                                  <td className="px-4 py-2">
                                    <Pill tone={move.type === "CONSUMPTION" ? "accent" : "neutral"}>
                                      {humanizeEnum(move.type)}
                                    </Pill>
                                  </td>
                                  <td
                                    className={`num px-4 py-2 text-right ${move.quantityDelta < 0 ? "text-danger-fg" : "text-good-fg"}`}
                                  >
                                    {move.quantityDelta > 0 ? "+" : ""}
                                    {formatCount(move.quantityDelta)}
                                  </td>
                                  <td className="num px-4 py-2 text-right">
                                    {formatCount(move.quantityAfter)}
                                  </td>
                                  <td className="px-4 py-2 text-muted">
                                    {move.reason ?? (move.printJobId ? "Used by a print job" : "")}
                                  </td>
                                </tr>
                              ))}
                            </DataTable>
                            <Pager
                              page={page}
                              pageSize={PAGE}
                              total={list.total}
                              onPage={setPage}
                            />
                          </>
                        )
                      }
                    </ResourceBoundary>
                    <p className="mt-3 text-xs text-muted">
                      Printing uses stock automatically (&ldquo;Consumption&rdquo;). If a job used
                      more than was on hand, the balance stops at zero and the shortfall is recorded
                      for follow-up.
                    </p>
                  </Panel>

                  {can(Permission.MANAGE_SUPPLIERS) && <SuppliersOfItem itemId={itemId} />}
                </>
              }
              aside={
                <>
                  <Panel title="Details" id="details">
                    <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-3 xl:grid-cols-1">
                      <Detail label="Paper">
                        {[data.paperSize, data.paperType]
                          .filter(Boolean)
                          .map((v) => humanizeEnum(v as string))
                          .join(" · ") || "Not set"}
                      </Detail>
                      <Detail label="Weight">
                        {data.weightGsm === null ? "Not set" : `${data.weightGsm} gsm`}
                      </Detail>
                      <Detail label="Location">{data.location ?? "Not set"}</Detail>
                      <Detail label="Status">
                        {data.active ? "Active" : "Inactive (hidden from allocation)"}
                      </Detail>
                      <Detail label="Updated">{formatDateTime(data.updatedAt)}</Detail>
                    </dl>
                    {canManage && (
                      <div className="mt-3">
                        <Button
                          disabled={runner.busy}
                          onClick={() =>
                            void runner.run(() =>
                              getApi().inventory.updateItem(data.id, { active: !data.active }),
                            )
                          }
                        >
                          {data.active ? "Deactivate item" : "Reactivate item"}
                        </Button>
                        {runner.error !== null && (
                          <p role="alert" className="mt-2 text-danger-fg">
                            {runner.error}
                          </p>
                        )}
                      </div>
                    )}
                  </Panel>
                </>
              }
            />
          </div>
        )}
      </ResourceBoundary>

      {editing && item.data !== null && (
        <ItemDialog
          shopId={shopId}
          item={item.data}
          currency={currency}
          onClose={() => setEditing(false)}
          onSaved={reload}
        />
      )}
      {moving && item.data !== null && (
        <MovementDialog item={item.data} onClose={() => setMoving(false)} onSaved={reload} />
      )}
    </>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function SuppliersOfItem({ itemId }: { itemId: string }): ReactNode {
  const currency = useCurrency();
  const list = useResource(() => getApi().suppliers.ofItem(itemId, { limit: 50 }), [itemId]);
  return (
    <Panel
      title="Suppliers of this item"
      id="suppliers"
      aside={
        <Link href="/suppliers" className="underline">
          All suppliers
        </Link>
      }
    >
      <ResourceBoundary state={list} what="suppliers">
        {(data) =>
          data.items.length === 0 ? (
            <p className="text-muted">
              No supplier is linked to this item yet. Link one from the supplier&apos;s page.
            </p>
          ) : (
            <DataTable
              caption="Suppliers of this item"
              head={["Supplier", "Their SKU", "Unit price", "Lead time", "Status"]}
            >
              {data.items.map((link) => (
                <tr key={link.id}>
                  <td className="px-4 py-2">
                    <Link href={`/suppliers/${link.supplierId}`} className="font-medium underline">
                      {link.supplierName}
                    </Link>
                  </td>
                  <td className="num px-4 py-2">{link.supplierSku ?? "-"}</td>
                  <td className="num px-4 py-2 text-right">
                    {link.unitPriceMinor === null
                      ? "-"
                      : formatMoney(link.unitPriceMinor, currency)}
                  </td>
                  <td className="px-4 py-2">
                    {link.leadTimeDays === null ? "-" : `${link.leadTimeDays} days`}
                  </td>
                  <td className="px-4 py-2">
                    {link.active ? <Pill tone="good">Active</Pill> : <Pill>Inactive</Pill>}
                  </td>
                </tr>
              ))}
            </DataTable>
          )
        }
      </ResourceBoundary>
    </Panel>
  );
}

/** A manual stock movement. The Idempotency-Key is created ONCE per opening
 * of this dialog: pressing Record twice, or retrying after a timeout, is the
 * same submission and can never apply twice; reopening the dialog is a new one. */
function MovementDialog({
  item,
  onClose,
  onSaved,
}: {
  item: InventoryItem;
  onClose: () => void;
  onSaved: () => void;
}): ReactNode {
  const runner = useActionRunner(onSaved);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [type, setType] = useState<string>("PURCHASE");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const check = checkMovement(type, quantity, reason);
  const needsReason = type === "ADJUSTMENT" || type === "CORRECTION";

  return (
    <FormDialog
      title={`Record movement for ${item.name}`}
      submitLabel="Record movement"
      busy={runner.busy}
      error={runner.error}
      onCancel={onClose}
      onSubmit={() => {
        setTouched(true);
        if (!check.ok) return;
        void runner
          .run(() => getApi().inventory.recordMovement(item.id, check.input, idempotencyKey))
          .then((outcome) => outcome === "ok" && onClose());
      }}
    >
      <p>
        On hand now: <strong className="num">{formatCount(item.quantity)}</strong>
      </p>
      <SelectField
        label="Type"
        value={type}
        onChange={setType}
        options={MANUAL_MOVEMENT_TYPES.map((value) => ({ value, label: humanizeEnum(value) }))}
        hint={
          type === "PURCHASE" || type === "RETURN"
            ? "Adds stock."
            : "Enter a negative number to remove stock, or a positive one to add."
        }
      />
      <NumberField
        label="Quantity"
        value={quantity}
        onChange={setQuantity}
        placeholder={type === "PURCHASE" || type === "RETURN" ? "e.g. 500" : "e.g. -30 or 30"}
        error={touched && !check.ok ? check.error : null}
      />
      <TextField
        label={needsReason ? "Reason (required)" : "Reason (optional)"}
        value={reason}
        onChange={setReason}
        maxLength={500}
      />
    </FormDialog>
  );
}
