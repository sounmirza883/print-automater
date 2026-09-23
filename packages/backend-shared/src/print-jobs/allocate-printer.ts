import { PrinterStatus } from "@prisma/client";
import { BlockedReason } from "@print-automated/types";
import type { PrintConfiguration, PrinterCapabilities } from "@print-automated/types";

/** 18.4/§19. Everything `allocatePrinter()` needs about ONE candidate
 * printer -- a plain snapshot, not a live Prisma row, so this stays
 * zero-I/O and zero-Prisma-model-dependent. The four `?`-suffixed
 * fields are forward-compatibility hooks for Phase 19 (page limits)
 * and Phase 20 (paper inventory, operator availability): `undefined`
 * means "not tracked yet by this caller," which never blocks --
 * exactly the same "absent means today's behaviour" convention
 * `PrintConfiguration.paperType`/`finishing` already established
 * (15.1). Real 19.x/20.x callers set them to real booleans once that
 * data exists; this function's own logic and tests are already
 * exhaustive over both states today, so nothing about this function's
 * signature needs to change when those phases land. */
export interface PrinterCandidate {
  id: string;
  status: PrinterStatus;
  hasAgent: boolean;
  /** null = never probed by an agent heartbeat (9.4's own established
   * meaning) -- excluded on the auto path, trusted on the manual path,
   * exactly like `printerSupportsConfiguration()` (15.2/10.4) already
   * distinguished. */
  capabilities: PrinterCapabilities | null;
  supportedSizes: string[];
  supportedPaperTypes: string[];
  maxJobPages: number | null;
  queuedPages: number;
  queuedJobs: number;
  /** epoch ms -- passed in, never read from a clock inside this
   * function (18.4's own "zero clock reads" requirement). */
  registeredAt: number;
  pageLimitReached?: boolean;
  paperAvailable?: boolean;
  operatorAvailable?: boolean;
  requiresManualApproval?: boolean;
}

export interface AllocationRequest {
  printConfiguration: PrintConfiguration;
  /** Pages this specific job would consume -- checked against a
   * candidate's own `maxJobPages`. */
  pageCount: number;
  /** false for the automatic path (15.2's own "guessing on the
   * customer/order's behalf" reasoning: an unprobed printer is
   * excluded, never assumed compatible); true for a staff-initiated
   * manual override (a human naming this exact printer is itself an
   * informed choice, so unknown capabilities defer to it). Also gates
   * which printer statuses are eligible at all -- see `isStatusEligible`
   * below -- since in this codebase the two have always moved together
   * (15.2's hotfix vs. 10.4's manual override). */
  allowUnknownCapabilities: boolean;
  /** A staff "Change Printer" choice -- if set, allocation considers
   * ONLY this printer (still subject to every other check) instead of
   * picking automatically from every eligible candidate. */
  requestedPrinterId?: string;
}

export type AllocationResult =
  | { outcome: "ALLOCATED"; printerId: string }
  | { outcome: "BLOCKED"; blockedReason: BlockedReason };

function isStatusEligible(status: PrinterStatus, allowUnknownCapabilities: boolean): boolean {
  // Manual override: everything except DISABLED (staff's own explicit
  // "off" switch) is eligible -- preserves 10.4's own
  // findRequestedPrinter() behaviour exactly.
  if (allowUnknownCapabilities) {
    return status !== PrinterStatus.DISABLED;
  }
  // Auto path: only ONLINE -- 15.2's own hotfix, §16's "never assume
  // available" applied literally to OFFLINE/ERROR/BUSY/PAUSED/
  // MAINTENANCE/UNKNOWN alike.
  return status === PrinterStatus.ONLINE;
}

function statusBlockedReason(status: PrinterStatus): BlockedReason {
  return status === PrinterStatus.DISABLED
    ? BlockedReason.PRINTER_DISABLED
    : BlockedReason.PRINTER_OFFLINE;
}

function capabilitiesMatch(
  capabilities: PrinterCapabilities | null,
  config: PrintConfiguration,
  allowUnknownCapabilities: boolean,
): boolean {
  if (capabilities === null) {
    return allowUnknownCapabilities;
  }
  if (config.color === "COLOR" && !capabilities.color) {
    return false;
  }
  if (config.sides === "DOUBLE" && !capabilities.duplex) {
    return false;
  }
  if (config.paperSize === "A4" && !capabilities.a4) {
    return false;
  }
  if (config.paperSize === "A3" && !capabilities.a3) {
    return false;
  }
  return true;
}

