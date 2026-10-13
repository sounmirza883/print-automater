"use client";

import { useState, type ReactNode } from "react";
import type { PrinterResponse, PrinterRule } from "@print-automated/api-client";
import { Permission } from "@print-automated/types";
import {
  CheckField,
  ErrorBanner,
  SelectField,
  TextField,
  NumberField,
} from "@/components/form-kit";
import { FormDialog } from "@/components/modal";
import { useActionRunner } from "@/components/orders/use-action-runner";
import { RequirePermission, ResourceBoundary } from "@/components/resource-boundary";
import { useSession } from "@/components/session-provider";
import {
  BackLink,
  Button,
  EmptyState,
  LiveStatus,
  Notice,
  PageHeader,
  Panel,
  Pill,
} from "@/components/ui";
import { getApi } from "@/lib/api";
import { humanizeEnum } from "@/lib/format";
import {
  MAX_RULES,
  RULE_CONDITION_OPTIONS,
  buildRuleInput,
  describeConditions,
  emptyRuleForm,
  moveRule,
  ruleToForm,
  type RuleForm,
} from "@/lib/printer-rules-view";
import { useResource } from "@/lib/use-resource";

/** PRD 77: ordered rules that steer automatic printer choice. Anyone who can
 * view settings sees them; changing them needs MANAGE_AUTOMATION (owner,
 * manager). A rule PREFERs or AVOIDs a set of printers for jobs that match
 * its conditions. Rules are read top to bottom, apply only to automatic
 * choices (a printer named on a job, or picked by hand, always wins), and
 * are skipped if following them would leave no printer for the job. */
export function PrinterRulesScreen(): ReactNode {
  return (
    <RequirePermission permission={Permission.VIEW_SETTINGS} what="printer rules">
      <RulesBody />
    </RequirePermission>
  );
}

