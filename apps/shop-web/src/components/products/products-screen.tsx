"use client";

import { useState, type ReactNode } from "react";
import type { Product } from "@print-automated/api-client";
import { Permission } from "@print-automated/types";
import { CheckField, Pager, SearchForm, SelectField, TextField } from "@/components/form-kit";
import { FormDialog } from "@/components/modal";
import { useActionRunner } from "@/components/orders/use-action-runner";
import { PricingTab } from "@/components/products/pricing-tab";
import { RequirePermission, ResourceBoundary } from "@/components/resource-boundary";
import { useSession } from "@/components/session-provider";
import { Tabs } from "@/components/tabs";
import {
  Button,
  Cell,
  DataTable,
  EmptyState,
  LiveStatus,
  Notice,
  PageHeader,
  Panel,
  Pill,
  Row,
} from "@/components/ui";
import { getApi } from "@/lib/api";
import { humanizeEnum } from "@/lib/format";
import { PAPER_SIZE_OPTIONS, PAPER_TYPE_OPTIONS } from "@/lib/inventory-view";
import {
  buildProductInput,
  emptyProductForm,
  productToForm,
  type ProductForm,
  toProductUpdate,
} from "@/lib/pricing-view";
import { basisPointsToPercent } from "@/lib/form-values";
import { useResource } from "@/lib/use-resource";

const PAGE = 25;

/** The section 82 promise, stated wherever prices can be changed. */
export function PriceChangeNotice(): ReactNode {
  return (
    <Notice tone="accent" role="note">
      Changing a price or a rule never changes an order that is already confirmed: each order keeps
      the price it was quoted. New prices apply to new orders only.
    </Notice>
  );
}

/** PRD 34/35/82: the catalogue of what the business sells and the pricing
 * rules behind it. MANAGE_PRICES (owner, manager). */
export function ProductsScreen(): ReactNode {
  return (
    <RequirePermission permission={Permission.MANAGE_PRICES} what="products and pricing">
      <ProductsBody />
    </RequirePermission>
  );
}

function ProductsBody(): ReactNode {
  const [tab, setTab] = useState<"products" | "pricing">("products");
  return (
    <>
      <PageHeader title="Products & pricing" subtitle="What you sell, and what it costs" />
      <div className="mb-4">
        <PriceChangeNotice />
      </div>
      <Tabs
        ariaLabel="Sections"
        activeId={tab}
        items={[
          { id: "products", label: "Products" },
          { id: "pricing", label: "Pricing rules" },
        ]}
        onSelect={(id) => setTab(id === "pricing" ? "pricing" : "products")}
      />
      {tab === "products" ? <ProductsTab /> : <PricingTab />}
    </>
  );
}

function ProductsTab(): ReactNode {
  const { business } = useSession();
  const shopId = business?.id ?? "";
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [availability, setAvailability] = useState("");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const list = useResource(
    () =>
      getApi().products.list(shopId, {
        q: q || undefined,
        available: availability === "" ? undefined : availability === "yes",
        limit: PAGE,
        offset: page * PAGE,
      }),
    [shopId, q, availability, page],
    { intervalMs: 60_000, enabled: shopId !== "" },
  );
  const runner = useActionRunner(list.reload);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
        <LiveStatus
          lastUpdated={list.lastUpdated}
          refreshing={list.refreshing}
          onRefresh={list.reload}
        />
        <Button variant="primary" onClick={() => setEditing("new")}>
          Add product
        </Button>
      </div>
      <SearchForm
        label="Search product name"
        value={draft}
        onChange={setDraft}
        onSubmit={() => {
          setQ(draft.trim());
          setPage(0);
        }}
      >
        <SelectField
          label="Availability"
          value={availability}
          onChange={(value) => {
            setAvailability(value);
            setPage(0);
          }}
          options={[
            { value: "yes", label: "Available" },
            { value: "no", label: "Hidden" },
          ]}
          emptyLabel="Any"
        />
      </SearchForm>
      {runner.error !== null && (
        <Notice tone="danger" role="alert" className="mb-3">
          {runner.error}
        </Notice>
      )}
      <ResourceBoundary state={list} what="products">
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState title={q || availability ? "No product matches" : "No products yet"}>
              {q || availability
                ? "Try a different search."
                : "Add the services you sell, like copies or posters."}
            </EmptyState>
          ) : (
            <Panel flushOnPhone>
              <DataTable
                caption="Products"
                head={["Product", "Category", "Unit", "Tax", "Needs", "Availability", ""]}
                stackOnPhone
              >
                {data.items.map((product) => (
                  <Row key={product.id}>
                    <Cell className="font-medium">{product.name}</Cell>
                    <Cell label="Category" className="text-muted">
                      {product.category ?? "-"}
                    </Cell>
                    <Cell label="Unit" className="text-muted">
                      {product.unit ?? "-"}
                    </Cell>
                    <Cell label="Tax" className="num text-right">
                      {product.taxRateBasisPoints === null
                        ? "-"
                        : `${basisPointsToPercent(product.taxRateBasisPoints)}%`}
                    </Cell>
                    <Cell label="Needs" className="text-xs text-muted">
                      {requirementSummary(product)}
                    </Cell>
                    <Cell label="Availability">
                      <Pill tone={product.available ? "good" : "neutral"}>
                        {product.available ? "Available" : "Hidden"}
                      </Pill>
                    </Cell>
                    <Cell className="text-right whitespace-nowrap">
                      <Button
                        variant="ghost"
                        disabled={runner.busy}
                        onClick={() => setEditing(product)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={runner.busy}
                        onClick={() =>
                          void runner.run(() =>
                            getApi().products.update(product.id, { available: !product.available }),
                          )
                        }
                      >
                        {product.available ? "Hide" : "Make available"}
                      </Button>
                    </Cell>
                  </Row>
                ))}
              </DataTable>
              <Pager page={page} pageSize={PAGE} total={data.total} onPage={setPage} />
              <p className="mt-3 text-xs text-muted">
                Products are hidden, not deleted, so past orders keep their product.
              </p>
            </Panel>
          )
        }
      </ResourceBoundary>
      {editing !== null && (
        <ProductDialog
          shopId={shopId}
          product={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={list.reload}
        />
      )}
    </>
  );
}

