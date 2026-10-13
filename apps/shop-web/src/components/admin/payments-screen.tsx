"use client";

import { useState, type ReactNode } from "react";
import type { PaymentProofResponse } from "@print-automated/types";
import { PaymentInstructionsPanel } from "@/components/admin/payment-instructions-panel";
import { ReviewProofDialog } from "@/components/admin/review-proof-dialog";
import { SelectField } from "@/components/form-kit";
import { ResourceBoundary } from "@/components/resource-boundary";
import {
  Button,
  Cell,
  DataTable,
  EmptyState,
  Notice,
  PageHeader,
  Panel,
  Pill,
  Row,
} from "@/components/ui";
import { getApi } from "@/lib/api";
import { durationLabel, proofStatusLabel, proofStatusTone } from "@/lib/billing-view";
import { formatDateTime, formatMoney } from "@/lib/format";
import { useResource } from "@/lib/use-resource";

type Filter = "PENDING" | "APPROVED" | "REJECTED" | "ALL";

const FILTERS: ReadonlyArray<{ value: Filter; label: string }> = [
  { value: "PENDING", label: "Waiting for review" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
  { value: "ALL", label: "All payments" },
];

const PAGE = 100;

/** Platform admin: the review queue for manual plan payments. Oldest waiting first, so the
 * queue is worked in the order owners paid. Approved and rejected proofs stay here (and their
 * files stay viewable) permanently. */
export function PaymentsScreen(): ReactNode {
  const [filter, setFilter] = useState<Filter>("PENDING");
  const [reviewing, setReviewing] = useState<PaymentProofResponse | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const list = useResource(
    () =>
      getApi().paymentProofs.adminList({
        ...(filter === "ALL" ? {} : { status: filter }),
        limit: PAGE,
      }),
    [filter],
    { intervalMs: 60_000 },
  );
  // Only needed for the "plan to activate" choice in the dialog.
  const plans = useResource(() => getApi().plan.listDefinitions(), []);

  return (
    <>
      <PageHeader
        title="Payments"
        subtitle="Check each owner's payment proof, then approve it with the access to grant, or reject it."
        actions={
          <div className="w-52">
            <SelectField
              label="Show"
              value={filter}
              onChange={(value) => setFilter(value as Filter)}
              options={FILTERS}
            />
          </div>
        }
      />

      {notice !== null && (
        <Notice tone="good" role="status" className="mb-4">
          {notice}
        </Notice>
      )}

      <Panel
        title="Submitted payments"
        aside={list.data ? `${list.data.total} total` : undefined}
        flushOnPhone
      >
        <ResourceBoundary state={list} what="payments">
          {(data) =>
            data.items.length === 0 ? (
              <EmptyState title="Nothing here">
                {filter === "PENDING"
                  ? "No payments are waiting for review."
                  : "No payments match this filter."}
              </EmptyState>
            ) : (
              <DataTable
                caption="Submitted payments"
                head={["Submitted", "Business", "Plan", "Amount", "Reference", "Status", ""]}
                stackOnPhone
              >
                {data.items.map((proof) => (
                  <Row key={proof.id}>
                    <Cell className="py-2.5 whitespace-nowrap">
                      {formatDateTime(proof.createdAt)}
                    </Cell>
                    <Cell label="Business" className="py-2.5 font-medium">
                      {proof.shopName}
                    </Cell>
                    <Cell label="Plan" className="py-2.5">
                      {proof.planName}
                    </Cell>
                    <Cell label="Amount" className="py-2.5 whitespace-nowrap">
                      {formatMoney(proof.amountMinor, proof.currency)}
                    </Cell>
                    <Cell label="Reference" className="py-2.5">
                      <span className="num">{proof.transactionRef}</span>{" "}
                      {proof.duplicateTransactionRef && <Pill tone="caution">Duplicate</Pill>}
                    </Cell>
                    <Cell label="Status" className="py-2.5">
                      <Pill tone={proofStatusTone(proof.status)}>
                        {proofStatusLabel(proof.status)}
                      </Pill>
                      {proof.status === "APPROVED" && proof.grantedMonths !== null && (
                        <span className="ml-2 text-xs text-muted">
                          {durationLabel(proof.grantedMonths)}
                        </span>
                      )}
                    </Cell>
                    <Cell className="py-2.5 text-right">
                      <Button
                        variant={proof.status === "PENDING" ? "primary" : "secondary"}
                        onClick={() => {
                          setNotice(null);
                          setReviewing(proof);
                        }}
                      >
                        {proof.status === "PENDING" ? "Review" : "View"}
                      </Button>
                    </Cell>
                  </Row>
                ))}
              </DataTable>
            )
          }
        </ResourceBoundary>
      </Panel>

      <div className="mt-4">
        <PaymentInstructionsPanel />
      </div>

      {reviewing !== null && (
        <ReviewProofDialog
          // A fresh dialog per proof, so no draft carries over from the last one.
          key={reviewing.id}
          proof={reviewing}
          plans={plans.data?.items ?? []}
          onChanged={list.reload}
          onClose={() => setReviewing(null)}
          onDecided={(_updated, message) => {
            setReviewing(null);
            setNotice(message);
            list.reload();
          }}
        />
      )}
    </>
  );
}
