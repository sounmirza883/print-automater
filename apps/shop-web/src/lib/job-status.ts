import {
  describeBlockedReason as describeShared,
  type BlockedFix,
  type Tone,
} from "@print-automated/api-client";

/** The job wording is shared with shop-mobile (@print-automated/api-client, 23.31); this app
 * adds where each fix lives on its own screens. */
export { isHeldByLatePrint, jobStatusTone, type Tone } from "@print-automated/api-client";

export interface BlockedReasonView {
  label: string;
  /** What a person can do about it. */
  hint: string;
  tone: Tone;
  /** Where the fix lives, when there is one. */
  action?: { label: string; href: string };
}

const FIX_LINKS: Record<BlockedFix, { label: string; href: string }> = {
  inventory: { label: "Check paper stock", href: "/inventory" },
  printers: { label: "Printers", href: "/printers" },
  "printer-status": { label: "Printers", href: "/dashboard/printers" },
};

/** Why a job is parked, in plain words, with a link to where it is fixed. */
export function describeBlockedReason(reason: string | null): BlockedReasonView | null {
  const shared = describeShared(reason);
  if (shared === null) {
    return null;
  }
  const { fix, ...view } = shared;
  return fix === undefined ? view : { ...view, action: FIX_LINKS[fix] };
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