/** The single, specific reason a candidate is ineligible -- checked in
 * a fixed, documented precedence so the reason reported is always the
 * most fundamental one (a DISABLED, capability-mismatched, page-limited
 * printer is reported PRINTER_DISABLED, not PAGE_LIMIT_REACHED). */
function blockedReasonFor(
  candidate: PrinterCandidate,
  request: AllocationRequest,
): BlockedReason | null {
  if (!isStatusEligible(candidate.status, request.allowUnknownCapabilities)) {
    return statusBlockedReason(candidate.status);
  }
  if (!request.allowUnknownCapabilities && !candidate.hasAgent) {
    // 15.2: nothing could ever claim the job on the auto path without
    // an attached agent.
    return BlockedReason.NO_COMPATIBLE_PRINTER;
  }
  if (
    !capabilitiesMatch(
      candidate.capabilities,
      request.printConfiguration,
      request.allowUnknownCapabilities,
    )
  ) {
    return BlockedReason.NO_COMPATIBLE_PRINTER;
  }
  if (
    candidate.supportedSizes.length > 0 &&
    !candidate.supportedSizes.includes(request.printConfiguration.paperSize)
  ) {
    return BlockedReason.NO_COMPATIBLE_PRINTER;
  }
  if (
    request.printConfiguration.paperType &&
    candidate.supportedPaperTypes.length > 0 &&
    !candidate.supportedPaperTypes.includes(request.printConfiguration.paperType)
  ) {
    return BlockedReason.NO_COMPATIBLE_PRINTER;
  }
  if (candidate.maxJobPages !== null && request.pageCount > candidate.maxJobPages) {
    return BlockedReason.NO_COMPATIBLE_PRINTER;
  }
  if (candidate.pageLimitReached) {
    return BlockedReason.PAGE_LIMIT_REACHED;
  }
  if (candidate.paperAvailable === false) {
    return BlockedReason.NO_PAPER;
  }
  if (candidate.operatorAvailable === false) {
    return BlockedReason.OPERATOR_UNAVAILABLE;
  }
  if (candidate.requiresManualApproval) {
    return BlockedReason.MANUAL_APPROVAL_REQUIRED;
  }
  return null;
}

/** 18.4. Pure: no Prisma, no Nest, no `Date.now()`. Deterministic
 * tie-break among equally-eligible candidates on the auto path: fewest
 * queued pages, then fewest queued jobs, then oldest registration
 * (`registeredAt` ascending), then `id` ascending -- exhaustively
 * proven with a deliberately-ambiguous candidate set in this file's
 * own spec. */
export function allocatePrinter(
  request: AllocationRequest,
  candidates: readonly PrinterCandidate[],
): AllocationResult {
  if (request.requestedPrinterId) {
    const requested = candidates.find((c) => c.id === request.requestedPrinterId);
    if (!requested) {
      return { outcome: "BLOCKED", blockedReason: BlockedReason.NO_COMPATIBLE_PRINTER };
    }
    const reason = blockedReasonFor(requested, request);
    return reason
      ? { outcome: "BLOCKED", blockedReason: reason }
      : { outcome: "ALLOCATED", printerId: requested.id };
  }

  const eligible = candidates.filter((c) => blockedReasonFor(c, request) === null);
  if (eligible.length === 0) {
    // Report the single most common/fundamental reason across every
    // candidate that was considered, defaulting to NO_COMPATIBLE_PRINTER
    // when there were no candidates to begin with.
    const firstReason = candidates.map((c) => blockedReasonFor(c, request)).find((r) => r !== null);
    return {
      outcome: "BLOCKED",
      blockedReason: firstReason ?? BlockedReason.NO_COMPATIBLE_PRINTER,
    };
  }

  const [winner] = [...eligible].sort((a, b) => {
    if (a.queuedPages !== b.queuedPages) return a.queuedPages - b.queuedPages;
    if (a.queuedJobs !== b.queuedJobs) return a.queuedJobs - b.queuedJobs;
    if (a.registeredAt !== b.registeredAt) return a.registeredAt - b.registeredAt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return { outcome: "ALLOCATED", printerId: winner!.id };
}
