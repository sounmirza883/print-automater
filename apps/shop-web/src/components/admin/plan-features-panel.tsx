"use client";

import { useState, type ReactNode } from "react";
import type { PlanFeatureResponse } from "@print-automated/types";
import { CheckField, ErrorBanner, NumberField, TextField } from "@/components/form-kit";
import { FormDialog } from "@/components/modal";
import { useActionRunner } from "@/components/orders/use-action-runner";
import { ResourceBoundary } from "@/components/resource-boundary";
import { Button, DataTable, EmptyState, Notice, Panel, Pill } from "@/components/ui";
import { getApi } from "@/lib/api";
import { parseWholeNumber } from "@/lib/form-values";
import { MAX_SORT_ORDER } from "@/lib/plan-form";
import { useResource } from "@/lib/use-resource";

/** The rows of the public Compare plans table ("Printers", "Audit log", ...), defined
 * once here; each plan sets its own value per row from the plan's edit dialog. ADMIN
 * only (it is rendered inside PlansScreen, behind the same `isAdmin` gate). */
export function PlanFeaturesPanel(): ReactNode {
  const list = useResource(() => getApi().plan.listFeatures(), []);
  const runner = useActionRunner(list.reload);
  const [editing, setEditing] = useState<PlanFeatureResponse | "new" | null>(null);
  const [deleting, setDeleting] = useState<PlanFeatureResponse | null>(null);

  return (
    <>
      <Notice tone="accent" role="note" className="mb-4">
        These rows make up the Compare plans table on the public pricing page. Add a row here, then
        give each plan a value for it when you edit the plan. Rows that are marked &ldquo;On
        card&rdquo; also appear as bullets on each plan&apos;s pricing card.
      </Notice>
      <div className="mb-3 flex justify-end">
        <Button variant="primary" onClick={() => setEditing("new")}>
          Add feature
        </Button>
      </div>
      <ErrorBanner message={runner.error} />
      <ResourceBoundary state={list} what="feature rows">
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState
              title="No feature rows yet"
              action={
                <Button variant="primary" onClick={() => setEditing("new")}>
                  Add the first feature
                </Button>
              }
            >
              The Compare plans table stays empty until you add rows.
            </EmptyState>
          ) : (
            <Panel>
              <FeaturesTable features={data.items} onEdit={setEditing} onDelete={setDeleting} />
            </Panel>
          )
        }
      </ResourceBoundary>
      {editing !== null && (
        <FeatureDialog
          feature={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={list.reload}
        />
      )}
      {deleting !== null && (
        <DeleteFeatureDialog
          feature={deleting}
          onClose={() => setDeleting(null)}
          onChanged={list.reload}
        />
      )}
    </>
  );
}

function FeaturesTable({
  features,
  onEdit,
  onDelete,
}: {
  features: readonly PlanFeatureResponse[];
  onEdit: (feature: PlanFeatureResponse) => void;
  onDelete: (feature: PlanFeatureResponse) => void;
}): ReactNode {
  return (
    <DataTable
      caption="Feature rows"
      head={[
        "Section",
        "Feature",
        { label: "Order", align: "right" },
        "On card",
        "Card text",
        "Actions",
      ]}
    >
      {features.map((feature) => (
        <tr key={feature.id}>
          <td className="px-4 py-2">{feature.section}</td>
          <td className="px-4 py-2 font-medium">{feature.label}</td>
          <td className="num px-4 py-2 text-right">{feature.sortOrder}</td>
          <td className="px-4 py-2">
            {feature.showOnCard ? <Pill tone="good">Yes</Pill> : <Pill>No</Pill>}
          </td>
          <td className="px-4 py-2 text-xs text-muted">{feature.cardText ?? "-"}</td>
          <td className="px-4 py-2">
            <div className="flex flex-wrap gap-1">
              <Button variant="ghost" onClick={() => onEdit(feature)}>
                Edit<span className="sr-only"> {feature.label}</span>
              </Button>
              <Button variant="ghost" onClick={() => onDelete(feature)}>
                Delete<span className="sr-only"> {feature.label}</span>
              </Button>
            </div>
          </td>
        </tr>
      ))}
    </DataTable>
  );
}

interface FeatureForm {
  section: string;
  label: string;
  sortOrder: string;
  showOnCard: boolean;
  cardText: string;
}

