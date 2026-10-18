import { HttpStatus } from "@nestjs/common";
import { PrintJobStatus, type Prisma } from "@prisma/client";
import { BlockedReason } from "@print-automated/types";
import type { PrintConfiguration } from "@print-automated/types";
import { AppException } from "../errors/app-exception.js";
import type { PrismaService } from "../prisma/prisma.service.js";
import { allocatePrinter } from "./allocate-printer.js";
import { jobPages, type JobConfig } from "./job-pages.js";
import { logJobPagesFallback } from "./job-pages-log.js";
import { paperNeedFor, withPaperAvailability } from "../inventory/paper-availability.js";
import { PrintJobEvent, type PrintJobStateMachine } from "./print-job-state-machine.js";
import { buildPrinterCandidates } from "./printer-candidates.js";
import { readShopAutomationLocked } from "../settings/shop-automation.js";

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
  /** Per-job failures that were contained (one poison job must not block the
   * rest, the same head-of-line lesson as the print-timeout sweep). Callers
   * must log/surface these but never fail their own request because of them. */
  errors: Array<{ jobId: string; error: unknown }>;
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
 * no caller tx by design), so the chosen TARGET is re-validated inside the
 * machine's guard, under the locks, with the same allocator rules, and its
 * row is held FOR SHARE until commit. A stale target makes the job WAITING
 * with the target's blocked reason instead of being stranded QUEUED on it.
 * (The target's own trigger cannot be relied on: it may have already run and
 * found nothing to move.) Pure of Nest/HTTP/Redis: deps are passed in. */
