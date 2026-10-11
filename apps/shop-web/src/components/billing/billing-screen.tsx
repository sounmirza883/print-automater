"use client";

import { useState, type ReactNode } from "react";
import { Permission } from "@print-automated/types";
import type { PaymentProofResponse } from "@print-automated/types";
import { PlanStatusCell } from "@/components/admin/plan-assignment";
import { ProofPreview } from "@/components/billing/proof-preview";
import { SubmitProofDialog } from "@/components/billing/submit-proof-dialog";
import { Modal } from "@/components/modal";
import { RequirePermission, ResourceBoundary } from "@/components/resource-boundary";
import { useSession } from "@/components/session-provider";
import { Button, DataTable, EmptyState, PageHeader, Panel, Pill } from "@/components/ui";
import { getApi } from "@/lib/api";
import {
  durationLabel,
  hasPendingProof,
  proofStatusLabel,
  proofStatusTone,
} from "@/lib/billing-view";
import { formatDateTime, formatMoney } from "@/lib/format";
import { useResource } from "@/lib/use-resource";

/** Manual plan billing, owner side. The owner pays the platform outside the app (details
 * shown below), uploads proof here, and a platform admin approves or rejects it. Only the
 * business owner may use this (MANAGE_SETTINGS is owner-only); the API enforces the same. */
export function BillingScreen(): ReactNode {
  return (
    <RequirePermission permission={Permission.MANAGE_SETTINGS} what="billing">
      <BillingBody />
    </RequirePermission>
  );
}

function BillingBody(): ReactNode {
  const { business } = useSession();
  const shopId = business?.id ?? "";
  const enabled = shopId !== "";
  const plan = useResource(() => getApi().plan.get(shopId), [shopId], { enabled });
  const instructions = useResource(() => getApi().paymentProofs.instructions(), [shopId], {
    enabled,
  });
  const plans = useResource(() => getApi().paymentProofs.plans(), [shopId], { enabled });
  const proofs = useResource(() => getApi().paymentProofs.list(shopId), [shopId], { enabled });

  const [submitting, setSubmitting] = useState(false);
  const [viewing, setViewing] = useState<PaymentProofResponse | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const pending = proofs.data !== null && hasPendingProof(proofs.data);
  const payable = plans.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Billing"
        subtitle={business?.name}
        actions={
          <Button
            variant="primary"
            disabled={pending || payable.length === 0 || proofs.data === null}
            onClick={() => {
              setNotice(null);
              setSubmitting(true);
            }}
          >
            Submit payment proof
          </Button>
        }
      />

      {notice !== null && (
        <p
          role="status"
          className="mb-4 rounded-md border border-good/50 bg-good-soft px-3 py-2 text-sm"
        >
          {notice}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Your plan">
          <ResourceBoundary state={plan} what="your plan">
            {(current) => <PlanStatusCell plan={current} />}
          </ResourceBoundary>
        </Panel>
        <Panel title="How to pay">
          <ResourceBoundary state={instructions} what="payment details">
            {(data) =>
              data.paymentInstructions.trim() === "" ? (
                <p className="text-sm text-muted">
                  Payment details have not been set up yet. Contact Print Automated to arrange your
                  payment.
                </p>
              ) : (
                <p className="text-sm whitespace-pre-wrap">{data.paymentInstructions}</p>
              )
            }
          </ResourceBoundary>
          {pending && (
            <p className="mt-3 text-sm text-muted">
              Your last payment is waiting for review. You can send another once it has been
              checked.
            </p>
          )}
        </Panel>
      </div>

      <div className="mt-4">
        <Panel title="Your payments">
          <ResourceBoundary state={proofs} what="your payments">
            {(items) =>
              items.length === 0 ? (
                <EmptyState title="No payments yet">
                  After you pay, upload your receipt with “Submit payment proof”.
                </EmptyState>
              ) : (
                <DataTable
                  caption="Submitted payments"
                  head={["Submitted", "Plan", "Amount", "Reference", "Status", "File"]}
                >
                  {items.map((proof) => (
                    <tr key={proof.id}>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {formatDateTime(proof.createdAt)}
                      </td>
                      <td className="px-4 py-2.5">{proof.planName}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {formatMoney(proof.amountMinor, proof.currency)}
                      </td>
                      <td className="num px-4 py-2.5">{proof.transactionRef}</td>
                      <td className="px-4 py-2.5">
                        <Pill tone={proofStatusTone(proof.status)}>
                          {proofStatusLabel(proof.status)}
                        </Pill>
                        {proof.status === "APPROVED" && proof.grantedMonths !== null && (
                          <p className="mt-1 text-xs text-muted">
                            {durationLabel(proof.grantedMonths)} added
                          </p>
                        )}
                        {proof.status === "REJECTED" && proof.rejectionReason !== null && (
                          <p className="mt-1 text-xs text-muted">{proof.rejectionReason}</p>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <Button variant="ghost" onClick={() => setViewing(proof)}>
                          View
                        </Button>
                      </td>
                    </tr>
                  ))}
                </DataTable>
              )
            }
          </ResourceBoundary>
        </Panel>
      </div>

      {submitting && (
        <SubmitProofDialog
          shopId={shopId}
          plans={payable}
          onCancel={() => setSubmitting(false)}
          onSubmitted={() => {
            setSubmitting(false);
            setNotice("Thank you. We will check your payment and activate your plan.");
            proofs.reload();
          }}
        />
      )}
      {viewing !== null && (
        <Modal title={`Payment proof — ${viewing.transactionRef}`} onClose={() => setViewing(null)}>
          <div className="px-5 py-4">
            <ProofPreview
              proofId={viewing.id}
              contentType={viewing.fileContentType}
              fileName={viewing.fileName}
              load={() => getApi().paymentProofs.file(shopId, viewing.id)}
            />
          </div>
          <div className="flex justify-end border-t border-line px-5 py-3">
            <Button onClick={() => setViewing(null)}>Close</Button>
          </div>
        </Modal>
      )}
    </>
  );
}
