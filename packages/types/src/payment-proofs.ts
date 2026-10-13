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

/** One bucket (a day or a month) of a payment report, in one currency. */
export interface PaymentReportPeriod {
  /** `YYYY-MM-DD`: the bucket's first day in the viewer's time zone. */
  period: string;
  receivedMinor: number;
  receivedCount: number;
  rejectedMinor: number;
  rejectedCount: number;
}

export interface PaymentReportPlanLine {
  planName: string;
  receivedMinor: number;
  receivedCount: number;
}

/** Money is never summed across currencies: each currency gets its own block. */
export interface PaymentReportCurrency {
  currency: string;
  /** Approved payments, counted on the day they were approved. */
  receivedMinor: number;
  receivedCount: number;
  /** Rejected payments, counted on the day they were rejected. */
  rejectedMinor: number;
  rejectedCount: number;
  /** Submitted in the range and still waiting for review (in neither total above). */
  waitingMinor: number;
  waitingCount: number;
  periods: PaymentReportPeriod[];
  /** Received money by the plan the owner paid for, largest first. */
  byPlan: PaymentReportPlanLine[];
}

export interface PaymentReportResponse {
  from: string;
  to: string;
  groupBy: "day" | "month";
  currencies: PaymentReportCurrency[];
}
