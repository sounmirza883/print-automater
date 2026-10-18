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

/** Blocked reasons that mean "no printer was AVAILABLE", so a printer coming
 * back (or a page-limit period rolling over) can resolve them on its own.
 * Everything else needs a human or a different change and must stay parked:
 * NO_COMPATIBLE_PRINTER (the configuration fits nobody), NO_PAPER,
 * OPERATOR_UNAVAILABLE, MANUAL_APPROVAL_REQUIRED (PRD 20/21/122). */
export const AVAILABILITY_BLOCKED_REASONS: readonly string[] = [
  BlockedReason.PRINTER_OFFLINE,
  BlockedReason.PRINTER_DISABLED,
  BlockedReason.PAGE_LIMIT_REACHED,
  // 22.2: waiting only because automatic assignment was switched off; recoverable
  // once it is back on.
  BlockedReason.AUTOMATION_DISABLED,
];

export interface ReallocationOutcome {
  jobId: string;
  action: "ALLOCATED" | "STILL_BLOCKED" | "SKIPPED";
  printerId?: string;
}

export interface ReallocationResult {
  outcomes: ReallocationOutcome[];
  errors: Array<{ jobId: string; error: unknown }>;
  /** Devices to wake AFTER this returns (each allocation already committed). */
  notifyDeviceIds: string[];
}

/** 19.15 (PRD 25/122), 22.2. Queue recovery: for shops that opted in
 * (`auto_failover_enabled`) AND have automatic printer assignment and automatic
 * queue management on (both default on; AUTOMATION_DISABLED jobs need only those two), give every WAITING, unallocated job whose blocked
 * reason is availability-type another chance at allocation. Nothing else
 * re-allocates a job that failover parked, so without this it stays WAITING
 * until staff act.
 *
 * Duplicate printing is the cardinal rule, so this only ever MOVES an existing
 * row WAITING -> QUEUED through the job machine (ALLOCATE): it never creates a
 * job. The precondition (still WAITING, still unallocated, reason still
 * availability-type) is re-checked UNDER the orders/job row locks, so a staff
 * reassign, pause or cancel that wins the race makes this a skipped no-op, and
 * two overlapping recovery ticks serialise on the orders lock with the loser
 * finding the job already QUEUED. The shop's opt-in is re-read under the locks
 * too (19.19), so a toggle switched off mid-tick is honoured. The chosen target is re-validated under the
 * locks too (FOR SHARE on its row), like failover, so a printer that just went
 * offline is never handed a job. Jobs still blocked are left untouched: no
 * write, no audit row per tick. Contained per job. Pure of Nest/Redis: waking
 * agents is the caller's job. */
