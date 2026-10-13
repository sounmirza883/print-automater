"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { InventoryItem } from "@print-automated/api-client";
import { Permission } from "@print-automated/types";
import {
  CheckField,
  ErrorBanner,
  Pager,
  SearchForm,
  SelectField,
  TextField,
  NumberField,
} from "@/components/form-kit";
import { FormDialog } from "@/components/modal";
import { useActionRunner } from "@/components/orders/use-action-runner";
import { RequirePermission, ResourceBoundary } from "@/components/resource-boundary";
import { useSession } from "@/components/session-provider";
import { useCurrency } from "@/components/use-currency";
import {
  Button,
  Cell,
  DataTable,
  EmptyState,
  LiveStatus,
  PageHeader,
  Panel,
  Pill,
  Row,
  Stat,
  StatGrid,
} from "@/components/ui";
import { getApi } from "@/lib/api";
import { formatCount, formatMoney, formatDateTime } from "@/lib/format";
import {
  PAPER_SIZE_OPTIONS,
  PAPER_TYPE_OPTIONS,
  buildItemInput,
  emptyItemForm,
  itemToForm,
  stockLabel,
  stockTone,
  type ItemForm,
} from "@/lib/inventory-view";
import { useResource } from "@/lib/use-resource";

const PAGE = 25;

/** PRD 30-33 stock. VIEW_INVENTORY reads (operators load paper); changing
 * anything needs MANAGE_INVENTORY (owner and manager), so those controls
 * simply are not shown to a viewer. */
export function InventoryScreen(): ReactNode {
  return (
    <RequirePermission permission={Permission.VIEW_INVENTORY} what="inventory">
      <InventoryBody />
    </RequirePermission>
  );
}

