"use client";

import { useState, type ReactNode } from "react";
import type { PlanDefinitionResponse } from "@print-automated/types";
import { ErrorBanner, NumberField, TextAreaField, TextField } from "@/components/form-kit";
import { FormDialog } from "@/components/modal";
import { useActionRunner } from "@/components/orders/use-action-runner";
import { ResourceBoundary } from "@/components/resource-boundary";
import { useSession } from "@/components/session-provider";
import {
  Button,
  DataTable,
  EmptyState,
  ForbiddenState,
  LiveStatus,
  PageHeader,
  Panel,
  Pill,
} from "@/components/ui";
import { getApi } from "@/lib/api";
import { formatCount, formatMoney, minorUnitDigits } from "@/lib/format";
import {
  EMPTY_PLAN_FORM,
  MAX_BILLING_PERIOD_DAYS,
  checkPlanForm,
  normalizeCurrency,
  planToForm,
  toUpdatePlanInput,
  type PlanForm,
} from "@/lib/plan-form";
import { PLAN_IN_USE_ADVICE, billingPeriodLabel, isPlanInUse } from "@/lib/plan-view";
import { useResource } from "@/lib/use-resource";

/** Plan management: every plan a business can be put on -- a name, a price in
 * a currency, and how many days one activation lasts -- with how many
 * businesses are on each. ADMIN only, the same `isAdmin` gate as
 * `BusinessesScreen`; the API answers 403 to anyone else. Assigning a plan to
 * a business happens on that business's page (or the Platform dashboard). */
export function PlansScreen(): ReactNode {
  const { isAdmin } = useSession();
  if (!isAdmin) {
    return <ForbiddenState what="plan management" />;
  }
  return <PlansBody />;
}

function PlansBody(): ReactNode {
  const list = useResource(() => getApi().plan.listDefinitions(), [], { intervalMs: 60_000 });
  const runner = useActionRunner(list.reload);
  const [editing, setEditing] = useState<PlanDefinitionResponse | "new" | null>(null);
  const [deleting, setDeleting] = useState<PlanDefinitionResponse | null>(null);

  return (
    <>
      <PageHeader
        title="Plans"
        subtitle="What businesses pay, and how long each activation lasts"
        actions={
          <>
            <LiveStatus
              lastUpdated={list.lastUpdated}
              refreshing={list.refreshing}
              onRefresh={list.reload}
            />
            <Button variant="primary" onClick={() => setEditing("new")}>
              Add plan
            </Button>
          </>
        }
      />
      <p
        role="note"
        className="mb-4 rounded-md border border-accent/40 bg-accent-soft px-3 py-2 text-sm"
      >
        There is no payment gateway: a plan&apos;s price records what the business pays, and you
        activate, renew or cancel a business&apos;s plan by hand from its own page or the Platform
        dashboard. Each activation adds the plan&apos;s billing period to the business&apos;s expiry
        date. Archive a plan to stop offering it without affecting the businesses already on it.
      </p>
      <ErrorBanner message={runner.error} />
      <ResourceBoundary state={list} what="plans">
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState
              title="No plans yet"
              action={
                <Button variant="primary" onClick={() => setEditing("new")}>
                  Add the first plan
                </Button>
              }
            >
              A business can only be activated on a plan, so add one before activating any business.
            </EmptyState>
          ) : (
            <Panel>
              <PlansTable
                plans={data.items}
                busy={runner.busy}
                onEdit={setEditing}
                onDelete={setDeleting}
                onToggleArchived={(plan) =>
                  void runner.run(() =>
                    getApi().plan.updateDefinition(plan.id, { archived: !plan.archived }),
                  )
                }
              />
            </Panel>
          )
        }
      </ResourceBoundary>
      {editing !== null && (
        <PlanDialog
          plan={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={list.reload}
        />
      )}
      {deleting !== null && (
        <DeletePlanDialog
          plan={deleting}
          onClose={() => setDeleting(null)}
          onChanged={list.reload}
        />
      )}
    </>
  );
}

/** The list itself, separate from loading so it renders from plain props. */
export function PlansTable({
  plans,
  busy,
  onEdit,
  onDelete,
  onToggleArchived,
}: {
  plans: readonly PlanDefinitionResponse[];
  busy: boolean;
  onEdit: (plan: PlanDefinitionResponse) => void;
  onDelete: (plan: PlanDefinitionResponse) => void;
  onToggleArchived: (plan: PlanDefinitionResponse) => void;
}): ReactNode {
  return (
    <DataTable
      caption="Plans"
      head={[
        "Plan",
        { label: "Price", align: "right" },
        "Billing period",
        { label: "Businesses", align: "right" },
        "Status",
        "Actions",
      ]}
    >
      {plans.map((plan) => (
        <tr key={plan.id}>
          <td className="px-4 py-2">
            <span className="font-medium">{plan.name}</span>
            {plan.description !== null && plan.description.trim() !== "" && (
              <span className="block max-w-md text-xs text-muted">{plan.description}</span>
            )}
          </td>
          <td className="num px-4 py-2 text-right whitespace-nowrap">
            {formatMoney(plan.priceMinor, plan.currency)}
          </td>
          <td className="px-4 py-2 whitespace-nowrap">
            {billingPeriodLabel(plan.billingPeriodDays)}
          </td>
          <td className="num px-4 py-2 text-right">{formatCount(plan.subscriberCount)}</td>
          <td className="px-4 py-2">
            {plan.archived ? <Pill>Archived</Pill> : <Pill tone="good">Offered</Pill>}
          </td>
          <td className="px-4 py-2">
            <div className="flex flex-wrap gap-1">
              <Button variant="ghost" disabled={busy} onClick={() => onEdit(plan)}>
                Edit<span className="sr-only"> {plan.name}</span>
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => onToggleArchived(plan)}>
                {plan.archived ? "Unarchive" : "Archive"}
                <span className="sr-only"> {plan.name}</span>
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => onDelete(plan)}>
                Delete<span className="sr-only"> {plan.name}</span>
              </Button>
            </div>
          </td>
        </tr>
      ))}
    </DataTable>
  );
}

