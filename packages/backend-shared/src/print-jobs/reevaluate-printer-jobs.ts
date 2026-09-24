import { HttpStatus } from "@nestjs/common";
import { PrintJobStatus } from "@prisma/client";
import { BlockedReason } from "@print-automated/types";
import type { PrintConfiguration } from "@print-automated/types";
import { AppException } from "../errors/app-exception.js";
import type { PrismaService } from "../prisma/prisma.service.js";
import { allocatePrinter } from "./allocate-printer.js";
import { jobPages } from "./job-pages.js";
import { PrintJobEvent, type PrintJobStateMachine } from "./print-job-state-machine.js";
import { buildPrinterCandidates } from "./printer-candidates.js";

/** Why a printer stopped being suitable. Recorded on every automatic move
 * (PRD 80/122: every automated decision is traceable). */
export type FailoverTrigger = "PRINTER_DISABLED" | "PRINTER_ERROR" | "PAGE_LIMIT_REACHED";

export interface ReevaluationOutcome {
  jobId: string;
  action: "MOVED" | "BLOCKED" | "SKIPPED";
  successorJobId?: string;
  toPrinterId?: string;
  blockedReason?: string;
}

export interface ReevaluationResult {
  outcomes: ReevaluationOutcome[];
  /** Devices whose long-poll the CALLER must wake AFTER this returns (each
   * move already committed). Waking is API-specific (Redis list), so it is
   * deliberately not done here: the worker's offline sweep (19.5) reuses this
   * function and does its own notification. */
  notifyDeviceIds: string[];
}

const TRIGGER_BLOCKED_REASON: Record<FailoverTrigger, string> = {
  PRINTER_DISABLED: BlockedReason.PRINTER_DISABLED,
  PRINTER_ERROR: BlockedReason.PRINTER_OFFLINE,
  PAGE_LIMIT_REACHED: BlockedReason.PAGE_LIMIT_REACHED,
};

/** 19.4 (PRD 25). A printer became unsuitable: when the shop has opted in
 * (`auto_failover_enabled`), re-run allocation for that printer's QUEUED,
 * not-yet-claimed jobs, excluding that printer, and move each through the job
 * machine (SUPERSEDE + successor + order sync in ONE transaction) or, if no
 * printer qualifies, return the job to WAITING with a visible blockedReason
 * (UNALLOCATE). Never touches CLAIMED/PRINTING/PRINTED: an agent may already
 * be printing, and moving it would duplicate paper. The status check is
 * repeated UNDER the row lock (ctx.guard), so a claim that wins the race
 * simply makes the move a skipped no-op, and two concurrent triggers on the
 * same printer serialise on the orders lock: the loser finds the job already
 * REASSIGNED and skips it, so an item never gets two live jobs.
 *
 * Candidates are read outside the machine's transaction (the machine accepts
 * no caller tx by design). The window that leaves (the chosen printer itself
 * becoming unsuitable before commit) is closed by that printer's own trigger
 * re-running this function. Pure of Nest/HTTP/Redis: deps are passed in. */
export async function reevaluatePrinterJobs(
  deps: { prisma: PrismaService; jobMachine: PrintJobStateMachine; now?: () => Date },
  input: { shopId: string; printerId: string; trigger: FailoverTrigger },
): Promise<ReevaluationResult> {
  const { prisma, jobMachine } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const result: ReevaluationResult = { outcomes: [], notifyDeviceIds: [] };

  const shop = await prisma.shop.findUnique({
    where: { id: input.shopId },
    select: { autoFailoverEnabled: true },
  });
  if (!shop?.autoFailoverEnabled) {
    return result;
  }

  const jobs = await prisma.printJob.findMany({
    where: {
      shopId: input.shopId,
      printerId: input.printerId,
      status: PrintJobStatus.QUEUED,
      supersededAt: null,
      orderItemId: { not: null },
    },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      orderItem: {
        select: {
          quantity: true,
          printConfiguration: true,
          document: { select: { pageCount: true } },
        },
      },
    },
  });

  for (const job of jobs) {
    if (!job.orderItem) {
      continue;
    }
    const pages = jobPages(job.orderItem.document.pageCount, job.orderItem.quantity);
    const { candidates, deviceIdsByPrinterId } = await buildPrinterCandidates(
      prisma,
      input.shopId,
      now,
    );

    if (input.trigger === "PAGE_LIMIT_REACHED") {
      // Only jobs that no longer fit the remaining allowance move; a small
      // job that still fits stays (same remaining-vs-pages rule as allocation).
      const self = candidates.find((c) => c.id === input.printerId);
      if (self && (self.pageLimitRemaining == null || pages <= self.pageLimitRemaining)) {
        result.outcomes.push({ jobId: job.id, action: "SKIPPED" });
        continue;
      }
    }

    const allocation = allocatePrinter(
      {
        printConfiguration: job.orderItem.printConfiguration as unknown as PrintConfiguration,
        pageCount: pages,
        allowUnknownCapabilities: false,
        excludePrinterIds: [input.printerId],
      },
      candidates,
    );

    const guard = async (
      _tx: unknown,
      locked: { status: PrintJobStatus; printerId: string | null },
    ): Promise<void> => {
      if (locked.status !== PrintJobStatus.QUEUED || locked.printerId !== input.printerId) {
        throw new AppException(
          HttpStatus.CONFLICT,
          "FAILOVER_JOB_MOVED",
          "The job is no longer queued on this printer.",
          false,
        );
      }
    };

    try {
      if (allocation.outcome === "ALLOCATED") {
        const moved = await jobMachine.transition(
          job.id,
          PrintJobEvent.SUPERSEDE,
          { id: null },
          {
            guard,
            successor: { printerId: allocation.printerId },
            metadata: {
              automatic: true,
              trigger: input.trigger,
              fromPrinterId: input.printerId,
              toPrinterId: allocation.printerId,
            },
          },
        );
        result.outcomes.push({
          jobId: job.id,
          action: "MOVED",
          successorJobId: moved.successorJobId,
          toPrinterId: allocation.printerId,
        });
        const deviceId = deviceIdsByPrinterId.get(allocation.printerId);
        if (deviceId && !result.notifyDeviceIds.includes(deviceId)) {
          result.notifyDeviceIds.push(deviceId);
        }
      } else {
        // Nothing else qualifies. With no other printer at all, name the
        // trigger; otherwise the allocator's own reason (e.g. the other
        // printer is offline, or at its page limit) is more actionable.
        const others = candidates.filter((c) => c.id !== input.printerId);
        const blockedReason =
          others.length === 0 ? TRIGGER_BLOCKED_REASON[input.trigger] : allocation.blockedReason;
        await jobMachine.transition(
          job.id,
          PrintJobEvent.UNALLOCATE,
          { id: null },
          {
            guard,
            printerId: null,
            blockedReason,
            metadata: {
              automatic: true,
              trigger: input.trigger,
              fromPrinterId: input.printerId,
              blockedReason,
            },
          },
        );
        result.outcomes.push({ jobId: job.id, action: "BLOCKED", blockedReason });
      }
    } catch (error) {
      if (
        error instanceof AppException &&
        (error.errorCode === "FAILOVER_JOB_MOVED" || error.errorCode === "ILLEGAL_JOB_TRANSITION")
      ) {
        result.outcomes.push({ jobId: job.id, action: "SKIPPED" });
        continue;
      }
      throw error;
    }
  }
  return result;
}
