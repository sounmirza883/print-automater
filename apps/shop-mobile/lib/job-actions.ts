import { ApiClientError, humanizeEnum } from "@print-automated/api-client";
import { JobFailureReason, ReprintReason } from "@print-automated/types";

export interface Choice<T extends string> {
  value: T;
  label: string;
}

/** 23.34: the reasons staff pick from, in the API's own enums (plain words via 23.31). */
export const FAILURE_REASONS: Choice<JobFailureReason>[] = Object.values(JobFailureReason).map(
  (value) => ({ value, label: humanizeEnum(value) }),
);

export const REPRINT_REASONS: Choice<ReprintReason>[] = Object.values(ReprintReason).map(
  (value) => ({ value, label: humanizeEnum(value) }),
);

export type UnknownResolution = "CONFIRMED_PRINTED" | "MARK_FAILED" | "RETRY";

/** What a person found at the printer for a job whose outcome is unknown. Retrying is last:
 * it prints again, so it is only right when nothing came out. */
export const UNKNOWN_RESOLUTIONS: Choice<UnknownResolution>[] = [
  { value: "CONFIRMED_PRINTED", label: "It printed: the paper is there" },
  { value: "MARK_FAILED", label: "It did not print: mark it failed" },
  { value: "RETRY", label: "It did not print: print it again now" },
];

export type QualityVerdict = "PASSED" | "NEEDS_REPRINT" | "FAILED";

export const QUALITY_VERDICTS: Choice<QualityVerdict>[] = [
  { value: "PASSED", label: "Passed: the output is good" },
  { value: "NEEDS_REPRINT", label: "Needs reprint: print the bad jobs again" },
  { value: "FAILED", label: "Failed: the output is unusable" },
];

/** Resuming a job held by a late "printed" report is refused with this code until the person
 * confirms they checked the output tray (then it is resent with acknowledgeLatePrint). */
export function needsLatePrintAck(error: unknown): boolean {
  return error instanceof ApiClientError && error.error_code === "LATE_PRINT_ACK_REQUIRED";
}

/** The API's own message (written for people), or a fallback. */
export function errorMessage(error: unknown, fallback = "That action failed."): string {
  return error instanceof Error && error.message !== "" ? error.message : fallback;
}

/** A note field's value for the API: trimmed, and absent when blank (the API rejects ""). */
export function optionalNote(text: string): string | undefined {
  const trimmed = text.trim();
  return trimmed === "" ? undefined : trimmed;
}