function InventoryBody(): ReactNode {
  const { business, can } = useSession();
  const shopId = business?.id ?? "";
  const canManage = can(Permission.MANAGE_INVENTORY);
  const currency = useCurrency();
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);

  const summary = useResource(() => getApi().inventory.summary(shopId), [shopId], {
    intervalMs: 30_000,
    enabled: shopId !== "",
  });
  const alerts = useResource(
    () => getApi().inventory.alerts(shopId, { status: "OPEN", limit: 10 }),
    [shopId],
    {
      intervalMs: 30_000,
      enabled: shopId !== "",
    },
  );
  const items = useResource(
    () =>
      getApi().inventory.listItems(shopId, {
        search: search || undefined,
        lowStock: lowOnly ? true : undefined,
        active: showInactive ? undefined : true,
        limit: PAGE,
        offset: page * PAGE,
      }),
    [shopId, search, lowOnly, showInactive, page],
    { intervalMs: 30_000, enabled: shopId !== "" },
  );
  const reloadAll = (): void => {
    summary.reload();
    alerts.reload();
    items.reload();
  };
  const runner = useActionRunner(reloadAll);

  return (
    <>
      <PageHeader
        title="Inventory"
        subtitle={business?.name}
        actions={
          <>
            <LiveStatus
              lastUpdated={items.lastUpdated}
              refreshing={items.refreshing}
              onRefresh={reloadAll}
            />
            {canManage && (
              <Button variant="primary" onClick={() => setAdding(true)}>
                Add stock item
              </Button>
            )}
          </>
        }
      />

      <ResourceBoundary state={summary} what="inventory">
        {(data) => (
          <div className="mb-4 grid gap-4">
            {!data.trackingEnabled && (
              <Panel tone="caution" title="Stock tracking is off">
                <p>
                  While tracking is off, printing does not use up stock and jobs never wait for
                  paper. Items and movements can still be recorded.
                </p>
                {canManage && (
                  <div className="mt-3">
                    <ErrorBanner message={runner.error} />
                    <Button
                      variant="primary"
                      disabled={runner.busy}
                      onClick={() =>
                        void runner.run(() => getApi().inventory.setTracking(shopId, true))
                      }
                    >
                      Turn stock tracking on
                    </Button>
                  </div>
                )}
              </Panel>
            )}
            {data.trackingEnabled && canManage && (
              <div className="flex justify-end">
                <Button
                  disabled={runner.busy}
                  onClick={() =>
                    void runner.run(() => getApi().inventory.setTracking(shopId, false))
                  }
                >
                  Turn stock tracking off
                </Button>
              </div>
            )}
            <StatGrid>
              <Stat label="Active items" value={formatCount(data.activeItems)} />
              <Stat
                label="Low stock"
                value={formatCount(data.lowStockCount)}
                tone={data.lowStockCount > 0 ? "caution" : "neutral"}
              />
              <Stat
                label="Out of stock"
                value={formatCount(data.outOfStockCount)}
                tone={data.outOfStockCount > 0 ? "danger" : "neutral"}
              />
              <Stat
                label="Open alerts"
                value={formatCount(data.openAlertCount)}
                tone={data.openAlertCount > 0 ? "caution" : "neutral"}
              />
            </StatGrid>
            {data.trackingEnabled && data.outOfStockCount > 0 && (
              <Panel tone="danger" title="Jobs may be waiting for paper">
                <p>
                  When an item runs out, jobs that need it wait as &ldquo;Out of paper&rdquo;.
                  Restock, then those jobs are picked up again.{" "}
                  <Link href="/orders?group=needsAttention" className="font-medium underline">
                    See jobs that need attention
                  </Link>
                </p>
              </Panel>
            )}
            {alerts.data !== null && alerts.data.items.length > 0 && (
              <Panel title="Low-stock alerts" aside={`${alerts.data.total} open`} id="alerts">
                <ul className="divide-y divide-line">
                  {alerts.data.items.map((alert) => (
                    <li
                      key={alert.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                    >
                      <Link
                        href={`/inventory/${alert.inventoryItemId}`}
                        className="font-medium underline"
                      >
                        {alert.itemName}
                      </Link>
                      <span className="num text-muted">
                        {formatCount(alert.currentQuantity)} left (minimum{" "}
                        {formatCount(alert.minQuantity)})
                      </span>
                      <span className="text-xs text-muted">
                        since {formatDateTime(alert.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted">
                  An alert resolves itself when stock is back above the minimum.
                </p>
              </Panel>
            )}
          </div>
        )}
      </ResourceBoundary>

      <SearchForm
        label="Search name, SKU or location"
        value={draft}
        onChange={setDraft}
        onSubmit={() => {
          setSearch(draft.trim());
          setPage(0);
        }}
      >
        <CheckField
          label="Low stock only"
          checked={lowOnly}
          onChange={(value) => {
            setLowOnly(value);
            setPage(0);
          }}
        />
        <CheckField
          label="Show inactive"
          checked={showInactive}
          onChange={(value) => {
            setShowInactive(value);
            setPage(0);
          }}
        />
      </SearchForm>

      <ResourceBoundary state={items} what="stock items">
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState title={search || lowOnly ? "No item matches" : "No stock items yet"}>
              {search || lowOnly
                ? "Try a different search."
                : "Add the paper you keep so stock can be tracked."}
            </EmptyState>
          ) : (
            <Panel flushOnPhone>
              <DataTable
                caption="Stock items"
                head={["Item", "Paper", "On hand", "Minimum", "Location", "Unit cost", "Status"]}
                stackOnPhone
              >
                {data.items.map((item) => (
                  <ItemRow key={item.id} item={item} currency={currency} />
                ))}
              </DataTable>
              <Pager page={page} pageSize={PAGE} total={data.total} onPage={setPage} />
            </Panel>
          )
        }
      </ResourceBoundary>

      {adding && (
        <ItemDialog
          shopId={shopId}
          currency={currency}
          onClose={() => setAdding(false)}
          onSaved={reloadAll}
        />
      )}
    </>
  );
}

function ItemRow({ item, currency }: { item: InventoryItem; currency: string }): ReactNode {
  return (
    <Row>
      <Cell>
        <Link
          href={`/inventory/${item.id}`}
          className="font-medium underline-offset-2 hover:underline"
        >
          {item.name}
        </Link>
        {item.sku !== null && <span className="num ml-2 text-xs text-muted">{item.sku}</span>}
      </Cell>
      <Cell label="Paper" className="text-muted">
        {[item.paperSize, item.paperType].filter(Boolean).join(" ") || "-"}
        {item.weightGsm !== null && ` ${item.weightGsm} gsm`}
      </Cell>
      <Cell label="On hand" className="num text-right">
        {formatCount(item.quantity)}
      </Cell>
      <Cell label="Minimum" className="num text-right text-muted">
        {formatCount(item.minQuantity)}
      </Cell>
      <Cell label="Location" className="text-muted">
        {item.location ?? "-"}
      </Cell>
      <Cell label="Unit cost" className="num text-right">
        {item.unitCostMinor === null ? "-" : formatMoney(item.unitCostMinor, currency)}
      </Cell>
      <Cell label="Status">
        <Pill tone={stockTone(item)}>{stockLabel(item)}</Pill>
      </Cell>
    </Row>
  );
}

/** Create (no `item`) or edit one stock item. Errors such as
 * INVENTORY_SKU_TAKEN come back from the API and are worded per code. */
export function ItemDialog({
  shopId,
  item,
  currency,
  onClose,
  onSaved,
}: {
  shopId: string;
  item?: InventoryItem;
  currency: string;
  onClose: () => void;
  onSaved: () => void;
}): ReactNode {
  const runner = useActionRunner(onSaved);
  const [form, setForm] = useState<ItemForm>(() =>
    item ? itemToForm(item, currency) : emptyItemForm(),
  );
  const [touched, setTouched] = useState(false);
  const check = buildItemInput(form, currency);
  const errors = touched && !check.ok ? check.errors : {};
  const set =
    (key: keyof ItemForm) =>
    (value: string): void =>
      setForm({ ...form, [key]: value });

  return (
    <FormDialog
      title={item ? `Edit ${item.name}` : "Add stock item"}
      submitLabel={item ? "Save item" : "Add item"}
      busy={runner.busy}
      error={runner.error}
      onCancel={onClose}
      onSubmit={() => {
        setTouched(true);
        if (!check.ok) return;
        void runner
          .run(() =>
            item
              ? getApi().inventory.updateItem(item.id, check.update)
              : getApi().inventory.createItem(shopId, check.create),
          )
          .then((outcome) => outcome === "ok" && onClose());
      }}
    >
      <TextField
        label="Name"
        value={form.name}
        onChange={set("name")}
        error={errors.name}
        maxLength={200}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label="SKU (optional)"
          value={form.sku}
          onChange={set("sku")}
          maxLength={100}
          mono
        />
        <TextField
          label="Location (optional)"
          value={form.location}
          onChange={set("location")}
          maxLength={200}
        />
        <SelectField
          label="Paper size"
          value={form.paperSize}
          onChange={set("paperSize")}
          options={PAPER_SIZE_OPTIONS}
          emptyLabel="Not set"
        />
        <SelectField
          label="Paper type"
          value={form.paperType}
          onChange={set("paperType")}
          options={PAPER_TYPE_OPTIONS}
          emptyLabel="Not set"
        />
        <NumberField
          label="Weight (gsm)"
          value={form.weightGsm}
          onChange={set("weightGsm")}
          error={errors.weightGsm}
        />
        <NumberField
          label={`Unit cost, ${currency}`}
          value={form.unitCost}
          onChange={set("unitCost")}
          error={errors.unitCost}
        />
        <NumberField
          label="Minimum (low-stock alert below this)"
          value={form.minQuantity}
          onChange={set("minQuantity")}
          error={errors.minQuantity}
        />
        <NumberField
          label="Maximum (optional)"
          value={form.maxQuantity}
          onChange={set("maxQuantity")}
          error={errors.maxQuantity}
        />
        {!item && (
          <NumberField
            label="Starting quantity"
            value={form.initialQuantity}
            onChange={set("initialQuantity")}
            error={errors.initialQuantity}
            hint="Recorded as the first stock movement."
          />
        )}
      </div>
      {item && (
        <p className="text-xs text-muted">
          The quantity is changed with stock movements, not edited here, so every change stays in
          the history.
        </p>
      )}
    </FormDialog>
  );
}
