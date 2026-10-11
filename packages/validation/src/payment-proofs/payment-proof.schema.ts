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
