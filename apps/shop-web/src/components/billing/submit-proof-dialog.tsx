"use client";

import { useState, type ChangeEvent, type ReactNode } from "react";
import type { BillingPlanOption, PaymentProofResponse } from "@print-automated/types";
import { Field, INPUT, NumberField, SelectField, TextField } from "@/components/form-kit";
import { FormDialog } from "@/components/modal";
import { useActionRunner } from "@/components/orders/use-action-runner";
import { getApi } from "@/lib/api";
import {
  PROOF_ACCEPT_ATTRIBUTE,
  fileToBase64,
  isProofContentType,
  validateSubmission,
} from "@/lib/billing-view";
import { formatMoney, minorToInput } from "@/lib/format";

const noop = (): void => undefined;

/** The owner's "I paid" form: which plan, how much, the transaction reference and the
 * screenshot/PDF. Problems are shown per field before anything is sent; the API re-checks
 * the file's real bytes. The money moved outside the app -- this only reports it. */
export function SubmitProofDialog({
  shopId,
  plans,
  onSubmitted,
  onCancel,
}: {
  shopId: string;
  plans: readonly BillingPlanOption[];
  onSubmitted: (proof: PaymentProofResponse) => void;
  onCancel: () => void;
}): ReactNode {
  const firstPlan = plans[0];
  const [planId, setPlanId] = useState(firstPlan?.id ?? "");
  const [amountText, setAmountText] = useState(
    firstPlan ? minorToInput(firstPlan.priceMinor, firstPlan.currency) : "",
  );
  const [transactionRef, setTransactionRef] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const runner = useActionRunner(noop);

  const form = { planDefinitionId: planId, amountText, transactionRef, file };
  const { errors, amountMinor } = validateSubmission(form, plans);
  const selectedPlan = plans.find((plan) => plan.id === planId);

  function choosePlan(id: string): void {
    setPlanId(id);
    // Suggest the plan's price; the owner corrects it if they paid something else.
    const plan = plans.find((candidate) => candidate.id === id);
    if (plan) {
      setAmountText(minorToInput(plan.priceMinor, plan.currency));
    }
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>): void {
    setFile(event.target.files?.[0] ?? null);
  }

  function submit(): void {
    setShowErrors(true);
    if (Object.keys(errors).length > 0 || amountMinor === null || file === null) {
      return;
    }
    if (!isProofContentType(file.type)) {
      return;
    }
    const contentType = file.type;
    let created: PaymentProofResponse | null = null;
    void runner
      .run(async () => {
        created = await getApi().paymentProofs.submit({
          shopId,
          planDefinitionId: planId,
          amountMinor,
          transactionRef: transactionRef.trim(),
          fileName: file.name,
          fileContentType: contentType,
          fileBase64: await fileToBase64(file),
        });
      })
      .then((outcome) => {
        if (outcome === "ok" && created !== null) {
          onSubmitted(created);
        }
      });
  }

  const shown = (key: keyof typeof errors): string | null =>
    showErrors ? (errors[key] ?? null) : null;

  return (
    <FormDialog
      title="Submit payment proof"
      submitLabel="Submit for review"
      busy={runner.busy}
      error={runner.error}
      onSubmit={submit}
      onCancel={onCancel}
    >
      <p className="text-muted">
        Pay using the details shown on the Billing page, then upload your receipt here. We check it
        and activate your plan.
      </p>
      <SelectField
        label="Plan you paid for"
        value={planId}
        onChange={choosePlan}
        options={plans.map((plan) => ({
          value: plan.id,
          label: `${plan.name} — ${formatMoney(plan.priceMinor, plan.currency)}`,
        }))}
      />
      {shown("plan") !== null && <p className="text-xs text-danger-fg">{shown("plan")}</p>}
      <NumberField
        label={`Amount you paid${selectedPlan ? ` (${selectedPlan.currency})` : ""}`}
        value={amountText}
        onChange={setAmountText}
        error={shown("amount")}
      />
      <TextField
        label="Transaction or reference number"
        value={transactionRef}
        onChange={setTransactionRef}
        maxLength={100}
        mono
        error={shown("transactionRef")}
      />
      <Field
        label="Screenshot or PDF of the payment"
        hint="JPEG, PNG or PDF, up to 5 MB."
        error={shown("file")}
      >
        <input
          type="file"
          accept={PROOF_ACCEPT_ATTRIBUTE}
          onChange={chooseFile}
          aria-invalid={shown("file") ? true : undefined}
          className={INPUT}
        />
      </Field>
    </FormDialog>
  );
}
