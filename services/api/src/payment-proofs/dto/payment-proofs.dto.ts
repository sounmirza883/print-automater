import { createZodDto } from "nestjs-zod";
import {
  adminListPaymentProofsQuerySchema,
  approvePaymentProofSchema,
  listShopPaymentProofsQuerySchema,
  paymentReportExportQuerySchema,
  paymentReportQuerySchema,
  rejectPaymentProofSchema,
  submitPaymentProofSchema,
  updatePaymentInstructionsSchema,
} from "@print-automated/validation";

export class SubmitPaymentProofDto extends createZodDto(submitPaymentProofSchema) {}
export class ListShopPaymentProofsQueryDto extends createZodDto(listShopPaymentProofsQuerySchema) {}
export class AdminListPaymentProofsQueryDto extends createZodDto(
  adminListPaymentProofsQuerySchema,
) {}
export class ApprovePaymentProofDto extends createZodDto(approvePaymentProofSchema) {}
export class RejectPaymentProofDto extends createZodDto(rejectPaymentProofSchema) {}
export class UpdatePaymentInstructionsDto extends createZodDto(updatePaymentInstructionsSchema) {}
export class PaymentReportQueryDto extends createZodDto(paymentReportQuerySchema) {}
export class PaymentReportExportQueryDto extends createZodDto(paymentReportExportQuerySchema) {}
