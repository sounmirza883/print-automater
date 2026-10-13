"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { Supplier } from "@print-automated/api-client";
import { Permission } from "@print-automated/types";
import { Pager, SearchForm, SelectField, TextAreaField, TextField } from "@/components/form-kit";
import { FormDialog } from "@/components/modal";
import { useActionRunner } from "@/components/orders/use-action-runner";
import { RequirePermission, ResourceBoundary } from "@/components/resource-boundary";
import { useSession } from "@/components/session-provider";
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
} from "@/components/ui";
import { getApi } from "@/lib/api";
import { isEmail, nullableText, optionalText } from "@/lib/form-values";
import { useResource } from "@/lib/use-resource";

const PAGE = 25;

/** PRD 33: the business's suppliers. MANAGE_SUPPLIERS (owner, manager).
 * A supplier is never deleted: it is made inactive, which keeps its
 * purchase-order history and stops it being chosen for new orders. */
export function SuppliersScreen(): ReactNode {
  return (
    <RequirePermission permission={Permission.MANAGE_SUPPLIERS} what="suppliers">
      <SuppliersBody />
    </RequirePermission>
  );
}

function SuppliersBody(): ReactNode {
  const { business } = useSession();
  const shopId = business?.id ?? "";
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);
  const list = useResource(
    () =>
      getApi().suppliers.list(shopId, {
        search: search || undefined,
        status: status || undefined,
        limit: PAGE,
        offset: page * PAGE,
      }),
    [shopId, search, status, page],
    { intervalMs: 60_000, enabled: shopId !== "" },
  );

  return (
    <>
      <PageHeader
        title="Suppliers"
        subtitle={business?.name}
        actions={
          <>
            <LiveStatus
              lastUpdated={list.lastUpdated}
              refreshing={list.refreshing}
              onRefresh={list.reload}
            />
            <Button variant="primary" onClick={() => setAdding(true)}>
              Add supplier
            </Button>
          </>
        }
      />
      <SearchForm
        label="Search supplier name"
        value={draft}
        onChange={setDraft}
        onSubmit={() => {
          setSearch(draft.trim());
          setPage(0);
        }}
      >
        <SelectField
          label="Status"
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(0);
          }}
          options={[
            { value: "ACTIVE", label: "Active" },
            { value: "INACTIVE", label: "Inactive" },
          ]}
          emptyLabel="Any"
        />
      </SearchForm>
      <ResourceBoundary state={list} what="suppliers">
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState
              title={search || status ? "No supplier matches" : "No suppliers yet"}
              action={
                !search && !status ? (
                  <Button variant="primary" onClick={() => setAdding(true)}>
                    Add your first supplier
                  </Button>
                ) : undefined
              }
            >
              {search || status
                ? "Try a different search."
                : "Suppliers are who you buy paper and consumables from."}
            </EmptyState>
          ) : (
            <Panel flushOnPhone>
              <DataTable
                caption="Suppliers"
                head={["Supplier", "Contact", "Phone", "Payment terms", "Status"]}
                stackOnPhone
              >
                {data.items.map((supplier) => (
                  <Row key={supplier.id}>
                    <Cell>
                      <Link
                        href={`/suppliers/${supplier.id}`}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {supplier.name}
                      </Link>
                    </Cell>
                    <Cell label="Contact" className="text-muted">
                      {supplier.contactName ?? supplier.email ?? "-"}
                    </Cell>
                    <Cell label="Phone" className="num">
                      {supplier.phone ?? "-"}
                    </Cell>
                    <Cell label="Payment terms" className="text-muted">
                      {supplier.paymentTerms ?? "-"}
                    </Cell>
                    <Cell label="Status">
                      <Pill tone={supplier.status === "ACTIVE" ? "good" : "neutral"}>
                        {supplier.status === "ACTIVE" ? "Active" : "Inactive"}
                      </Pill>
                    </Cell>
                  </Row>
                ))}
              </DataTable>
              <Pager page={page} pageSize={PAGE} total={data.total} onPage={setPage} />
            </Panel>
          )
        }
      </ResourceBoundary>
      {adding && (
        <SupplierDialog shopId={shopId} onClose={() => setAdding(false)} onSaved={list.reload} />
      )}
    </>
  );
}

/** Create (no `supplier`) or edit a supplier. */
export function SupplierDialog({
  shopId,
  supplier,
  onClose,
  onSaved,
}: {
  shopId: string;
  supplier?: Supplier;
  onClose: () => void;
  onSaved: () => void;
}): ReactNode {
  const runner = useActionRunner(onSaved);
  const [form, setForm] = useState({
    name: supplier?.name ?? "",
    contactName: supplier?.contactName ?? "",
    email: supplier?.email ?? "",
    phone: supplier?.phone ?? "",
    address: supplier?.address ?? "",
    paymentTerms: supplier?.paymentTerms ?? "",
    notes: supplier?.notes ?? "",
  });
  const [touched, setTouched] = useState(false);
  const set =
    (key: keyof typeof form) =>
    (value: string): void =>
      setForm({ ...form, [key]: value });
  const nameError = form.name.trim() === "" ? "Enter a name." : null;
  const emailError =
    form.email.trim() !== "" && !isEmail(form.email) ? "Enter a valid email address." : null;

  return (
    <FormDialog
      title={supplier ? `Edit ${supplier.name}` : "Add supplier"}
      submitLabel={supplier ? "Save supplier" : "Add supplier"}
      busy={runner.busy}
      error={runner.error}
      onCancel={onClose}
      onSubmit={() => {
        setTouched(true);
        if (nameError || emailError) return;
        void runner
          .run(() =>
            supplier
              ? getApi().suppliers.update(supplier.id, {
                  name: form.name.trim(),
                  contactName: nullableText(form.contactName),
                  email: nullableText(form.email),
                  phone: nullableText(form.phone),
                  address: nullableText(form.address),
                  paymentTerms: nullableText(form.paymentTerms),
                  notes: nullableText(form.notes),
                })
              : getApi().suppliers.create(shopId, {
                  name: form.name.trim(),
                  contactName: optionalText(form.contactName),
                  email: optionalText(form.email),
                  phone: optionalText(form.phone),
                  address: optionalText(form.address),
                  paymentTerms: optionalText(form.paymentTerms),
                  notes: optionalText(form.notes),
                }),
          )
          .then((outcome) => outcome === "ok" && onClose());
      }}
    >
      <TextField
        label="Name"
        value={form.name}
        onChange={set("name")}
        error={touched ? nameError : null}
        maxLength={200}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label="Contact person"
          value={form.contactName}
          onChange={set("contactName")}
          maxLength={200}
        />
        <TextField
          label="Phone"
          type="tel"
          value={form.phone}
          onChange={set("phone")}
          maxLength={50}
        />
        <TextField
          label="Email"
          type="email"
          value={form.email}
          onChange={set("email")}
          error={touched ? emailError : null}
          maxLength={320}
        />
        <TextField
          label="Payment terms"
          value={form.paymentTerms}
          onChange={set("paymentTerms")}
          maxLength={200}
          placeholder="e.g. Net 30"
        />
      </div>
      <TextField label="Address" value={form.address} onChange={set("address")} maxLength={500} />
      <TextAreaField label="Notes" value={form.notes} onChange={set("notes")} maxLength={2000} />
    </FormDialog>
  );
}
