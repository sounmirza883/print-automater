"use client";

import { useState, type ReactNode } from "react";
import type { PricingRule } from "@print-automated/api-client";
import { Field, INPUT, NumberField, TextField } from "@/components/form-kit";
import { FormDialog } from "@/components/modal";
import { useActionRunner } from "@/components/orders/use-action-runner";
import { ResourceBoundary } from "@/components/resource-boundary";
import { useSession } from "@/components/session-provider";
import { Button, DataTable, EmptyState, LiveStatus, Panel, Pill } from "@/components/ui";
import { getApi } from "@/lib/api";
import { formatDateTime, formatMoney, humanizeEnum } from "@/lib/format";
import { basisPointsToPercent } from "@/lib/form-values";
import {
  CHARGE_FINISHINGS,
  SURCHARGE_PAPER_SIZES,
  SURCHARGE_PAPER_TYPES,
  buildPricingInput,
  emptyPricingForm,
  newCharge,
  ruleToForm,
  type PricingForm,
} from "@/lib/pricing-view";
import { useResource } from "@/lib/use-resource";

/** Pricing rules are VERSIONED: saving creates a new version that applies
 * to new quotes; there is no edit or delete, and confirmed orders keep the
 * price they were quoted. The newest version is the live one. */
export function PricingTab(): ReactNode {
  const { business } = useSession();
  const shopId = business?.id ?? "";
  const list = useResource(() => getApi().pricingRules.list(shopId, { limit: 50 }), [shopId], {
    enabled: shopId !== "",
  });
  const [editing, setEditing] = useState(false);
  const latest = list.data?.items[0];

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
        <LiveStatus
          lastUpdated={list.lastUpdated}
          refreshing={list.refreshing}
          onRefresh={list.reload}
        />
        <Button variant="primary" onClick={() => setEditing(true)}>
          {latest ? "Create a new version" : "Set prices"}
        </Button>
      </div>
      <ResourceBoundary state={list} what="pricing rules">
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState title="No prices set yet">
              Set a price per page (and any surcharges) so customers can get quotes.
            </EmptyState>
          ) : (
            <div className="grid gap-4">
              <RuleSummary rule={data.items[0] as PricingRule} current />
              {data.items.length > 1 && (
                <Panel title="Earlier versions" id="history">
                  <DataTable
                    caption="Earlier pricing versions"
                    head={["Version", "Saved", "Per page", "Colour", "Minimum", "Tax"]}
                  >
                    {data.items.slice(1).map((rule) => (
                      <tr key={rule.id}>
                        <td className="num px-4 py-2">v{rule.version}</td>
                        <td className="px-4 py-2 text-muted">{formatDateTime(rule.createdAt)}</td>
                        <td className="num px-4 py-2 text-right">
                          {formatMoney(rule.pricePerPageMinor, rule.currency)}
                        </td>
                        <td className="num px-4 py-2 text-right">
                          {formatMoney(rule.colorSurchargePerPageMinor, rule.currency)}
                        </td>
                        <td className="num px-4 py-2 text-right">
                          {formatMoney(rule.minimumChargeMinor, rule.currency)}
                        </td>
                        <td className="num px-4 py-2 text-right">
                          {rule.taxRateBasisPoints === null
                            ? "-"
                            : `${basisPointsToPercent(rule.taxRateBasisPoints)}%`}
                        </td>
                      </tr>
                    ))}
                  </DataTable>
                </Panel>
              )}
            </div>
          )
        }
      </ResourceBoundary>
      {editing && (
        <RuleDialog
          shopId={shopId}
          base={latest}
          onClose={() => setEditing(false)}
          onSaved={list.reload}
        />
      )}
    </>
  );
}

function mapRows(map: Record<string, number> | null, currency: string): ReactNode {
  const entries = Object.entries(map ?? {});
  if (entries.length === 0) return <span className="text-muted">None</span>;
  return entries
    .map(([key, value]) => `${humanizeEnum(key)} ${formatMoney(value, currency)}`)
    .join(" · ");
}

function RuleSummary({ rule, current }: { rule: PricingRule; current?: boolean }): ReactNode {
  return (
    <Panel
      title={`Version ${rule.version}`}
      id="current"
      aside={current ? <Pill tone="good">Live for new orders</Pill> : undefined}
    >
      <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <Row label="Price per page">{formatMoney(rule.pricePerPageMinor, rule.currency)}</Row>
        <Row label="Colour surcharge, per page">
          {formatMoney(rule.colorSurchargePerPageMinor, rule.currency)}
        </Row>
        <Row label="Minimum charge">{formatMoney(rule.minimumChargeMinor, rule.currency)}</Row>
        <Row label="Tax">
          {rule.taxRateBasisPoints === null
            ? "Business default"
            : `${basisPointsToPercent(rule.taxRateBasisPoints)}%`}
        </Row>
        <Row label="Paper size surcharges, per page">
          {mapRows(rule.paperSizeSurchargePerPageMinor, rule.currency)}
        </Row>
        <Row label="Paper type surcharges, per page">
          {mapRows(rule.paperTypeSurchargePerPageMinor, rule.currency)}
        </Row>
        <Row label="Finishing charges">{mapRows(rule.finishingChargeMinor, rule.currency)}</Row>
        <Row label="Other charges">
          {rule.otherCharges.length === 0 ? (
            <span className="text-muted">None</span>
          ) : (
            rule.otherCharges
              .map((c) => `${c.label} ${formatMoney(c.amountMinor, rule.currency)}`)
              .join(" · ")
          )}
        </Row>
      </dl>
      <p className="mt-3 text-xs text-muted">
        Saved {formatDateTime(rule.createdAt)} in {rule.currency}.
      </p>
    </Panel>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="num">{children}</dd>
    </div>
  );
}

