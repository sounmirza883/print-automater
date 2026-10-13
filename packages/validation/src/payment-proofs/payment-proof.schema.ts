import { z } from "zod";
import { adminPagingShape, resolveAdminPaging } from "../admin/list-query.schema.js";

/** Plan-payment proofs (manual billing): an owner pays the platform off-app and
 * submits a screenshot/PDF; a platform admin approves (granting N months) or rejects. */

export const PAYMENT_PROOF_CONTENT_TYPES = ["image/jpeg", "image/png", "application/pdf"] as const;

/** 5 MB of file -> at most ~6.99M base64 characters. The server decodes and re-checks
 * the real byte length and magic bytes; this only bounds the request size. */
export const PAYMENT_PROOF_MAX_BYTES = 5 * 1024 * 1024;
export const PAYMENT_PROOF_MAX_BASE64_CHARS = Math.ceil(PAYMENT_PROOF_MAX_BYTES / 3) * 4;

export const PAYMENT_PROOF_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;

/** Longest approval an admin can grant in one go: 10 years. */
export const MAX_GRANT_MONTHS = 120;

export const submitPaymentProofSchema = z.object({
  shopId: z.string().uuid(),
  planDefinitionId: z.string().uuid(),
  /** Integer minor units (paisa), like PlanDefinition.priceMinor. */
  amountMinor: z.number().int().positive().max(2_000_000_000),
  transactionRef: z.string().trim().min(1).max(100),
  fileName: z.string().trim().min(1).max(255),
  fileContentType: z.enum(PAYMENT_PROOF_CONTENT_TYPES),
  /** Raw base64 of the file (no `data:` prefix). */
  fileBase64: z.string().min(1).max(PAYMENT_PROOF_MAX_BASE64_CHARS),
});
export type SubmitPaymentProofInput = z.infer<typeof submitPaymentProofSchema>;

/** `?shopId=` -- an owner's own history. */
export const listShopPaymentProofsQuerySchema = z.object({
  shopId: z.string().uuid(),
});
export type ListShopPaymentProofsQueryInput = z.infer<typeof listShopPaymentProofsQuerySchema>;

/** `GET /admin/payment-proofs` -- the review queue, optionally one status. */
export const adminListPaymentProofsQuerySchema = z
  .object({
    ...adminPagingShape,
    status: z.enum(PAYMENT_PROOF_STATUSES).optional(),
  })
  .transform(resolveAdminPaging);
export type AdminListPaymentProofsQueryInput = z.infer<typeof adminListPaymentProofsQuerySchema>;

export const approvePaymentProofSchema = z.object({
  /** Calendar months to grant (1 year = 12). */
  months: z.number().int().min(1).max(MAX_GRANT_MONTHS),
  /** Defaults to the plan the owner chose when submitting. */
  planDefinitionId: z.string().uuid().optional(),
});
export type ApprovePaymentProofInput = z.infer<typeof approvePaymentProofSchema>;

export const rejectPaymentProofSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type RejectPaymentProofInput = z.infer<typeof rejectPaymentProofSchema>;

export const updatePaymentInstructionsSchema = z.object({
  paymentInstructions: z.string().trim().max(5000),
});
export type UpdatePaymentInstructionsInput = z.infer<typeof updatePaymentInstructionsSchema>;

/** Longest range one payment report may cover (5 years). */
export const MAX_PAYMENT_REPORT_DAYS = 1830;
const DAY_MS = 86_400_000;
export const PAYMENT_REPORT_GROUP_BY = ["day", "month"] as const;
export const PAYMENT_REPORT_FORMATS = ["csv", "xlsx"] as const;

/** `GET /admin/payment-reports`. `from` is inclusive and `to` exclusive (instants: the browser
 * sends local midnights). `tzOffsetMinutes` is the viewer's offset from UTC (Pakistan = 300), so
 * "per day" means the viewer's day, not a UTC day. `groupBy` defaults to day for ranges of up to
 * 62 days and month for longer ones. */
const paymentReportShape = {
  from: z.coerce.date(),
  to: z.coerce.date(),
  groupBy: z.enum(PAYMENT_REPORT_GROUP_BY).optional(),
  tzOffsetMinutes: z.coerce.number().int().min(-840).max(840).default(0),
};

function checkRange(value: { from: Date; to: Date }, ctx: z.RefinementCtx): void {
  if (value.from >= value.to) {
    ctx.addIssue({ code: "custom", path: ["from"], message: "`from` must be before `to`." });
  } else if (value.to.getTime() - value.from.getTime() > MAX_PAYMENT_REPORT_DAYS * DAY_MS) {
    ctx.addIssue({
      code: "custom",
      path: ["from"],
      message: `The range may not exceed ${MAX_PAYMENT_REPORT_DAYS} days.`,
    });
  }
}

export const paymentReportQuerySchema = z.object(paymentReportShape).superRefine(checkRange);
export type PaymentReportQueryInput = z.infer<typeof paymentReportQuerySchema>;

export const paymentReportExportQuerySchema = z
  .object({ ...paymentReportShape, format: z.enum(PAYMENT_REPORT_FORMATS).default("csv") })
  .superRefine(checkRange);
export type PaymentReportExportQueryInput = z.infer<typeof paymentReportExportQuerySchema>;