function RulesBody(): ReactNode {
  const { business, can } = useSession();
  const shopId = business?.id ?? "";
  const canManage = can(Permission.MANAGE_AUTOMATION);
  const rules = useResource(() => getApi().printerRules.list(shopId), [shopId], {
    enabled: shopId !== "",
  });
  const printers = useResource(() => getApi().printers.listPage(shopId, { limit: 100 }), [shopId], {
    enabled: shopId !== "",
  });
  const runner = useActionRunner(rules.reload);
  const [editing, setEditing] = useState<PrinterRule | "new" | null>(null);
  const [removing, setRemoving] = useState<PrinterRule | null>(null);
  const printerName = (id: string): string =>
    printers.data?.items.find((p) => p.id === id)?.name ?? "Unknown printer";

  return (
    <>
      <BackLink href="/settings">Settings</BackLink>
      <PageHeader
        title="Printer rules"
        subtitle="Steer which printers new jobs prefer or avoid"
        actions={
          <>
            <LiveStatus
              lastUpdated={rules.lastUpdated}
              refreshing={rules.refreshing}
              onRefresh={rules.reload}
            />
            {canManage && (
              <Button variant="primary" onClick={() => setEditing("new")}>
                Add rule
              </Button>
            )}
          </>
        }
      />
      <Notice tone="accent" role="note" className="mb-4">
        Rules are checked from the top. <strong>Prefer</strong> tries those printers first for
        matching jobs; <strong>avoid</strong> uses them only if nothing else can do the job. A
        printer named on a job, or chosen by hand, always wins, and a rule that would leave no
        printer is skipped. Rules never move a job that is already printing. Up to {MAX_RULES}{" "}
        rules.
      </Notice>
      <ErrorBanner message={runner.error} />
      <ResourceBoundary state={rules} what="printer rules">
        {(data) =>
          data.length === 0 ? (
            <EmptyState
              title="No rules yet"
              action={
                canManage ? (
                  <Button variant="primary" onClick={() => setEditing("new")}>
                    Add the first rule
                  </Button>
                ) : undefined
              }
            >
              With no rules, printers are chosen by capability, availability and load alone.
            </EmptyState>
          ) : (
            <ol className="grid gap-3" aria-label="Printer rules in order">
              {data.map((rule, index) => (
                <li key={rule.id}>
                  <Panel tone={rule.enabled ? "neutral" : "neutral"}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 font-semibold">
                          <span className="num text-muted">{index + 1}.</span>
                          {rule.name}
                          <Pill tone={rule.action === "PREFER" ? "good" : "caution"}>
                            {humanizeEnum(rule.action)}
                          </Pill>
                          {!rule.enabled && <Pill>Off</Pill>}
                        </p>
                        <p className="text-sm text-muted">{describeConditions(rule.conditions)}</p>
                        <p className="text-sm">{rule.printerIds.map(printerName).join(", ")}</p>
                      </div>
                      {canManage && (
                        <div className="flex flex-wrap gap-1">
                          <Button
                            variant="ghost"
                            disabled={runner.busy || index === 0}
                            onClick={() =>
                              void runner.run(() =>
                                getApi().printerRules.reorder(
                                  shopId,
                                  moveRule(
                                    data.map((r) => r.id),
                                    rule.id,
                                    -1,
                                  ),
                                ),
                              )
                            }
                          >
                            Move up
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={runner.busy || index === data.length - 1}
                            onClick={() =>
                              void runner.run(() =>
                                getApi().printerRules.reorder(
                                  shopId,
                                  moveRule(
                                    data.map((r) => r.id),
                                    rule.id,
                                    1,
                                  ),
                                ),
                              )
                            }
                          >
                            Move down
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={runner.busy}
                            onClick={() =>
                              void runner.run(() =>
                                getApi().printerRules.update(rule.id, rule.version, {
                                  enabled: !rule.enabled,
                                }),
                              )
                            }
                          >
                            {rule.enabled ? "Turn off" : "Turn on"}
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={runner.busy}
                            onClick={() => setEditing(rule)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={runner.busy}
                            onClick={() => setRemoving(rule)}
                          >
                            Delete
                          </Button>
                        </div>
                      )}
                    </div>
                  </Panel>
                </li>
              ))}
            </ol>
          )
        }
      </ResourceBoundary>
      {!canManage && (
        <p className="mt-3 text-xs text-muted">
          Rules can only be changed by the owner or a manager.
        </p>
      )}
      {editing !== null && (
        <RuleDialog
          shopId={shopId}
          rule={editing === "new" ? undefined : editing}
          printers={printers.data?.items ?? []}
          onClose={() => setEditing(null)}
          onSaved={rules.reload}
        />
      )}
      {removing !== null && (
        <FormDialog
          title={`Delete "${removing.name}"`}
          submitLabel="Delete rule"
          submitTone="danger"
          busy={runner.busy}
          error={runner.error}
          onCancel={() => setRemoving(null)}
          onSubmit={() =>
            void runner
              .run(() => getApi().printerRules.remove(removing.id))
              .then((o) => o === "ok" && setRemoving(null))
          }
        >
          <p>Jobs are no longer steered by this rule. Jobs already allocated are not moved.</p>
        </FormDialog>
      )}
    </>
  );
}

function RuleDialog({
  shopId,
  rule,
  printers,
  onClose,
  onSaved,
}: {
  shopId: string;
  rule?: PrinterRule;
  printers: PrinterResponse[];
  onClose: () => void;
  onSaved: () => void;
}): ReactNode {
  const runner = useActionRunner(onSaved);
  const [form, setForm] = useState<RuleForm>(() => (rule ? ruleToForm(rule) : emptyRuleForm()));
  const [touched, setTouched] = useState(false);
  const check = buildRuleInput(form);
  const errors = touched && !check.ok ? check.errors : {};
  const set =
    (key: keyof RuleForm) =>
    (value: string): void =>
      setForm({ ...form, [key]: value });
  const options = (values: readonly string[]) =>
    values.map((value) => ({ value, label: humanizeEnum(value) }));

  return (
    <FormDialog
      title={rule ? `Edit ${rule.name}` : "Add printer rule"}
      submitLabel={rule ? "Save rule" : "Add rule"}
      busy={runner.busy}
      error={runner.error}
      onCancel={onClose}
      onSubmit={() => {
        setTouched(true);
        if (!check.ok) return;
        void runner
          .run(() =>
            rule
              ? getApi().printerRules.update(rule.id, rule.version, check.input)
              : getApi().printerRules.create(shopId, check.input),
          )
          .then((outcome) => outcome === "ok" && onClose());
      }}
    >
      <TextField
        label="Name"
        value={form.name}
        onChange={set("name")}
        error={errors.name}
        maxLength={80}
      />
      <SelectField
        label="Action"
        value={form.action}
        onChange={(value) => setForm({ ...form, action: value as RuleForm["action"] })}
        options={[
          { value: "PREFER", label: "Prefer these printers" },
          { value: "AVOID", label: "Avoid these printers" },
        ]}
      />
      <fieldset className="grid gap-1">
        <legend className="mb-1 font-medium">Printers</legend>
        {printers.length === 0 && <p className="text-muted">Loading printers…</p>}
        {printers.map((printer) => (
          <CheckField
            key={printer.id}
            label={printer.name}
            checked={form.printerIds.includes(printer.id)}
            onChange={(checked) =>
              setForm({
                ...form,
                printerIds: checked
                  ? [...form.printerIds, printer.id]
                  : form.printerIds.filter((id) => id !== printer.id),
              })
            }
          />
        ))}
        {errors.printerIds && (
          <p role="alert" className="text-xs text-danger-fg">
            {errors.printerIds}
          </p>
        )}
      </fieldset>
      <fieldset className="grid gap-3">
        <legend className="mb-1 font-medium">Applies to jobs with (leave blank for any)</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="Paper size"
            value={form.paperSize}
            onChange={set("paperSize")}
            options={options(RULE_CONDITION_OPTIONS.paperSize)}
            emptyLabel="Any"
          />
          <SelectField
            label="Paper type"
            value={form.paperType}
            onChange={set("paperType")}
            options={options(RULE_CONDITION_OPTIONS.paperType)}
            emptyLabel="Any"
          />
          <SelectField
            label="Colour"
            value={form.color}
            onChange={set("color")}
            options={[
              { value: "COLOR", label: "Colour" },
              { value: "BW", label: "Black and white" },
            ]}
            emptyLabel="Any"
          />
          <SelectField
            label="Sides"
            value={form.sides}
            onChange={set("sides")}
            options={[
              { value: "SINGLE", label: "Single-sided" },
              { value: "DOUBLE", label: "Double-sided" },
            ]}
            emptyLabel="Any"
          />
          <NumberField
            label="At least this many pages"
            value={form.minPages}
            onChange={set("minPages")}
            error={errors.minPages}
          />
          <NumberField
            label="At most this many pages"
            value={form.maxPages}
            onChange={set("maxPages")}
            error={errors.maxPages}
          />
        </div>
      </fieldset>
      <CheckField
        label="Rule is on"
        checked={form.enabled}
        onChange={(checked) => setForm({ ...form, enabled: checked })}
      />
    </FormDialog>
  );
}