export async function reevaluatePrinterJobs(
  deps: {
    prisma: PrismaService;
    jobMachine: PrintJobStateMachine;
    now?: () => Date;
    /** Test seam: runs between the candidate read and the machine call, to
     * force a deterministic interleaving. Never set in production. */
    afterCandidatesRead?: () => Promise<void>;
    /** Called for each contained per-job failure (logging). */
    onError?: (jobId: string, error: unknown) => void;
  },
  input: { shopId: string; printerId: string; trigger: FailoverTrigger },
): Promise<ReevaluationResult> {
  const { prisma, jobMachine } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const result: ReevaluationResult = { outcomes: [], errors: [], notifyDeviceIds: [] };

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
      orderId: true,
      branchId: true,
      orderItem: {
        select: {
          documentId: true,
          quantity: true,
          printConfiguration: true,
          document: { select: { pageCount: true } },
        },
      },
    },
  });

  for (const job of jobs) {
    try {
      if (!job.orderItem) {
        continue;
      }
      const jp = jobPages(
        job.orderItem.printConfiguration as unknown as JobConfig,
        job.orderItem.document.pageCount,
        job.orderItem.quantity,
        logJobPagesFallback({
          jobId: job.id,
          orderId: job.orderId,
          documentId: job.orderItem.documentId,
        }),
      );
      const pages = jp.total;
      // The failed printer's jobs are in its branch; their replacement printer must be too.
      const built = await buildPrinterCandidates(prisma, input.shopId, job.branchId, now);
      const { deviceIdsByPrinterId } = built;
      // 20.3: the paper gate applies to failover's automatic re-allocation too
      // (a no-op unless the shop enabled inventory tracking).
      const need = paperNeedFor(
        job.orderItem.printConfiguration as unknown as PrintConfiguration,
        jp,
      );
      const candidates = await withPaperAvailability(prisma, input.shopId, built.candidates, need);

      await deps.afterCandidatesRead?.();

      if (input.trigger === "PAGE_LIMIT_REACHED") {
        // Only jobs that no longer fit the remaining allowance move; a small
        // job that still fits stays (same remaining-vs-pages rule as allocation).
        const self = candidates.find((c) => c.id === input.printerId);
        if (self && (self.pageLimitRemaining == null || pages <= self.pageLimitRemaining)) {
          result.outcomes.push({ jobId: job.id, action: "SKIPPED" });
          continue;
        }
      }

      // 22.2 (PRD 76/122): picking another printer IS automatic printer assignment.
      // With it switched off, failover still takes the job off the unsuitable printer
      // (it must not sit queued on it) but parks it visibly for staff instead of
      // choosing a new printer.
      const assignmentOff = !built.automation.autoPrinterAssignment;
      const allocation: ReturnType<typeof allocatePrinter> = assignmentOff
        ? { outcome: "BLOCKED", blockedReason: BlockedReason.AUTOMATION_DISABLED }
        : allocatePrinter(
            {
              printConfiguration: job.orderItem.printConfiguration as unknown as PrintConfiguration,
              pageCount: pages,
              pagesPerCopy: jp.pagesPerCopy,
              allowUnknownCapabilities: false,
              excludePrinterIds: [input.printerId],
              rules: built.rules,
            },
            candidates,
          );

      const guard = async (
        _tx: Prisma.TransactionClient,
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

      const request = {
        printConfiguration: job.orderItem.printConfiguration as unknown as PrintConfiguration,
        pageCount: pages,
        pagesPerCopy: jp.pagesPerCopy,
        allowUnknownCapabilities: false,
        excludePrinterIds: [input.printerId],
      };
      const unallocate = async (
        blockedReason: string,
        extra: Record<string, unknown> = {},
      ): Promise<void> => {
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
              ...extra,
            },
          },
        );
        result.outcomes.push({ jobId: job.id, action: "BLOCKED", blockedReason });
      };

      try {
        if (allocation.outcome === "ALLOCATED") {
          const targetId = allocation.printerId;
          let staleReason: string | undefined;
          // Re-check the TARGET under the lock, with the same eligibility the
          // allocator used. FOR SHARE on the printer row makes it airtight:
          // a staff disable / heartbeat UPDATE of that row must wait until this
          // move commits, and its own trigger then sees (and re-moves) the job.
          const targetGuard = async (
            tx: Prisma.TransactionClient,
            locked: { status: PrintJobStatus; printerId: string | null },
          ): Promise<void> => {
            await guard(tx, locked);
            // 22.2: assignment switched off since the candidate read? Re-read under
            // the locks and park the job instead of handing it to a printer.
            const automation = await readShopAutomationLocked(tx, input.shopId);
            if (!automation.autoPrinterAssignment) {
              staleReason = BlockedReason.AUTOMATION_DISABLED;
              throw new AppException(
                HttpStatus.CONFLICT,
                "FAILOVER_TARGET_STALE",
                "Automatic printer assignment was switched off.",
                false,
              );
            }
            await tx.$queryRaw`SELECT id FROM printers WHERE id = ${targetId} FOR SHARE`;
            const fresh = await buildPrinterCandidates(tx, input.shopId, job.branchId, now);
            const freshCandidates = await withPaperAvailability(
              tx,
              input.shopId,
              fresh.candidates,
              need,
            );
            const recheck = allocatePrinter(
              request,
              freshCandidates.filter((c) => c.id === targetId),
            );
            if (recheck.outcome === "BLOCKED") {
              staleReason = recheck.blockedReason;
              throw new AppException(
                HttpStatus.CONFLICT,
                "FAILOVER_TARGET_STALE",
                "The chosen target printer is no longer suitable.",
                false,
              );
            }
          };
          try {
            const moved = await jobMachine.transition(
              job.id,
              PrintJobEvent.SUPERSEDE,
              { id: null },
              {
                guard: targetGuard,
                successor: { printerId: targetId },
                metadata: {
                  automatic: true,
                  trigger: input.trigger,
                  fromPrinterId: input.printerId,
                  toPrinterId: targetId,
                },
              },
            );
            result.outcomes.push({
              jobId: job.id,
              action: "MOVED",
              successorJobId: moved.successorJobId,
              toPrinterId: targetId,
            });
            const deviceId = deviceIdsByPrinterId.get(targetId);
            if (deviceId && !result.notifyDeviceIds.includes(deviceId)) {
              result.notifyDeviceIds.push(deviceId);
            }
          } catch (error) {
            if (error instanceof AppException && error.errorCode === "FAILOVER_TARGET_STALE") {
              // Never leave the job live on a printer that just became
              // unsuitable: park it visibly so staff can act.
              const reason = staleReason ?? TRIGGER_BLOCKED_REASON[input.trigger];
              await unallocate(reason, { staleTargetId: targetId, staleReason: reason });
            } else {
              throw error;
            }
          }
        } else {
          // Nothing else qualifies. With no other printer at all, name the
          // trigger; otherwise the allocator's own reason (e.g. the other
          // printer is offline, or at its page limit) is more actionable.
          const others = candidates.filter((c) => c.id !== input.printerId);
          await unallocate(
            assignmentOff
              ? BlockedReason.AUTOMATION_DISABLED
              : others.length === 0
                ? TRIGGER_BLOCKED_REASON[input.trigger]
                : allocation.blockedReason,
          );
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
    } catch (error) {
      // Contain EVERYTHING per job: keep going with the rest.
      result.errors.push({ jobId: job.id, error });
      deps.onError?.(job.id, error);
    }
  }
  return result;
}
