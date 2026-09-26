"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { SupplierProduct } from "@print-automated/api-client";
import { Permission } from "@print-automated/types";
import { NumberField, SelectField, TextField } from "@/components/form-kit";
import { FormDialog } from "@/components/modal";
import { useActionRunner } from "@/components/orders/use-action-runner";
import { RequirePermission, ResourceBoundary } from "@/components/resource-boundary";
import { useSession } from "@/components/session-provider";
import { SupplierDialog } from "@/components/suppliers/suppliers-screen";
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
import { formatMoney, minorToInput, parseMoneyToMinor } from "@/lib/format";
import { optionalText, parseWholeNumber } from "@/lib/form-values";
import { useResource } from "@/lib/use-resource";

/** One supplier: details, deactivate/reactivate (never delete), and the
 * items it supplies with its own SKU, price and lead time. */
export function SupplierDetail({ supplierId }: { supplierId: string }): ReactNode {
  return (
    <RequirePermission permission={Permission.MANAGE_SUPPLIERS} what="suppliers">
      <SupplierBody supplierId={supplierId} />
    </RequirePermission>
  );
}

function SupplierBody({ supplierId }: { supplierId: string }): ReactNode {
  const { business } = useSession();
  const shopId = business?.id ?? "";
  const currency = useCurrency();
  const supplier = useResource(() => getApi().suppliers.get(supplierId), [supplierId]);
  const links = useResource(
    () => getApi().suppliers.products(supplierId, { limit: 100 }),
    [supplierId],
  );
  const reload = (): void => {
    supplier.reload();
    links.reload();
  };
  const runner = useActionRunner(reload);
  const [editing, setEditing] = useState(false);
  const [linking, setLinking] = useState(false);
  const [editLink, setEditLink] = useState<SupplierProduct | null>(null);

  return (
    <>
      <p className="mb-3 text-sm">
        <Link href="/suppliers" className="underline underline-offset-2">
          &larr; Suppliers
        </Link>
      </p>
      <PageHeader
        title={supplier.data?.name ?? "Supplier"}
        subtitle={supplier.data?.paymentTerms ?? undefined}
        actions={
          <LiveStatus
            lastUpdated={supplier.lastUpdated}
            refreshing={supplier.refreshing}
            onRefresh={reload}
          />
        }
      />
      <ResourceBoundary state={supplier} what="this supplier">
        {(data) => (
          <div className="grid gap-4">
            <Panel
              title="Details"
              id="details"
              aside={
                <Pill tone={data.status === "ACTIVE" ? "good" : "neutral"}>
                  {data.status === "ACTIVE" ? "Active" : "Inactive"}
                </Pill>
              }
            >
              <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
                <Item label="Contact">{data.contactName ?? "-"}</Item>
                <Item label="Phone">{data.phone ?? "-"}</Item>
                <Item label="Email">{data.email ?? "-"}</Item>
                <Item label="Address">{data.address ?? "-"}</Item>
                <Item label="Notes">{data.notes ?? "-"}</Item>
              </dl>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={() => setEditing(true)} disabled={runner.busy}>
                  Edit supplier
                </Button>
                <Button
                  disabled={runner.busy}
                  onClick={() =>
                    void runner.run(() =>
                      getApi().suppliers.update(data.id, {
                        status: data.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
                      }),
                    )
                  }
                >
                  {data.status === "ACTIVE" ? "Deactivate supplier" : "Reactivate supplier"}
                </Button>
              </div>
              {data.status === "INACTIVE" && (
                <p className="mt-2 text-xs text-muted">
                  An inactive supplier keeps its history but cannot be chosen for new purchase
                  orders.
                </p>
              )}
              {runner.error !== null && (
                <p role="alert" className="mt-2 text-danger-fg">
                  {runner.error}
                </p>
              )}
            </Panel>

            <Panel
              title="Items this supplier provides"
              id="items"
              aside={
                <Button onClick={() => setLinking(true)} disabled={runner.busy}>
                  Link an item
                </Button>
              }
            >
              <ResourceBoundary state={links} what="linked items">
                {(list) =>
                  list.items.length === 0 ? (
                    <EmptyState title="No items linked">
                      Link the stock items this supplier sells, with their price and lead time.
                    </EmptyState>
                  ) : (
                    <DataTable
                      caption="Items this supplier provides"
                      head={["Item", "Their SKU", "Unit price", "Lead time", "Status", ""]}
                    >
                      {list.items.map((link) => (
                        <tr key={link.id}>
                          <td className="px-4 py-2">
                            <Link
                              href={`/inventory/${link.inventoryItemId}`}
                              className="font-medium underline"
                            >
                              {link.itemName}
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
                          <td className="px-4 py-2 text-right">
                            <Button
                              variant="ghost"
                              onClick={() => setEditLink(link)}
                              disabled={runner.busy}
                            >
                              Edit
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </DataTable>
                  )
                }
              </ResourceBoundary>
            </Panel>
          </div>
        )}
      </ResourceBoundary>

      {editing && supplier.data !== null && (
        <SupplierDialog
          shopId={shopId}
          supplier={supplier.data}
          onClose={() => setEditing(false)}
          onSaved={reload}
        />
      )}
      {linking && (
        <LinkDialog
          supplierId={supplierId}
          shopId={shopId}
          currency={currency}
          onClose={() => setLinking(false)}
          onSaved={reload}
        />
      )}
      {editLink !== null && (
        <EditLinkDialog
          link={editLink}
          currency={currency}
          onClose={() => setEditLink(null)}
          onSaved={reload}
        />
      )}
    </>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function LinkDialog({
  supplierId,
  shopId,
  currency,
  onClose,
  onSaved,
}: {
  supplierId: string;
  shopId: string;
  currency: string;
  onClose: () => void;
  onSaved: () => void;
}): ReactNode {
  const runner = useActionRunner(onSaved);
  const items = useResource(
    () => getApi().inventory.listItems(shopId, { active: true, limit: 100 }),
    [shopId],
  );
  const [itemId, setItemId] = useState("");
  const [sku, setSku] = useState("");
  const [price, setPrice] = useState("");
  const [lead, setLead] = useState("");
  const priceMinor = price.trim() === "" ? undefined : parseMoneyToMinor(price, currency);
  const leadDays = lead.trim() === "" ? undefined : parseWholeNumber(lead, { max: 3650 });
  const priceError =
    price.trim() !== "" && priceMinor === null ? "Enter an amount like 1.25." : null;
  const leadError =
    lead.trim() !== "" && leadDays === undefined ? "Enter whole days, 0 to 3650." : null;

  return (
    <FormDialog
      title="Link an item to this supplier"
      submitLabel="Link item"
      busy={runner.busy}
      error={runner.error}
      disabled={itemId === "" || priceError !== null || leadError !== null}
      onCancel={onClose}
      onSubmit={() =>
        void runner
          .run(() =>
            getApi().suppliers.linkProduct(supplierId, {
              inventoryItemId: itemId,
              supplierSku: optionalText(sku),
              unitPriceMinor: priceMinor ?? undefined,
              leadTimeDays: leadDays,
            }),
          )
          .then((outcome) => outcome === "ok" && onClose())
      }
    >
      <SelectField
        label="Stock item"
        value={itemId}
        onChange={setItemId}
        options={(items.data?.items ?? []).map((item) => ({ value: item.id, label: item.name }))}
        emptyLabel={items.data === null ? "Loading items…" : "Choose an item"}
      />
      <TextField
        label="Supplier's SKU (optional)"
        value={sku}
        onChange={setSku}
        maxLength={100}
        mono
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <NumberField
          label={`Unit price, ${currency} (optional)`}
          value={price}
          onChange={setPrice}
          error={priceError}
        />
        <NumberField
          label="Lead time, days (optional)"
          value={lead}
          onChange={setLead}
          error={leadError}
        />
      </div>
    </FormDialog>
  );
}

function EditLinkDialog({
  link,
  currency,
  onClose,
  onSaved,
}: {
  link: SupplierProduct;
  currency: string;
  onClose: () => void;
  onSaved: () => void;
}): ReactNode {
  const runner = useActionRunner(onSaved);
  const [sku, setSku] = useState(link.supplierSku ?? "");
  const [price, setPrice] = useState(
    link.unitPriceMinor === null ? "" : minorToInput(link.unitPriceMinor, currency),
  );
  const [lead, setLead] = useState(link.leadTimeDays === null ? "" : String(link.leadTimeDays));
  const [active, setActive] = useState(link.active);
  const priceMinor = price.trim() === "" ? null : parseMoneyToMinor(price, currency);
  const leadDays = lead.trim() === "" ? null : parseWholeNumber(lead, { max: 3650 });
  const priceError =
    price.trim() !== "" && priceMinor === null ? "Enter an amount like 1.25." : null;
  const leadError =
    lead.trim() !== "" && leadDays === undefined ? "Enter whole days, 0 to 3650." : null;

  return (
    <FormDialog
      title={`Edit link: ${link.itemName}`}
      submitLabel="Save link"
      busy={runner.busy}
      error={runner.error}
      disabled={priceError !== null || leadError !== null}
      onCancel={onClose}
      onSubmit={() =>
        void runner
          .run(() =>
            getApi().suppliers.updateProduct(link.id, {
              supplierSku: sku.trim() === "" ? null : sku.trim(),
              unitPriceMinor: priceMinor,
              leadTimeDays: leadDays ?? null,
              active,
            }),
          )
          .then((outcome) => outcome === "ok" && onClose())
      }
    >
      <TextField label="Supplier's SKU" value={sku} onChange={setSku} maxLength={100} mono />
      <div className="grid gap-3 sm:grid-cols-2">
        <NumberField
          label={`Unit price, ${currency}`}
          value={price}
          onChange={setPrice}
          error={priceError}
        />
        <NumberField label="Lead time, days" value={lead} onChange={setLead} error={leadError} />
      </div>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={active}
          onChange={(event) => setActive(event.target.checked)}
        />
        Active (offered on new purchase orders)
      </label>
      <div>
        <Button
          disabled={runner.busy}
          onClick={() =>
            void runner
              .run(() => getApi().suppliers.unlinkProduct(link.id))
              .then((outcome) => outcome === "ok" && onClose())
          }
        >
          Remove this link
        </Button>
        <p className="mt-1 text-xs text-muted">
          Removing a link does not delete the item or past orders.
        </p>
      </div>
    </FormDialog>
  );
}