function requirementSummary(product: Product): string {
  const parts: string[] = [];
  const caps = product.printerRequirements;
  if (caps?.color) parts.push("Colour");
  if (caps?.duplex) parts.push("Double-sided");
  if (caps?.a3) parts.push("A3");
  if (product.paperRequirements?.paperSize)
    parts.push(humanizeEnum(product.paperRequirements.paperSize));
  if (product.paperRequirements?.paperType)
    parts.push(humanizeEnum(product.paperRequirements.paperType));
  return parts.join(" · ") || "-";
}

function ProductDialog({
  shopId,
  product,
  onClose,
  onSaved,
}: {
  shopId: string;
  product?: Product;
  onClose: () => void;
  onSaved: () => void;
}): ReactNode {
  const runner = useActionRunner(onSaved);
  const [form, setForm] = useState<ProductForm>(() =>
    product ? productToForm(product) : emptyProductForm(),
  );
  const [touched, setTouched] = useState(false);
  const check = buildProductInput(form);
  const errors = touched && !check.ok ? check.errors : {};
  const set =
    (key: keyof ProductForm) =>
    (value: string): void =>
      setForm({ ...form, [key]: value });

  return (
    <FormDialog
      title={product ? `Edit ${product.name}` : "Add product"}
      submitLabel={product ? "Save product" : "Add product"}
      busy={runner.busy}
      error={runner.error}
      onCancel={onClose}
      onSubmit={() => {
        setTouched(true);
        if (!check.ok) return;
        void runner
          .run(() =>
            product
              ? getApi().products.update(product.id, toProductUpdate(check.input))
              : getApi().products.create(shopId, check.input),
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
          label="Category"
          value={form.category}
          onChange={set("category")}
          maxLength={100}
        />
        <TextField
          label="Unit"
          value={form.unit}
          onChange={set("unit")}
          maxLength={50}
          placeholder="e.g. page, copy"
        />
        <TextField
          label="Tax rate (%)"
          value={form.taxPercent}
          onChange={set("taxPercent")}
          error={errors.taxPercent}
          hint="Blank uses the business default."
          mono
        />
      </div>
      <TextField
        label="Description"
        value={form.description}
        onChange={set("description")}
        maxLength={2000}
      />
      <fieldset className="grid gap-2">
        <legend className="mb-1 font-medium">Needs a printer that can do</legend>
        <div className="flex flex-wrap gap-4">
          <CheckField
            label="Colour"
            checked={form.needsColor}
            onChange={(v) => setForm({ ...form, needsColor: v })}
          />
          <CheckField
            label="Double-sided"
            checked={form.needsDuplex}
            onChange={(v) => setForm({ ...form, needsDuplex: v })}
          />
          <CheckField
            label="A3"
            checked={form.needsA3}
            onChange={(v) => setForm({ ...form, needsA3: v })}
          />
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label="Paper size"
          value={form.paperSize}
          onChange={set("paperSize")}
          options={PAPER_SIZE_OPTIONS}
          emptyLabel="Any"
        />
        <SelectField
          label="Paper type"
          value={form.paperType}
          onChange={set("paperType")}
          options={PAPER_TYPE_OPTIONS}
          emptyLabel="Any"
        />
      </div>
      <CheckField
        label="Available to order"
        checked={form.available}
        onChange={(v) => setForm({ ...form, available: v })}
      />
      {product && (
        <p className="text-xs text-muted">
          Clearing a field removes it from the product; unticking a requirement drops it.
        </p>
      )}
    </FormDialog>
  );
}
