"use client";

import { useState, type ReactNode } from "react";
import type { Customer } from "@print-automated/api-client";
import { Permission } from "@print-automated/types";
import { Pager, SearchForm, SelectField, TextField } from "@/components/form-kit";
import { FormDialog } from "@/components/modal";
import { useActionRunner } from "@/components/orders/use-action-runner";
import { RequirePermission, ResourceBoundary } from "@/components/resource-boundary";
import { useSession } from "@/components/session-provider";
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
import { formatDate } from "@/lib/format";
import { isEmail, optionalText } from "@/lib/form-values";
import { useResource } from "@/lib/use-resource";

const PAGE = 25;

/** PRD 36: customer records for counter orders. Listing needs VIEW_ORDERS,
 * creating CREATE_ORDERS and editing EDIT_ORDERS; each control follows its
 * own permission. Records are made inactive, never deleted. */
export function CustomersScreen(): ReactNode {
  return (
    <RequirePermission permission={Permission.VIEW_ORDERS} what="customers">
      <CustomersBody />
    </RequirePermission>
  );
}

function CustomersBody(): ReactNode {
  const { business, can } = useSession();
  const shopId = business?.id ?? "";
  const canCreate = can(Permission.CREATE_ORDERS);
  const canEdit = can(Permission.EDIT_ORDERS);
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [active, setActive] = useState("yes");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Customer | "new" | null>(null);
  const list = useResource(
    () =>
      getApi().customers.list(shopId, {
        q: q || undefined,
        active: active === "" ? undefined : active === "yes",
        limit: PAGE,
        offset: page * PAGE,
      }),
    [shopId, q, active, page],
    { intervalMs: 60_000, enabled: shopId !== "" },
  );
  const runner = useActionRunner(list.reload);

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle={business?.name}
        actions={
          <>
            <LiveStatus
              lastUpdated={list.lastUpdated}
              refreshing={list.refreshing}
              onRefresh={list.reload}
            />
            {canCreate && (
              <Button variant="primary" onClick={() => setEditing("new")}>
                Add customer
              </Button>
            )}
          </>
        }
      />
      <SearchForm
        label="Search name, company, phone or email"
        value={draft}
        onChange={setDraft}
        onSubmit={() => {
          setQ(draft.trim());
          setPage(0);
        }}
      >
        <SelectField
          label="Show"
          value={active}
          onChange={(value) => {
            setActive(value);
            setPage(0);
          }}
          options={[
            { value: "yes", label: "Active" },
            { value: "no", label: "Inactive" },
          ]}
          emptyLabel="All"
        />
      </SearchForm>
      {runner.error !== null && (
        <p
          role="alert"
          className="mb-3 rounded-md border border-danger/50 bg-danger-soft px-3 py-2 text-danger-fg"
        >
          {runner.error}
        </p>
      )}
      <ResourceBoundary state={list} what="customers">
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState title={q || active !== "yes" ? "No customer matches" : "No customers yet"}>
              {q
                ? "Try a different search."
                : "Customers you add here can be picked when placing an order at the counter."}
            </EmptyState>
          ) : (
            <Panel>
              <DataTable
                caption="Customers"
                head={["Name", "Company", "Phone", "Email", "Added", "Status", ""]}
              >
                {data.items.map((customer) => (
                  <tr key={customer.id}>
                    <td className="px-4 py-2 font-medium">{customer.name}</td>
                    <td className="px-4 py-2 text-muted">{customer.company ?? "-"}</td>
                    <td className="num px-4 py-2">{customer.phone ?? "-"}</td>
                    <td className="px-4 py-2 text-muted">{customer.email ?? "-"}</td>
                    <td className="px-4 py-2 text-muted">{formatDate(customer.createdAt)}</td>
                    <td className="px-4 py-2">
                      <Pill tone={customer.active ? "good" : "neutral"}>
                        {customer.active ? "Active" : "Inactive"}
                      </Pill>
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      {canEdit && (
                        <>
                          <Button
                            variant="ghost"
                            disabled={runner.busy}
                            onClick={() => setEditing(customer)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={runner.busy}
                            onClick={() =>
                              void runner.run(() =>
                                getApi().customers.update(customer.id, {
                                  active: !customer.active,
                                }),
                              )
                            }
                          >
                            {customer.active ? "Deactivate" : "Reactivate"}
                          </Button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </DataTable>
              <Pager page={page} pageSize={PAGE} total={data.total} onPage={setPage} />
            </Panel>
          )
        }
      </ResourceBoundary>
      {editing !== null && (
        <CustomerDialog
          shopId={shopId}
          customer={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={list.reload}
        />
      )}
    </>
  );
}

function CustomerDialog({
  shopId,
  customer,
  onClose,
  onSaved,
}: {
  shopId: string;
  customer?: Customer;
  onClose: () => void;
  onSaved: () => void;
}): ReactNode {
  const runner = useActionRunner(onSaved);
  const [form, setForm] = useState({
    name: customer?.name ?? "",
    company: customer?.company ?? "",
    phone: customer?.phone ?? "",
    email: customer?.email ?? "",
    address: customer?.address ?? "",
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
      title={customer ? `Edit ${customer.name}` : "Add customer"}
      submitLabel={customer ? "Save customer" : "Add customer"}
      busy={runner.busy}
      error={runner.error}
      onCancel={onClose}
      onSubmit={() => {
        setTouched(true);
        if (nameError || emailError) return;
        const body = {
          name: form.name.trim(),
          company: optionalText(form.company),
          phone: optionalText(form.phone),
          email: optionalText(form.email),
          address: optionalText(form.address),
        };
        void runner
          .run(() =>
            customer
              ? getApi().customers.update(customer.id, body)
              : getApi().customers.create(shopId, body),
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
        <TextField label="Company" value={form.company} onChange={set("company")} maxLength={200} />
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
        <TextField label="Address" value={form.address} onChange={set("address")} maxLength={500} />
      </div>
      {customer && (
        <p className="text-xs text-muted">
          Blank fields are left as they are: the system cannot clear a phone, email, company or
          address once set.
        </p>
      )}
    </FormDialog>
  );
}
