/** Manual plan billing: an owner pays the platform off-app and submits proof; a
 * platform admin approves (granting N months) or rejects. The proof file is kept
 * in storage forever -- `GET .../:id/file` works for every status. */
export type PaymentProofStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface PaymentProofResponse {
  id: string;
  shopId: string;
  /** Business name -- always present; useful to the admin queue. */
  shopName: string;
  planDefinitionId: string;
  planName: string;
  /** Integer minor units (paisa), like PlanDefinitionResponse.priceMinor. */
  amountMinor: number;
  currency: string;
  transactionRef: string;
  fileName: string;
  fileContentType: string;
  fileSize: number;
  status: PaymentProofStatus;
  submittedByUserId: string;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  grantedMonths: number | null;
  /** True when ANOTHER proof carries the same transaction reference (soft warning
   * for the reviewing admin; never a block). */
  duplicateTransactionRef: boolean;
  createdAt: string;
}

/** A plan an owner can pay for (archived and contact-only plans are not offered). */
export interface BillingPlanOption {
  id: string;
  name: string;
  priceMinor: number;
  currency: string;
  billingPeriodDays: number;
  /** Price for 365 days; null = no annual option. */
  annualPriceMinor: number | null;
}

export interface PaymentProofListResponse {
  items: PaymentProofResponse[];
  total: number;
  limit: number;
  offset: number;
}

export interface PaymentInstructionsResponse {
  paymentInstructions: string;
  updatedAt: string;
}
