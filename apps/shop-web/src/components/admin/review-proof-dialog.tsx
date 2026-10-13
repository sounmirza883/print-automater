"use client";

import { useState, type ReactNode } from "react";
import type { PaymentProofResponse, PlanDefinitionResponse } from "@print-automated/types";
import { ProofPreview } from "@/components/billing/proof-preview";
import { ErrorBanner, INPUT, SelectField, TextAreaField } from "@/components/form-kit";
import { Modal } from "@/components/modal";
import { useActionRunner } from "@/components/orders/use-action-runner";
import { Button, Pill } from "@/components/ui";
import { getApi } from "@/lib/api";
import {
  DURATION_PRESETS,
  durationLabel,
  parseCustomDuration,
  proofStatusLabel,
  proofStatusTone,
  type DurationUnit,
} from "@/lib/billing-view";
import { formatDateTime, formatMoney } from "@/lib/format";
import { assignablePlans, planOptionLabel } from "@/lib/plan-view";

/** The platform admin's decision on ONE payment proof: look at the file and the details the
 * owner entered, then approve (choosing how much access to grant -- a preset, or any number
 * of months or years) or reject with a reason. An already-decided proof opens read-only. */
export function ReviewProofDialog({
  proof,
  plans,
  onDecided,
  onChanged,
  onClose,
}: {
  proof: PaymentProofResponse;
  plans: readonly PlanDefinitionResponse[];
  /** Called with the updated proof after a successful approve/reject. */
  onDecided: (proof: PaymentProofResponse, message: string) => void;
  /** A conflict (already reviewed) means the list is stale: reload it. */
  onChanged: () => void;
  onClose: () => void;
}): ReactNode {
  const pending = proof.status === "PENDING";
  const runner = useActionRunner(onChanged);
  const [mode, setMode] = useState<"review" | "rejecting">("review");
  const [preset, setPreset] = useState("1");
  const [customAmount, setCustomAmount] = useState("");
  const [customUnit, setCustomUnit] = useState<DurationUnit>("months");
  const [planId, setPlanId] = useState(proof.planDefinitionId);
  const [reason, setReason] = useState("");

  const choices = assignablePlans(plans);
  const months =
    preset === "custom" ? parseCustomDuration(customAmount, customUnit) : Number(preset);
  const planOptions = choices.map((plan) => ({ value: plan.id, label: planOptionLabel(plan) }));
  // The plan the owner paid for may have been archived since; the picker then falls back to
  // the first live plan, so the admin always chooses a plan that can still be assigned.
  const planValue = choices.some((plan) => plan.id === planId) ? planId : (choices[0]?.id ?? "");

  function approve(): void {
    if (months === null) {
      return;
    }
    let updated: PaymentProofResponse | null = null;
    void runner
      .run(async () => {
        updated = await getApi().paymentProofs.adminApprove(proof.id, {
          months,
          ...(planValue !== proof.planDefinitionId && planValue !== ""
            ? { planDefinitionId: planValue }
            : {}),
        });
      })
      .then((outcome) => {
        if (outcome === "ok" && updated !== null) {
          onDecided(updated, `Approved: ${durationLabel(months)} added to ${proof.shopName}.`);
        }
      });
  }

  function reject(): void {
    const trimmed = reason.trim();
    if (trimmed === "") {
      return;
    }
    let updated: PaymentProofResponse | null = null;
    void runner
      .run(async () => {
        updated = await getApi().paymentProofs.adminReject(proof.id, trimmed);
      })
      .then((outcome) => {
        if (outcome === "ok" && updated !== null) {
          onDecided(updated, `Rejected the payment from ${proof.shopName}.`);
        }
      });
  }

  return (
    <Modal title={`Payment from ${proof.shopName}`} onClose={onClose} busy={runner.busy}>
      <div className="grid gap-4 px-5 py-4 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-muted">Status</dt>
          <dd>
            <Pill tone={proofStatusTone(proof.status)}>{proofStatusLabel(proof.status)}</Pill>
          </dd>
          <dt className="text-muted">Plan</dt>
          <dd>{proof.planName}</dd>
          <dt className="text-muted">Amount paid</dt>
          <dd>{formatMoney(proof.amountMinor, proof.currency)}</dd>
          <dt className="text-muted">Reference</dt>
          <dd className="num">
            {proof.transactionRef}{" "}
            {proof.duplicateTransactionRef && <Pill tone="caution">Used on another payment</Pill>}
          </dd>
          <dt className="text-muted">Submitted</dt>
          <dd>{formatDateTime(proof.createdAt)}</dd>
          {proof.status === "APPROVED" && proof.grantedMonths !== null && (
            <>
              <dt className="text-muted">Granted</dt>
              <dd>{durationLabel(proof.grantedMonths)}</dd>
            </>
          )}
          {proof.status === "REJECTED" && proof.rejectionReason !== null && (
            <>
              <dt className="text-muted">Reason</dt>
              <dd>{proof.rejectionReason}</dd>
            </>
          )}
        </dl>

        <ProofPreview
          proofId={proof.id}
          contentType={proof.fileContentType}
          fileName={proof.fileName}
          load={() => getApi().paymentProofs.adminFile(proof.id)}
        />

        {pending && mode === "review" && (
          <fieldset className="grid gap-3 rounded-md border border-line p-3">
            <legend className="px-1 text-xs font-medium text-muted">Access to grant</legend>
            <div className="flex flex-wrap gap-2">
              {DURATION_PRESETS.map((option) => (
                <label
                  key={option.id}
                  className={`inline-flex cursor-pointer items-center rounded-md border px-3 py-1.5 ${
                    preset === option.id ? "border-ink bg-panel-2 text-ink" : "border-line"
                  }`}
                >
                  <input
                    type="radio"
                    name="grant"
                    value={option.id}
                    checked={preset === option.id}
                    onChange={() => setPreset(option.id)}
                    className="sr-only"
                  />
                  {durationLabel(option.months)}
                </label>
              ))}
              <label
                className={`inline-flex cursor-pointer items-center rounded-md border px-3 py-1.5 ${
                  preset === "custom" ? "border-ink bg-panel-2 text-ink" : "border-line"
                }`}
              >
                <input
                  type="radio"
                  name="grant"
                  value="custom"
                  checked={preset === "custom"}
                  onChange={() => setPreset("custom")}
                  className="sr-only"
                />
                Custom
              </label>
            </div>
            {preset === "custom" && (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  aria-label="Custom duration"
                  inputMode="numeric"
                  value={customAmount}
                  onChange={(event) => setCustomAmount(event.target.value)}
                  placeholder="e.g. 18"
                  className={`${INPUT} num w-28`}
                />
                <select
                  aria-label="Custom duration unit"
                  value={customUnit}
                  onChange={(event) => setCustomUnit(event.target.value as DurationUnit)}
                  className={INPUT}
                >
                  <option value="months">months</option>
                  <option value="years">years</option>
                </select>
                {months === null && customAmount !== "" && (
                  <span role="alert" className="text-xs text-danger-fg">
                    Enter a whole number, up to 10 years.
                  </span>
                )}
              </div>
            )}
            <SelectField
              label="Plan to activate"
              value={planValue}
              onChange={setPlanId}
              options={planOptions}
              hint="Defaults to the plan the owner paid for."
            />
          </fieldset>
        )}

        {pending && mode === "rejecting" && (
          <TextAreaField
            label="Reason for rejecting (the owner will see this)"
            value={reason}
            onChange={setReason}
            maxLength={500}
          />
        )}

        <ErrorBanner message={runner.error} />
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">
        {!pending && <Button onClick={onClose}>Close</Button>}
        {pending && mode === "review" && (
          <>
            <Button onClick={onClose} disabled={runner.busy}>
              Cancel
            </Button>
            <Button onClick={() => setMode("rejecting")} disabled={runner.busy}>
              Reject…
            </Button>
            <Button
              variant="primary"
              onClick={approve}
              disabled={runner.busy || months === null || planValue === ""}
            >
              {months === null ? "Approve" : `Approve — ${durationLabel(months)}`}
            </Button>
          </>
        )}
        {pending && mode === "rejecting" && (
          <>
            <Button onClick={() => setMode("review")} disabled={runner.busy}>
              Back
            </Button>
            <Button
              variant="primary"
              onClick={reject}
              disabled={runner.busy || reason.trim() === ""}
            >
              Reject payment
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}
