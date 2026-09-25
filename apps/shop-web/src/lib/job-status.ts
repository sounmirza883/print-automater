import { BlockedReason } from "@print-automated/types";
import { humanizeEnum } from "@/lib/format";

export type Tone = "neutral" | "good" | "caution" | "danger" | "accent";

export interface BlockedReasonView {
  label: string;
  /** What a person can do about it. */
  hint: string;
  tone: Tone;
  /** Where the fix lives, when there is one. */
  action?: { label: string; href: string };
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
        action: { label: "Check paper stock", href: "/inventory" },
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
        action: { label: "Printers", href: "/printers" },
      };
    case BlockedReason.PRINTER_OFFLINE:
      return {
        label: "Printer offline",
        hint: "The printer this job needs is offline. Bring it back online or assign another printer.",
        tone: "caution",
        action: { label: "Printers", href: "/dashboard/printers" },
      };
    case BlockedReason.PRINTER_DISABLED:
      return {
        label: "Printer disabled",
        hint: "The printer this job needs is switched off. Enable it or assign another printer.",
        tone: "caution",
        action: { label: "Printers", href: "/printers" },
      };
    case BlockedReason.PAGE_LIMIT_REACHED:
      return {
        label: "Page limit reached",
        hint: "Every eligible printer has used its page allowance for the period. Assign a printer manually to override, or raise the limit.",
        tone: "caution",
        action: { label: "Printers", href: "/dashboard/printers" },
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

export function printerStatusTone(status: string, offline: boolean): Tone {
  if (offline) {
    return "danger";
  }
  switch (status) {
    case "ONLINE":
      return "good";
    case "BUSY":
      return "accent";
    case "ERROR":
      return "danger";
    case "PAUSED":
    case "MAINTENANCE":
      return "caution";
    default:
      return "neutral";
  }
}