function RuleDialog({
  shopId,
  base,
  onClose,
  onSaved,
}: {
  shopId: string;
  base?: PricingRule;
  onClose: () => void;
  onSaved: () => void;
}): ReactNode {
  const runner = useActionRunner(onSaved);
  const [form, setForm] = useState<PricingForm>(() =>
    base ? ruleToForm(base) : emptyPricingForm(),
  );
  const [touched, setTouched] = useState(false);
  const check = buildPricingInput(form);
  const errors = touched && !check.ok ? check.errors : {};
  const set =
    (key: "currency" | "pricePerPage" | "colorSurcharge" | "minimumCharge" | "taxPercent") =>
    (value: string): void =>
      setForm({ ...form, [key]: value });
  const setMap = (
    group: "sizeSurcharges" | "typeSurcharges" | "finishingCharges",
    key: string,
    value: string,
  ): void => setForm({ ...form, [group]: { ...form[group], [key]: value } });

  return (
    <FormDialog
      title={base ? `New version (after v${base.version})` : "Set prices"}
      submitLabel="Save as new version"
      busy={runner.busy}
      error={runner.error}
      onCancel={onClose}
      onSubmit={() => {
        setTouched(true);
        if (!check.ok) return;
        void runner
          .run(() => getApi().pricingRules.create(shopId, check.input))
          .then((o) => o === "ok" && onClose());
      }}
    >
      <p className="rounded-md border border-accent/40 bg-accent-soft px-3 py-2 text-xs">
        This saves a NEW version for new quotes. Orders already confirmed keep the price they were
        quoted.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label="Currency"
          value={form.currency}
          onChange={set("currency")}
          error={errors.currency}
          maxLength={3}
          mono
        />
        <NumberField
          label="Price per page"
          value={form.pricePerPage}
          onChange={set("pricePerPage")}
          error={errors.pricePerPage}
        />
        <NumberField
          label="Colour surcharge, per page"
          value={form.colorSurcharge}
          onChange={set("colorSurcharge")}
          error={errors.colorSurcharge}
        />
        <NumberField
          label="Minimum charge"
          value={form.minimumCharge}
          onChange={set("minimumCharge")}
          error={errors.minimumCharge}
        />
        <NumberField
          label="Tax rate (%)"
          value={form.taxPercent}
          onChange={set("taxPercent")}
          error={errors.taxPercent}
          hint="Blank uses the business default."
        />
      </div>
      <SurchargeGroup
        title="Paper size surcharge, per page"
        keys={SURCHARGE_PAPER_SIZES}
        group="sizeSurcharges"
        form={form}
        errors={errors}
        errPrefix="size"
        onChange={setMap}
      />
      <SurchargeGroup
        title="Paper type surcharge, per page"
        keys={SURCHARGE_PAPER_TYPES}
        group="typeSurcharges"
        form={form}
        errors={errors}
        errPrefix="type"
        onChange={setMap}
      />
      <SurchargeGroup
        title="Finishing charge"
        keys={CHARGE_FINISHINGS}
        group="finishingCharges"
        form={form}
        errors={errors}
        errPrefix="finishing"
        onChange={setMap}
      />
      <div className="grid gap-2">
        <span className="font-medium">Other charges</span>
        {form.otherCharges.map((charge) => (
          <div
            key={charge.key}
            className="grid grid-cols-[minmax(0,1fr)_7rem_auto] items-start gap-2"
          >
            <input
              aria-label="Charge name"
              value={charge.label}
              placeholder="Name, e.g. Rush"
              onChange={(e) =>
                setForm({
                  ...form,
                  otherCharges: form.otherCharges.map((c) =>
                    c.key === charge.key ? { ...c, label: e.target.value } : c,
                  ),
                })
              }
              className={INPUT}
            />
            <input
              aria-label="Charge amount"
              inputMode="decimal"
              value={charge.amount}
              placeholder="Amount"
              onChange={(e) =>
                setForm({
                  ...form,
                  otherCharges: form.otherCharges.map((c) =>
                    c.key === charge.key ? { ...c, amount: e.target.value } : c,
                  ),
                })
              }
              className={`${INPUT} num`}
            />
            <Button
              variant="ghost"
              onClick={() =>
                setForm({
                  ...form,
                  otherCharges: form.otherCharges.filter((c) => c.key !== charge.key),
                })
              }
            >
              Remove
            </Button>
            {errors[`other.${charge.key}`] && (
              <p role="alert" className="col-span-3 text-xs text-danger-fg">
                {errors[`other.${charge.key}`]}
              </p>
            )}
          </div>
        ))}
        <div>
          <Button
            onClick={() => setForm({ ...form, otherCharges: [...form.otherCharges, newCharge()] })}
          >
            Add a charge
          </Button>
        </div>
      </div>
    </FormDialog>
  );
}

function SurchargeGroup({
  title,
  keys,
  group,
  form,
  errors,
  errPrefix,
  onChange,
}: {
  title: string;
  keys: readonly string[];
  group: "sizeSurcharges" | "typeSurcharges" | "finishingCharges";
  form: PricingForm;
  errors: Record<string, string>;
  errPrefix: string;
  onChange: (
    group: "sizeSurcharges" | "typeSurcharges" | "finishingCharges",
    key: string,
    value: string,
  ) => void;
}): ReactNode {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 font-medium">{title}</legend>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {keys.map((key) => (
          <Field key={key} label={humanizeEnum(key)} error={errors[`${errPrefix}.${key}`]}>
            <input
              inputMode="decimal"
              value={form[group][key] ?? ""}
              placeholder="none"
              onChange={(event) => onChange(group, key, event.target.value)}
              className={`${INPUT} num`}
            />
          </Field>
        ))}
      </div>
    </fieldset>
  );
}
