import { BlockedReason } from "@print-automated/types";

/** 23.31: how a print job is described to shop staff, shared by shop-web and shop-mobile so
 * the same job reads the same on both (moved here from shop-web's lib/job-status.ts and
 * lib/format.ts). Pure: no routes, no styling. Each app maps `tone` to its own colours and
 * `fix` to its own screen. */

export type Tone = "neutral" | "good" | "caution" | "danger" | "accent";

/** Where the fix for a blocked job lives, in either app. */
export type BlockedFix = "inventory" | "printers" | "printer-status";

export interface BlockedReasonView {
  label: string;
  /** What a person can do about it. */
  hint: string;
  tone: Tone;
  fix?: BlockedFix;
}

/** "PAPER_JAM" -> "Paper jam". */
export function humanizeEnum(value: string): string {
  const spaced = value.toLowerCase().replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Plain-language copy for why the allocation engine parked a job
 * (`print_jobs.blockedReason`). Two reasons need exact wording from the
 * plan: AUTOMATION_DISABLED is "waiting for manual printer assignment"
 * (it is a choice the business made, not a fault), and NO_PAPER points at
 * a restock. MANUAL_APPROVAL_REQUIRED means a late "printed" report
 * arrived for a job already given up on, so paper may have come out:
 * the job is held until a person looks at the output tray. */
export function describeBlockedReason(reason: string | null): BlockedReasonView | null {
  if (reason === null) {
    return null;
  }
  switch (reason) {
    case BlockedReason.AUTOMATION_DISABLED:
      return {
        label: "Waiting for manual printer assignment",
        hint: "Automatic printer assignment is switched off for this business. Assign a printer to this job yourself.",
        tone: "accent",
      };
    case BlockedReason.NO_PAPER:
      return {
        label: "Out of paper",
        hint: "No eligible printer has the paper this job needs. Restock the paper, or reassign the job to a printer that has it.",
        tone: "danger",
        fix: "inventory",
      };
    case BlockedReason.MANUAL_APPROVAL_REQUIRED:
      return {
        label: "Held: a late print report arrived",
        hint: "A printer reported this job printed after it had been given up on, so paper may already have come out. Check the output tray before resuming; resuming asks you to confirm.",
        tone: "danger",
      };
    case BlockedReason.NO_COMPATIBLE_PRINTER:
      return {
        label: "No compatible printer",
        hint: "None of the business's printers supports this job's paper, colour or sides. Change the job or add a suitable printer.",
        tone: "caution",
        fix: "printers",
      };
    case BlockedReason.PRINTER_OFFLINE:
      return {
        label: "Printer offline",
        hint: "The printer this job needs is offline. Bring it back online or assign another printer.",
        tone: "caution",
        fix: "printer-status",
      };
    case BlockedReason.PRINTER_DISABLED:
      return {
        label: "Printer disabled",
        hint: "The printer this job needs is switched off. Enable it or assign another printer.",
        tone: "caution",
        fix: "printers",
      };
    case BlockedReason.PAGE_LIMIT_REACHED:
      return {
        label: "Page limit reached",
        hint: "Every eligible printer has used its page allowance for the period. Assign a printer manually to override, or raise the limit.",
        tone: "caution",
        fix: "printer-status",
      };
    case BlockedReason.OPERATOR_UNAVAILABLE:
      return {
        label: "No operator available",
        hint: "No operator is available to run this job.",
        tone: "caution",
      };
    default:
      return {
        label: humanizeEnum(reason),
        hint: "This job is waiting for a person.",
        tone: "caution",
      };
  }
}

export function isHeldByLatePrint(reason: string | null): boolean {
  return reason === BlockedReason.MANUAL_APPROVAL_REQUIRED;
}

export function jobStatusTone(status: string): Tone {
  switch (status) {
    case "PRINTING":
    case "CLAIMED":
      return "accent";
    case "PRINTED":
      return "good";
    case "FAILED":
    case "TIMEOUT":
    case "UNKNOWN":
      return "danger";
    case "PAUSED":
    case "WAITING":
      return "caution";
    default:
      return "neutral";
  }
}

const JOB_PRIORITY_LABELS: ReadonlyArray<readonly [number, string]> = [
  [20, "Urgent"],
  [10, "High"],
  [0, "Normal"],
];

/** `JobPriority` scale: 0 normal, 10 high, 20 urgent. */
export function priorityLabel(priority: number): string {
  for (const [threshold, label] of JOB_PRIORITY_LABELS) {
    if (priority >= threshold) {
      return label;
    }
  }
  return "Normal";
}

/** What a job asks the person at the machine to load and do (the operator dashboard's
 * `instructions`). */
export interface JobInstructions {
  paperSize: string | null;
  paperType: string | null;
  color: string | null;
  sides: string | null;
  orientation: string | null;
  copies: number;
  pagesPerCopy: number;
  totalPages: number;
  finishing: string[];
}

/** What to load and how to print, on one line: "A4 · Plain · Colour ·
 * Double-sided · 2 copies × 12 pp = 24 pp". This is the "required paper"
 * and "job instructions" of PRD 40. */
export function instructionSummary(instructions: JobInstructions): string {
  const i = instructions;
  const parts = [i.paperSize, i.paperType, i.color, i.sides, i.orientation, ...i.finishing]
    .filter((part): part is string => part !== null && part !== "")
    .map(humanizeEnum);
  const pages =
    i.copies > 1
      ? `${i.copies} copies × ${i.pagesPerCopy} pp = ${i.totalPages} pp`
      : `${i.totalPages} pp`;
  return [...parts, pages].join(" · ");
}