function PlanDialog({
  plan,
  onClose,
  onSaved,
}: {
  plan?: PlanDefinitionResponse;
  onClose: () => void;
  onSaved: () => void;
}): ReactNode {
  const runner = useActionRunner(onSaved);
  const [form, setForm] = useState<PlanForm>(() => (plan ? planToForm(plan) : EMPTY_PLAN_FORM));
  const [touched, setTouched] = useState(false);
  const check = checkPlanForm(form);
  const problems = touched && !check.ok ? check.problems : {};
  const unchanged =
    plan !== undefined &&
    check.ok &&
    Object.keys(toUpdatePlanInput(plan, check.input)).length === 0;
  const set =
    (key: keyof PlanForm) =>
    (value: string): void =>
      setForm((current) => ({ ...current, [key]: value }));
  const currency = normalizeCurrency(form.currency);
  const digits = minorUnitDigits(currency);

  return (
    <FormDialog
      title={plan ? `Edit ${plan.name}` : "Add a plan"}
      submitLabel={plan ? "Save plan" : "Add plan"}
      busy={runner.busy}
      error={runner.error}
      disabled={unchanged}
      onCancel={onClose}
      onSubmit={() => {
        setTouched(true);
        if (!check.ok) return;
        void runner
          .run(() =>
            plan
              ? getApi().plan.updateDefinition(plan.id, toUpdatePlanInput(plan, check.input))
              : getApi().plan.createDefinition(check.input),
          )
          .then((outcome) => outcome === "ok" && onClose());
      }}
    >
      <TextField
        label="Name"
        value={form.name}
        onChange={set("name")}
        maxLength={100}
        error={problems.name}
      />
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
        <NumberField
          label="Price"
          value={form.price}
          onChange={set("price")}
          error={problems.price}
          hint={
            digits === null
              ? "In the plan's currency."
              : digits === 0
                ? `Whole ${currency}, such as 2500.`
                : `In ${currency}, such as 2500 or 2500.${"0".repeat(digits)}.`
          }
        />
        <TextField
          label="Currency"
          value={form.currency}
          onChange={(value) => set("currency")(value.toUpperCase())}
          maxLength={3}
          mono
          error={problems.currency}
          hint="3 letters, such as PKR."
        />
      </div>
      <NumberField
        label="Billing period (days)"
        value={form.billingPeriodDays}
        onChange={set("billingPeriodDays")}
        error={problems.billingPeriodDays}
        hint={`How long one activation or renewal lasts: 30 for monthly, 365 for yearly (at most ${MAX_BILLING_PERIOD_DAYS}).`}
      />
      <TextAreaField
        label="Description (optional)"
        value={form.description}
        onChange={set("description")}
        maxLength={500}
      />
      {plan !== undefined && plan.subscriberCount > 0 && (
        <p className="text-xs text-muted">
          {formatCount(plan.subscriberCount)}{" "}
          {plan.subscriberCount === 1 ? "business is" : "businesses are"} on this plan and will show
          the new details. A new billing period applies from each business&apos;s next activation or
          renewal; expiry dates already set do not move.
        </p>
      )}
    </FormDialog>
  );
}

/** Delete is permanent, so it is confirmed first. The API refuses it (409)
 * while any business is still assigned to the plan; its message says how many,
 * and the dialog then offers the non-destructive way out: archive instead. */
function DeletePlanDialog({
  plan,
  onClose,
  onChanged,
}: {
  plan: PlanDefinitionResponse;
  onClose: () => void;
  onChanged: () => void;
}): ReactNode {
  const runner = useActionRunner(onChanged);
  const [inUse, setInUse] = useState(false);
  const archiveInstead = inUse && !plan.archived;

  return (
    <FormDialog
      title={`Delete ${plan.name}`}
      submitLabel={archiveInstead ? "Archive instead" : "Delete plan"}
      submitTone={archiveInstead ? "primary" : "danger"}
      busy={runner.busy}
      error={runner.error}
      disabled={inUse && plan.archived}
      onCancel={onClose}
      onSubmit={() => {
        if (archiveInstead) {
          void runner
            .run(() => getApi().plan.updateDefinition(plan.id, { archived: true }))
            .then((outcome) => outcome === "ok" && onClose());
          return;
        }
        let failure: unknown = null;
        void runner
          .run(async () => {
            try {
              await getApi().plan.deleteDefinition(plan.id);
            } catch (error) {
              failure = error;
              throw error;
            }
          })
          .then((outcome) => {
            if (outcome === "ok") {
              onClose();
            } else if (isPlanInUse(failure)) {
              setInUse(true);
              // The count on screen was out of date; show the real one.
              onChanged();
            }
          });
      }}
    >
      {inUse ? (
        <p role="note">
          {PLAN_IN_USE_ADVICE}
          {plan.archived &&
            " This plan is already archived; it can be deleted once no business is on it."}
        </p>
      ) : (
        <>
          <p>This permanently deletes the plan. It cannot be undone.</p>
          {plan.subscriberCount > 0 && (
            <p className="text-caution-fg">
              {formatCount(plan.subscriberCount)}{" "}
              {plan.subscriberCount === 1 ? "business is" : "businesses are"} on this plan, so the
              delete will be refused until no business is on it. To stop offering it now, archive it
              instead.
            </p>
          )}
        </>
      )}
    </FormDialog>
  );
}
