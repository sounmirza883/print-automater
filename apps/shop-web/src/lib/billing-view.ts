import type { BillingPlanOption, PaymentProofResponse } from "@print-automated/types";
import { formatMoney, parseMoneyToMinor } from "@/lib/format";

/** Manual plan billing (owner Billing screen + admin Payments screen): the pure rules
 * both screens share -- file checks, the duration an admin grants, status wording -- kept
 * free of React so they are unit-tested on their own. */

export const PROOF_ACCEPTED_TYPES = ["image/jpeg", "image/png", "application/pdf"] as const;
export type ProofContentType = (typeof PROOF_ACCEPTED_TYPES)[number];
export const PROOF_MAX_BYTES = 5 * 1024 * 1024;

/** Largest amount one proof may carry, in minor units. Mirrors the API schema and the database's
 * 32-bit `amount_minor` column (2,000,000,000 = PKR 20,000,000): above it the API answers with a
 * bare "Validation failed", so the form says so up front instead. */
export const MAX_PROOF_AMOUNT_MINOR = 2_000_000_000;
export const PROOF_ACCEPT_ATTRIBUTE = PROOF_ACCEPTED_TYPES.join(",");

/** Longest approval an admin can grant in one go (mirrors the API's 10 years). */
export const MAX_GRANT_MONTHS = 120;

export function isProofContentType(type: string): type is ProofContentType {
  return (PROOF_ACCEPTED_TYPES as readonly string[]).includes(type);
}

/** Early, friendly refusal of an obviously wrong file; the API re-checks the real bytes. */
export function validateProofFile(file: { type: string; size: number } | null): string | null {
  if (file === null) {
    return "Choose the screenshot or PDF of your payment.";
  }
  if (!isProofContentType(file.type)) {
    return "Upload a JPEG, PNG or PDF.";
  }
  if (file.size === 0) {
    return "That file is empty.";
  }
  if (file.size > PROOF_MAX_BYTES) {
    return "The file is larger than 5 MB.";
  }
  return null;
}

/** Raw base64 of the file (no `data:` prefix), chunked so a multi-MB file never blows the
 * argument limit of `String.fromCharCode`. */
export async function fileToBase64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunk = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

export interface SubmissionForm {
  planDefinitionId: string;
  amountText: string;
  transactionRef: string;
  file: { type: string; size: number } | null;
}

export interface SubmissionErrors {
  plan?: string;
  amount?: string;
  transactionRef?: string;
  file?: string;
}

/** Field-level problems with a submission, plus the parsed amount when it is valid. */
export function validateSubmission(
  form: SubmissionForm,
  plans: readonly BillingPlanOption[],
): { errors: SubmissionErrors; amountMinor: number | null } {
  const errors: SubmissionErrors = {};
  const plan = plans.find((candidate) => candidate.id === form.planDefinitionId);
  if (plan === undefined) {
    errors.plan = "Choose the plan you paid for.";
  }
  const amountMinor = plan === undefined ? null : parseMoneyToMinor(form.amountText, plan.currency);
  if (plan !== undefined && (amountMinor === null || amountMinor <= 0)) {
    errors.amount = "Enter the amount you paid, e.g. 6000.";
  } else if (plan !== undefined && amountMinor !== null && amountMinor > MAX_PROOF_AMOUNT_MINOR) {
    errors.amount = `The amount cannot be more than ${formatMoney(MAX_PROOF_AMOUNT_MINOR, plan.currency)}. Check the number of zeros.`;
  }
  if (form.transactionRef.trim().length === 0) {
    errors.transactionRef = "Enter the transaction or reference number.";
  } else if (form.transactionRef.trim().length > 100) {
    errors.transactionRef = "That reference is too long.";
  }
  const fileError = validateProofFile(form.file);
  if (fileError !== null) {
    errors.file = fileError;
  }
  return { errors, amountMinor: errors.amount === undefined ? amountMinor : null };
}

export function hasPendingProof(proofs: readonly PaymentProofResponse[]): boolean {
  return proofs.some((proof) => proof.status === "PENDING");
}

export function proofStatusLabel(status: PaymentProofResponse["status"]): string {
  return { PENDING: "Waiting for review", APPROVED: "Approved", REJECTED: "Rejected" }[status];
}

export function proofStatusTone(
  status: PaymentProofResponse["status"],
): "caution" | "good" | "danger" {
  return { PENDING: "caution", APPROVED: "good", REJECTED: "danger" }[status] as
    "caution" | "good" | "danger";
}

/** How long an approval grants, in words: 1 -> "1 month", 12 -> "1 year", 18 -> "18 months". */
export function durationLabel(months: number): string {
  if (months % 12 === 0) {
    const years = months / 12;
    return years === 1 ? "1 year" : `${years} years`;
  }
  return months === 1 ? "1 month" : `${months} months`;
}

export const DURATION_PRESETS: ReadonlyArray<{ id: string; months: number }> = [
  { id: "1", months: 1 },
  { id: "3", months: 3 },
  { id: "6", months: 6 },
  { id: "12", months: 12 },
];

export type DurationUnit = "months" | "years";

/** A custom duration typed by the admin -> whole months, or null when it is not a positive
 * whole number or exceeds the 10-year cap. */
export function parseCustomDuration(amount: string, unit: DurationUnit): number | null {
  const trimmed = amount.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed);
  const months = unit === "years" ? value * 12 : value;
  return months >= 1 && months <= MAX_GRANT_MONTHS ? months : null;
}

/** Image or PDF -- decides how a stored proof is previewed. */
export function previewKind(contentType: string): "image" | "pdf" {
  return contentType === "application/pdf" ? "pdf" : "image";
}