export async function reallocateWaitingJobs(
  deps: {
    prisma: PrismaService;
    jobMachine: PrintJobStateMachine;
    now?: () => Date;
    /** Test seam: runs after the allocation decision and before the machine
     * call, to force a deterministic interleaving. Never set in production. */
    afterCandidatesRead?: () => Promise<void>;
    onError?: (jobId: string, error: unknown) => void;
  },
  input: {
    shopId?: string;
    /** Blocked reasons to recover (default: the availability set). 20.3 passes
     * [NO_PAPER] after a restock, still behind the shop's opt-in. */
    reasons?: readonly string[];
    /** Audit label (default PRINTER_RECOVERED). */
    trigger?: string;
  } = {},
): Promise<ReallocationResult> {
  const recoverable = input.reasons ?? AVAILABILITY_BLOCKED_REASONS;
  const { prisma, jobMachine } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const result: ReallocationResult = { outcomes: [], errors: [], notifyDeviceIds: [] };

  // print_jobs carries a plain shop_id (no relation), so resolve the eligible shops
  // first: automation must never touch a shop that did not enable it. 22.2: recovery
  // is automatic printer assignment plus automatic queue management, so BOTH toggles
  // must be on (defaults: on). Availability/paper recovery additionally needs the
  // failover opt-in (19.15, unchanged); a job parked only because assignment was
  // switched off (AUTOMATION_DISABLED) does not: switching assignment back on must
  // clear that backlog even for a shop that never opted in to failover.
  const shops = await prisma.shop.findMany({
    where: {
      ...(input.shopId ? { id: input.shopId } : {}),
      OR: [
        { settings: null },
        {
          settings: {
            is: { autoQueueManagementEnabled: true, autoPrinterAssignmentEnabled: true },
          },
        },
      ],
    },
    select: { id: true, autoFailoverEnabled: true },
  });
  if (shops.length === 0) {
    return result;
  }
  const failoverShops = new Set(shops.filter((s) => s.autoFailoverEnabled).map((s) => s.id));
  const jobs = await prisma.printJob.findMany({
    where: {
      shopId: { in: shops.map((shop) => shop.id) },
      status: PrintJobStatus.WAITING,
      printerId: null,
      supersededAt: null,
      orderItemId: { not: null },
      blockedReason: { in: [...recoverable] },
    },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      orderId: true,
      shopId: true,
      branchId: true,
      blockedReason: true,
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
      if (
        !failoverShops.has(job.shopId) &&
        !(job.blockedReason === BlockedReason.AUTOMATION_DISABLED)
      ) {
        continue;
      }
      const config = job.orderItem.printConfiguration as unknown as PrintConfiguration;
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
      // Rebuilt per job: each allocation changes queue load for the next one. Only the job's own
      // branch's printers are ever considered, so recovery never carries a job across branches.
      const built = await buildPrinterCandidates(prisma, job.shopId, job.branchId, now);
      const request = {
        printConfiguration: config,
        pageCount: jp.total,
        pagesPerCopy: jp.pagesPerCopy,
        allowUnknownCapabilities: false,
        rules: built.rules,
      };
      const { deviceIdsByPrinterId } = built;
      const need = paperNeedFor(config, jp);
      const candidates = await withPaperAvailability(prisma, job.shopId, built.candidates, need);
      const allocation = allocatePrinter(request, candidates);
      if (allocation.outcome !== "ALLOCATED") {
        result.outcomes.push({ jobId: job.id, action: "STILL_BLOCKED" });
        continue;
      }
      const targetId = allocation.printerId;
      await deps.afterCandidatesRead?.();

      const guard = async (
        tx: Prisma.TransactionClient,
        locked: { status: PrintJobStatus; printerId: string | null; blockedReason: string | null },
      ): Promise<void> => {
        if (
          locked.status !== PrintJobStatus.WAITING ||
          locked.printerId !== null ||
          locked.blockedReason === null ||
          !recoverable.includes(locked.blockedReason)
        ) {
          throw new AppException(
            HttpStatus.CONFLICT,
            "RECOVERY_JOB_MOVED",
            "The job is no longer waiting for a printer.",
            false,
          );
        }
        // 19.19/22.2 (PRD 122): the toggles were read before the loop. A shop that
        // turned one off mid-tick must not be auto-allocated, so re-read them here
        // under the locks (FOR SHARE on shops then shop_settings, the writer's order:
        // a concurrent toggle write waits for this commit or has already committed
        // and is seen).
        const automation = await readShopAutomationLocked(tx, job.shopId);
        const needsFailover = locked.blockedReason !== BlockedReason.AUTOMATION_DISABLED;
        if (
          !automation.autoQueueManagement ||
          !automation.autoPrinterAssignment ||
          (needsFailover && !automation.autoFailover)
        ) {
          throw new AppException(
            HttpStatus.CONFLICT,
            "RECOVERY_OPTED_OUT",
            "Automatic recovery is switched off for this shop.",
            false,
          );
        }
        await tx.$queryRaw`SELECT id FROM printers WHERE id = ${targetId} FOR SHARE`;
        const fresh = await buildPrinterCandidates(tx, job.shopId, job.branchId, now);
        const freshCandidates = await withPaperAvailability(tx, job.shopId, fresh.candidates, need);
        const recheck = allocatePrinter(
          request,
          freshCandidates.filter((c) => c.id === targetId),
        );
        if (recheck.outcome === "BLOCKED") {
          throw new AppException(
            HttpStatus.CONFLICT,
            "RECOVERY_TARGET_STALE",
            "The chosen printer is no longer suitable.",
            false,
          );
        }
      };

      try {
        await jobMachine.transition(
          job.id,
          PrintJobEvent.ALLOCATE,
          { id: null },
          {
            guard,
            printerId: targetId,
            blockedReason: null,
            metadata: {
              automatic: true,
              trigger: input.trigger ?? "PRINTER_RECOVERED",
              toPrinterId: targetId,
            },
          },
        );
      } catch (error) {
        if (
          error instanceof AppException &&
          (error.errorCode === "RECOVERY_JOB_MOVED" ||
            error.errorCode === "RECOVERY_OPTED_OUT" ||
            error.errorCode === "RECOVERY_TARGET_STALE" ||
            error.errorCode === "ILLEGAL_JOB_TRANSITION")
        ) {
          result.outcomes.push({ jobId: job.id, action: "SKIPPED" });
          continue;
        }
        throw error;
      }
      result.outcomes.push({ jobId: job.id, action: "ALLOCATED", printerId: targetId });
      const deviceId = deviceIdsByPrinterId.get(targetId);
      if (deviceId && !result.notifyDeviceIds.includes(deviceId)) {
        result.notifyDeviceIds.push(deviceId);
      }
    } catch (error) {
      result.errors.push({ jobId: job.id, error });
      deps.onError?.(job.id, error);
    }
  }
  return result;
}
