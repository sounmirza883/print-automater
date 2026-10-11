"use client";

import { useState, type ReactNode } from "react";
import type { PlanDefinitionResponse, PlanFeatureResponse } from "@print-automated/types";
import {
  CheckField,
  ErrorBanner,
  NumberField,
  SelectField,
  TextAreaField,
  TextField,
} from "@/components/form-kit";
import { FormDialog } from "@/components/modal";
import { PlanFeaturesPanel } from "@/components/admin/plan-features-panel";
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
  modeToValue,
  normalizeCurrency,
  planToForm,
  toUpdatePlanInput,
  valueMode,
  type PlanForm,
  type ValueMode,
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
  const [tab, setTab] = useState<"plans" | "features">("plans");

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
            {tab === "plans" && (
              <Button variant="primary" onClick={() => setEditing("new")}>
                Add plan
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 flex gap-2">
        <Button variant={tab === "plans" ? "primary" : "ghost"} onClick={() => setTab("plans")}>
          Plans
        </Button>
        <Button
          variant={tab === "features" ? "primary" : "ghost"}
          onClick={() => setTab("features")}
        >
          Features
        </Button>
      </div>
      {tab === "features" ? (
        <PlanFeaturesPanel />
      ) : (
        <>
          <p
            role="note"
            className="mb-4 rounded-md border border-accent/40 bg-accent-soft px-3 py-2 text-sm"
          >
            There is no payment gateway: a plan&apos;s price records what the business pays, and you
            activate, renew or cancel a business&apos;s plan by hand from its own page or the
            Platform dashboard. Each activation adds the plan&apos;s billing period to the
            business&apos;s expiry date. Archive a plan to stop offering it without affecting the
            businesses already on it. What you enter here is also what the public pricing page
            shows.
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
                  A business can only be activated on a plan, so add one before activating any
                  business.
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
        </>
      )}
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
        { label: "Annual", align: "right" },
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
            {plan.highlighted && (
              <>
                {" "}
                <Pill tone="good">Most popular</Pill>
              </>
            )}
            {plan.description !== null && plan.description.trim() !== "" && (
              <span className="block max-w-md text-xs text-muted">{plan.description}</span>
            )}
          </td>
          <td className="num px-4 py-2 text-right whitespace-nowrap">
            {plan.contactOnly ? "Custom" : formatMoney(plan.priceMinor, plan.currency)}
          </td>
          <td className="num px-4 py-2 text-right whitespace-nowrap">
            {plan.contactOnly
              ? "Custom"
              : plan.annualPriceMinor === null
                ? "-"
                : formatMoney(plan.annualPriceMinor, plan.currency)}
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
  const features = useResource(() => getApi().plan.listFeatures(), []);
  const setValue = (featureId: string, value: string): void =>
    setForm((current) => ({ ...current, values: { ...current.values, [featureId]: value } }));

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
      <NumberField
        label="Annual price (optional)"
        value={form.annualPrice}
        onChange={set("annualPrice")}
        error={problems.annualPrice}
        hint="Price for a whole year. The website shows the monthly price x 12 struck out next to it. Leave blank for no annual option."
      />
      <NumberField
        label="Display order"
        value={form.sortOrder}
        onChange={set("sortOrder")}
        error={problems.sortOrder}
        hint="Lower numbers come first on the pricing page."
      />
      <CheckField
        label="Most popular"
        checked={form.highlighted}
        onChange={(checked) => setForm((current) => ({ ...current, highlighted: checked }))}
        hint="Shows a Most popular badge and highlights this plan on the pricing page."
      />
      <CheckField
        label="Contact us (custom pricing)"
        checked={form.contactOnly}
        onChange={(checked) => setForm((current) => ({ ...current, contactOnly: checked }))}
        hint="Hides the price: the pricing card says Custom pricing and offers a Contact us button."
      />
      <TextAreaField
        label="Description (optional)"
        value={form.description}
        onChange={set("description")}
        maxLength={500}
      />
      <ResourceBoundary state={features} what="feature rows">
        {(data) => (
          <FeatureValuesEditor features={data.items} values={form.values} onChange={setValue} />
        )}
      </ResourceBoundary>
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

const MODE_OPTIONS: ReadonlyArray<{ value: ValueMode; label: string }> = [
  { value: "yes", label: "Included (tick)" },
  { value: "no", label: "Not included (dash)" },
  { value: "text", label: "Custom value" },
];

/** One row per Compare-table feature: this plan's cell is a tick, a dash, or custom
 * text such as "10" or "Unlimited". Rows are defined on the Features tab. */
function FeatureValuesEditor({
  features,
  values,
  onChange,
}: {
  features: readonly PlanFeatureResponse[];
  values: Record<string, string>;
  onChange: (featureId: string, value: string) => void;
}): ReactNode {
  if (features.length === 0) {
    return (
      <p className="text-xs text-muted">
        The Compare plans table has no rows yet. Add some on the Features tab, then set this
        plan&apos;s values here.
      </p>
    );
  }
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">Compare plans table</legend>
      {features.map((feature) => {
        const value = values[feature.id] ?? "";
        const mode = valueMode(value);
        return (
          <div key={feature.id} className="grid gap-2 sm:grid-cols-[1fr_12rem_8rem] sm:items-end">
            <span className="text-sm">
              <span className="block text-xs text-muted">{feature.section}</span>
              {feature.label}
            </span>
            <SelectField
              label={`${feature.label}: value type`}
              value={mode}
              onChange={(next) =>
                onChange(feature.id, modeToValue(next as ValueMode, mode === "text" ? value : ""))
              }
              options={MODE_OPTIONS}
            />
            {mode === "text" && (
              <TextField
                label={`${feature.label}: value`}
                value={value}
                onChange={(next) => onChange(feature.id, next)}
                maxLength={60}
              />
            )}
          </div>
        );
      })}
    </fieldset>
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