function FeatureDialog({
  feature,
  onClose,
  onSaved,
}: {
  feature?: PlanFeatureResponse;
  onClose: () => void;
  onSaved: () => void;
}): ReactNode {
  const runner = useActionRunner(onSaved);
  const [form, setForm] = useState<FeatureForm>(() => ({
    section: feature?.section ?? "",
    label: feature?.label ?? "",
    sortOrder: String(feature?.sortOrder ?? 0),
    showOnCard: feature?.showOnCard ?? false,
    cardText: feature?.cardText ?? "",
  }));
  const [touched, setTouched] = useState(false);
  const section = form.section.trim();
  const label = form.label.trim();
  const sortOrder = parseWholeNumber(form.sortOrder, { min: 0, max: MAX_SORT_ORDER });
  const cardText = form.cardText.trim();
  const problems = {
    section: section === "" ? "Enter a section, such as Capacity." : undefined,
    label: label === "" ? "Enter a feature name, such as Printers." : undefined,
    sortOrder:
      sortOrder === undefined ? `Enter a whole number from 0 to ${MAX_SORT_ORDER}.` : undefined,
  };
  const valid = !problems.section && !problems.label && !problems.sortOrder;
  const shown: Partial<typeof problems> = touched ? problems : {};
  const unchanged =
    feature !== undefined &&
    feature.section === section &&
    feature.label === label &&
    feature.sortOrder === sortOrder &&
    feature.showOnCard === form.showOnCard &&
    (feature.cardText ?? "") === cardText;

  return (
    <FormDialog
      title={feature ? `Edit ${feature.label}` : "Add a feature"}
      submitLabel={feature ? "Save feature" : "Add feature"}
      busy={runner.busy}
      error={runner.error}
      disabled={unchanged}
      onCancel={onClose}
      onSubmit={() => {
        setTouched(true);
        if (!valid || sortOrder === undefined) return;
        void runner
          .run(() =>
            feature
              ? getApi().plan.updateFeature(feature.id, {
                  section,
                  label,
                  sortOrder,
                  showOnCard: form.showOnCard,
                  cardText: cardText === "" ? null : cardText,
                })
              : getApi().plan.createFeature({
                  section,
                  label,
                  sortOrder,
                  showOnCard: form.showOnCard,
                  ...(cardText !== "" && { cardText }),
                }),
          )
          .then((outcome) => outcome === "ok" && onClose());
      }}
    >
      <TextField
        label="Section"
        value={form.section}
        onChange={(value) => setForm((c) => ({ ...c, section: value }))}
        maxLength={60}
        error={shown.section}
        hint="The group heading in the table, such as Capacity or Support."
      />
      <TextField
        label="Feature"
        value={form.label}
        onChange={(value) => setForm((c) => ({ ...c, label: value }))}
        maxLength={100}
        error={shown.label}
      />
      <NumberField
        label="Display order"
        value={form.sortOrder}
        onChange={(value) => setForm((c) => ({ ...c, sortOrder: value }))}
        error={shown.sortOrder}
        hint="Lower numbers come first."
      />
      <CheckField
        label="Show on pricing cards"
        checked={form.showOnCard}
        onChange={(checked) => setForm((c) => ({ ...c, showOnCard: checked }))}
      />
      <TextField
        label="Card text (optional)"
        value={form.cardText}
        onChange={(value) => setForm((c) => ({ ...c, cardText: value }))}
        maxLength={120}
        hint="Use {value} where the plan's value goes, such as {value} printers. Leave blank to show the feature name."
      />
    </FormDialog>
  );
}

function DeleteFeatureDialog({
  feature,
  onClose,
  onChanged,
}: {
  feature: PlanFeatureResponse;
  onClose: () => void;
  onChanged: () => void;
}): ReactNode {
  const runner = useActionRunner(onChanged);
  return (
    <FormDialog
      title={`Delete ${feature.label}`}
      submitLabel="Delete feature"
      submitTone="danger"
      busy={runner.busy}
      error={runner.error}
      onCancel={onClose}
      onSubmit={() => {
        void runner
          .run(() => getApi().plan.deleteFeature(feature.id))
          .then((outcome) => outcome === "ok" && onClose());
      }}
    >
      <p>
        This removes the row from the Compare plans table, together with every plan&apos;s value for
        it. It cannot be undone.
      </p>
    </FormDialog>
  );
}
