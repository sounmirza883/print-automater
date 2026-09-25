import { HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import {
  JobFailureReason,
  OrderStatus,
  Prisma,
  PrintJobStatus,
  ShopStaffStatus,
  UserRole,
} from "@prisma/client";
import { BlockedReason, type PrintConfiguration } from "@print-automated/types";
import {
  allocatePrinter,
  AppException,
  AuditService,
  buildPrinterCandidates,
  jobPages,
  logJobPagesFallback,
  paperNeedFor,
  PrintJobEvent,
  PrintJobStateMachine,
  PrismaService,
  withPaperAvailability,
  type AllocationRequest,
  type PrinterCandidate,
} from "@print-automated/backend-shared";
import { AgentJobsService } from "../agents/agent-jobs.service.js";
import { AuditAction } from "../audit/audit-action.js";

export interface PrintJobResponse {
  id: string;
  orderId: string;
  status: string;
  printerId: string | null;
  printerName: string | null;
  operatorId: string | null;
  blockedReason: string | null;
  failureReason: string | null;
  failureNote: string | null;
  priority: number;
  attempt: number;
}

/** Order statuses in which a paused job may be resumed: the derived,
 * still-in-production ones. A closed order (cancelled, ready, completed...)
 * must never get a job dispatched again. */
const RESUMABLE_ORDER_STATUSES: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.QUEUED_FOR_PRINT,
  OrderStatus.PRINTING,
  OrderStatus.PRINTED,
  OrderStatus.PRINT_FAILED,
  OrderStatus.PRINT_STATUS_UNKNOWN,
  OrderStatus.PREPARING,
  OrderStatus.ASSIGNED,
  OrderStatus.PAUSED,
  OrderStatus.QUALITY_CHECK,
]);

type ResumePlan =
  | {
      kind: "QUEUE";
      printerId: string;
      deviceId: string | undefined;
      request: AllocationRequest;
      explicit: boolean;
      need: ReturnType<typeof paperNeedFor>;
    }
  | { kind: "BLOCK"; blockedReason: string };

/** 18.7/18.9. Every reassignment and manual operator assignment reuses
 * 16.6's own `AuditService` pattern (a plain post-write `record()` call,
 * the same convention printers.service.ts/refund.service.ts already
 * establish) -- no bespoke audit mechanism invented for this phase. */
@Injectable()
export class PrintJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobStateMachine: PrintJobStateMachine,
    private readonly agentJobsService: AgentJobsService,
    private readonly audit: AuditService,
  ) {}

  /** §20/§80/18.7: staff's own manual reassignment of a job to a
   * different printer, independent of (and available even outside) the
   * PRINT_FAILED "Change Printer" recovery flow 10.4/18.5 already cover
   * -- e.g. rebalancing a healthy queue, not just recovering a failed
   * one. Legal only from WAITING/QUEUED/CLAIMED (the job machine's own
   * SUPERSEDE transitions) -- a job that's already PRINTING or done
   * can't be handed to a different printer after the fact.
   *
   * The OLD job row's own terminal status is REASSIGNED (not FAILED --
   * nothing about it failed) and `supersededAt` is set in the same
   * write (print-job-state-machine.ts's own SUPERSEDE handling); the
   * NEW row starts a fresh attempt at CREATED->QUEUED on the requested
   * printer. */
  async reassign(
    jobId: string,
    actorId: string,
    newPrinterId: string,
    reason: string,
  ): Promise<PrintJobResponse> {
    const job = await this.prisma.printJob.findUnique({
      where: { id: jobId },
      select: { orderId: true, shopId: true, printerId: true, orderItemId: true },
    });
    if (!job) {
      throw new NotFoundException("Print job not found.");
    }
    if (!job.orderItemId) {
      throw new AppException(
        HttpStatus.CONFLICT,
        "JOB_NOT_REASSIGNABLE",
        "This job has no order item to re-dispatch against.",
        false,
      );
    }

    const deviceId = await this.validateTargetPrinter(job.shopId, job.orderItemId, newPrinterId);

    // 18.18: supersede + successor creation + order sync are ONE
    // transaction inside the job machine, under the orders-row lock it
    // takes first. A second concurrent reassign of the same job blocks
    // on that lock, then finds the job already REASSIGNED and gets a
    // clean 409 ILLEGAL_JOB_TRANSITION; a unique-violation on the
    // idempotency token (P2002) is mapped to a 409 as well, never a 500.
    let replacementId: string;
    try {
      const result = await this.jobStateMachine.transition(
        jobId,
        PrintJobEvent.SUPERSEDE,
        { id: actorId },
        { metadata: { reason, newPrinterId }, successor: { printerId: newPrinterId } },
      );
      replacementId = result.successorJobId!;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AppException(
          HttpStatus.CONFLICT,
          "REASSIGN_CONFLICT",
          "This job was reassigned concurrently; refresh and try again.",
          true,
        );
      }
      throw error;
    }

    // Only after commit: wake the new device's long-poll.
    await this.agentJobsService.notify(deviceId);

    const replacement = await this.prisma.printJob.findUniqueOrThrow({
      where: { id: replacementId },
      include: { printer: { select: { name: true } } },
    });

    // 18.7's own Done-when: who (actorId), when (createdAt, implicit in
    // every audit row), previous printer, new printer, reason -- all
    // five, in one row.
    await this.audit.record({
      actorId,
      action: AuditAction.JOB_REASSIGNED,
      resourceType: "print_job",
      resourceId: replacement.id,
      metadata: {
        previousJobId: jobId,
        previousPrinterId: job.printerId,
        newPrinterId,
        reason,
        orderId: job.orderId,
      },
    });

    return this.toResponse(replacement);
  }

  /** 18.18: the manual reassign target must be usable NOW, not merely
   * exist in the shop: not DISABLED, an attached agent (otherwise the job
   * would sit until the print timeout), and capability-compatible with
   * the item unless its capabilities were never probed (manual semantics,
   * `allowUnknownCapabilities: true`). Returns the agent's deviceId. */
  private async validateTargetPrinter(
    shopId: string,
    orderItemId: string,
    printerId: string,
  ): Promise<string> {
    const printer = await this.prisma.printer.findFirst({
      where: { id: printerId, shopId },
      include: { agent: { select: { deviceId: true } } },
    });
    if (!printer) {
      throw new AppException(
        HttpStatus.CONFLICT,
        "PRINTER_NOT_AVAILABLE",
        "That printer is not available for this shop.",
        true,
      );
    }
    if (!printer.agent) {
      throw new AppException(
        HttpStatus.CONFLICT,
        "PRINTER_HAS_NO_AGENT",
        "That printer has no print agent attached, so it cannot receive jobs.",
        true,
      );
    }
    const item = await this.prisma.orderItem.findUniqueOrThrow({
      where: { id: orderItemId },
      select: {
        printConfiguration: true,
        quantity: true,
        document: { select: { pageCount: true } },
      },
    });
    const jp = jobPages(
      item.printConfiguration as unknown as PrintConfiguration,
      item.document.pageCount,
      item.quantity,
      logJobPagesFallback({ orderItemId }),
    );
    const pageFigures = { pageCount: jp.total, pagesPerCopy: jp.pagesPerCopy };
    const allocation = allocatePrinter(
      {
        printConfiguration: item.printConfiguration as unknown as PrintConfiguration,
        ...pageFigures,
        allowUnknownCapabilities: true,
        requestedPrinterId: printerId,
      },
      [
        {
          id: printer.id,
          status: printer.status,
          hasAgent: true,
          capabilities: printer.capabilities as PrinterCandidate["capabilities"],
          supportedSizes: printer.supportedSizes,
          supportedPaperTypes: printer.supportedPaperTypes,
          maxJobPages: printer.maxJobPages,
          queuedPages: 0,
          queuedJobs: 0,
          registeredAt: printer.createdAt.getTime(),
        },
      ],
    );
    if (allocation.outcome === "BLOCKED") {
      const unavailable =
        allocation.blockedReason === "PRINTER_DISABLED" ||
        allocation.blockedReason === "PRINTER_OFFLINE";
      throw new AppException(
        HttpStatus.CONFLICT,
        unavailable ? "PRINTER_NOT_AVAILABLE" : "PRINTER_CAPABILITY_MISMATCH",
        unavailable
          ? "That printer is not available for this shop."
          : "That printer cannot fulfil this job's configuration.",
        unavailable,
      );
    }
    return printer.agent.deviceId;
  }

  /** §21/18.9: manual assignment of a job to a specific OPERATOR user,
   * shop-scoped -- the target must be ACTIVE shop staff with role
   * OPERATOR at THIS job's own shop, the same "never trust a caller-
   * supplied id without checking shop membership" rule every other
   * shop-scoped write in this codebase already follows. Not routed
   * through PrintJobStateMachine: `operatorId` isn't part of the
   * status lifecycle (a job can be reassigned an operator at any
   * non-terminal status without that alone changing what it's doing),
   * so this is a plain field update, exempt from the print_jobs.status
   * ESLint rule the same way `printJob.create()` already is. */
  async assignOperator(
    jobId: string,
    actorId: string,
    operatorId: string | null,
  ): Promise<PrintJobResponse> {
    const job = await this.prisma.printJob.findUnique({
      where: { id: jobId },
      select: { shopId: true },
    });
    if (!job) {
      throw new NotFoundException("Print job not found.");
    }

    if (operatorId) {
      const staff = await this.prisma.shopStaff.findFirst({
        where: { shopId: job.shopId, userId: operatorId, status: ShopStaffStatus.ACTIVE },
        include: { user: { select: { role: true } } },
      });
      if (!staff || staff.user.role !== UserRole.OPERATOR) {
        throw new AppException(
          HttpStatus.CONFLICT,
          "INVALID_OPERATOR",
          "That user is not an active OPERATOR at this shop.",
          false,
        );
      }
    }

    const updated = await this.prisma.printJob.update({
      where: { id: jobId },
      data: { operatorId },
      include: { printer: { select: { name: true } } },
    });

    await this.audit.record({
      actorId,
      action: AuditAction.JOB_OPERATOR_ASSIGNED,
      resourceType: "print_job",
      resourceId: jobId,
      metadata: { operatorId },
    });

    return this.toResponse(updated);
  }

  /** 21.1 (§65): staff pause. Legal only from WAITING/QUEUED (the machine's
   * own table): a CLAIMED/PRINTING job is in an agent's hands and pausing it
   * would only invite a duplicate, so it is a clean 409. The job is unallocated
   * (printerId null) and its stale blockedReason cleared: resume decides both
   * afresh. Two concurrent pauses serialise on the machine's orders-row lock;
   * the loser finds the job PAUSED and gets ILLEGAL_JOB_TRANSITION. */
  async pause(jobId: string, actorId: string, reason?: string): Promise<PrintJobResponse> {
    await this.jobStateMachine.transition(
      jobId,
      PrintJobEvent.PAUSE,
      { id: actorId },
      {
        printerId: null,
        blockedReason: null,
        // 21.6: a late-print hold must survive a staff pause (never clear it).
        keepBlockedReasons: [BlockedReason.MANUAL_APPROVAL_REQUIRED],
        metadata: { source: "STAFF", ...(reason ? { reason } : {}) },
      },
    );
    return this.loadResponse(jobId);
  }

  /** 21.1 (§65): staff resume. Never leaves the job with the stale
   * MANUAL_APPROVAL_REQUIRED the late-print hold (19.18) set: allocation is
   * re-run (or the named printer validated) and the job either goes straight
   * to QUEUED on a printer re-validated UNDER the locks, or to WAITING with the
   * fresh reason allocation returned (visible to staff and to the recovery
   * sweep). A job held because a late PRINTED report says its paper may
   * already exist needs `acknowledgeLatePrint`, recorded as its own audit row
   * in the same transaction. */
  async resume(
    jobId: string,
    actorId: string,
    opts: { printerId?: string; acknowledgeLatePrint?: boolean } = {},
  ): Promise<PrintJobResponse> {
    const job = await this.prisma.printJob.findUnique({
      where: { id: jobId },
      select: {
        status: true,
        orderId: true,
        shopId: true,
        orderItemId: true,
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
    if (!job) {
      throw new NotFoundException("Print job not found.");
    }
    if (job.status !== PrintJobStatus.PAUSED) {
      throw new AppException(
        HttpStatus.CONFLICT,
        "ILLEGAL_JOB_TRANSITION",
        `Cannot apply RESUME to a print job in ${job.status}.`,
        false,
      );
    }
    if (!job.orderItemId || !job.orderItem) {
      throw new AppException(
        HttpStatus.CONFLICT,
        "JOB_NOT_RESUMABLE",
        "This job has no order item to re-dispatch against.",
        false,
      );
    }

    const plan = await this.planResume(job.shopId, job.orderItem, opts.printerId);

    const guard = async (
      tx: Prisma.TransactionClient,
      locked: { id: string; orderId: string; blockedReason: string | null },
    ): Promise<void> => {
      const orderRows = await tx.$queryRaw<Array<{ order_status: OrderStatus }>>`
        SELECT order_status FROM orders WHERE id = ${locked.orderId}
      `;
      if (!orderRows[0] || !RESUMABLE_ORDER_STATUSES.has(orderRows[0].order_status)) {
        throw new AppException(
          HttpStatus.CONFLICT,
          "ORDER_NOT_ACTIVE",
          "This job's order is closed, so the job cannot be resumed.",
          false,
        );
      }

      // Duplicate printing is the cardinal rule: a job held by a late PRINTED
      // report resumes only on an explicit, audited acknowledgement.
      const hold = await tx.auditLog.findFirst({
        where: {
          action: "PRINT_JOB_LATE_PRINT_SUCCESSOR",
          metadata: { path: ["successorJobId"], equals: locked.id },
        },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, resourceId: true },
      });
      const ack = await tx.auditLog.findFirst({
        where: { action: "PRINT_JOB_LATE_PRINT_ACKNOWLEDGED", resourceId: locked.id },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      const heldByLatePrint =
        locked.blockedReason === BlockedReason.MANUAL_APPROVAL_REQUIRED ||
        (hold !== null && (ack === null || ack.createdAt < hold.createdAt));
      if (heldByLatePrint) {
        if (opts.acknowledgeLatePrint !== true) {
          throw new AppException(
            HttpStatus.CONFLICT,
            "LATE_PRINT_ACK_REQUIRED",
            "This job was held because an earlier attempt for the same item reported PRINTED late, so its paper may already exist. Check the output, then resume with acknowledgeLatePrint.",
            false,
          );
        }
        await tx.auditLog.create({
          data: {
            actorId,
            action: "PRINT_JOB_LATE_PRINT_ACKNOWLEDGED",
            resourceType: "print_job",
            resourceId: locked.id,
            metadata: { supersededJobId: hold?.resourceId ?? null, orderId: locked.orderId },
          },
        });
      }

      if (plan.kind === "QUEUE") {
        // Same re-validation the recovery sweep does: the chosen printer must
        // still be suitable now that the job/order locks are held.
        await tx.$queryRaw`SELECT id FROM printers WHERE id = ${plan.printerId} FOR SHARE`;
        const fresh = await buildPrinterCandidates(tx, job.shopId, new Date());
        const freshCandidates = plan.explicit
          ? fresh.candidates
          : await withPaperAvailability(tx, job.shopId, fresh.candidates, plan.need);
        const recheck = allocatePrinter(
          plan.request,
          freshCandidates.filter((candidate) => candidate.id === plan.printerId),
        );
        if (recheck.outcome === "BLOCKED") {
          throw new AppException(
            HttpStatus.CONFLICT,
            "RESUME_TARGET_STALE",
            "The chosen printer is no longer suitable; try resuming again.",
            true,
          );
        }
      }
    };

    await this.jobStateMachine.transition(
      jobId,
      plan.kind === "QUEUE" ? PrintJobEvent.RESUME_QUEUE : PrintJobEvent.RESUME,
      { id: actorId },
      plan.kind === "QUEUE"
        ? {
            guard,
            printerId: plan.printerId,
            blockedReason: null,
            metadata: {
              printerId: plan.printerId,
              explicitPrinter: plan.explicit,
              acknowledgedLatePrint: opts.acknowledgeLatePrint === true,
            },
          }
        : {
            guard,
            printerId: null,
            blockedReason: plan.blockedReason,
            metadata: {
              blockedReason: plan.blockedReason,
              acknowledgedLatePrint: opts.acknowledgeLatePrint === true,
            },
          },
    );

    if (plan.kind === "QUEUE" && plan.deviceId) {
      // Only after commit: wake the printer's agent long-poll.
      await this.agentJobsService.notify(plan.deviceId);
    }
    return this.loadResponse(jobId);
  }

  private async planResume(
    shopId: string,
    item: {
      documentId: string;
      quantity: number;
      printConfiguration: Prisma.JsonValue;
      document: { pageCount: number | null };
    },
    requestedPrinterId: string | undefined,
  ): Promise<ResumePlan> {
    const config = item.printConfiguration as unknown as PrintConfiguration;
    const jp = jobPages(
      config,
      item.document.pageCount,
      item.quantity,
      logJobPagesFallback({ documentId: item.documentId }),
    );
    const need = paperNeedFor(config, jp);
    const built = await buildPrinterCandidates(this.prisma, shopId, new Date());
    const request: AllocationRequest = {
      printConfiguration: config,
      pageCount: jp.total,
      pagesPerCopy: jp.pagesPerCopy,
      allowUnknownCapabilities: requestedPrinterId !== undefined,
      requestedPrinterId,
    };
    // The paper gate is an automatic-path check; naming a printer overrides it.
    const candidates =
      requestedPrinterId === undefined
        ? await withPaperAvailability(this.prisma, shopId, built.candidates, need)
        : built.candidates;
    const allocation = allocatePrinter(request, candidates);
    if (allocation.outcome === "ALLOCATED") {
      return {
        kind: "QUEUE",
        printerId: allocation.printerId,
        deviceId: built.deviceIdsByPrinterId.get(allocation.printerId),
        request,
        explicit: requestedPrinterId !== undefined,
        need,
      };
    }
    if (requestedPrinterId !== undefined) {
      const unavailable =
        allocation.blockedReason === BlockedReason.PRINTER_DISABLED ||
        allocation.blockedReason === BlockedReason.PRINTER_OFFLINE ||
        !built.candidates.some((candidate) => candidate.id === requestedPrinterId);
      throw new AppException(
        HttpStatus.CONFLICT,
        unavailable ? "PRINTER_NOT_AVAILABLE" : "PRINTER_CAPABILITY_MISMATCH",
        unavailable
          ? "That printer is not available for this shop."
          : "That printer cannot fulfil this job's configuration.",
        unavailable,
      );
    }
    return { kind: "BLOCK", blockedReason: allocation.blockedReason };
  }

  /** 21.2 (§66): record the operator's failure-reason pick on a job that has
   * failed (FAILED, or TIMEOUT which is the sweep's own failure). The status is
   * only READ here, under the same orders-then-job lock order the job machine
   * uses; this never writes it (print_jobs.status has one writer). A later pick
   * replaces the earlier one and the audit row keeps the previous reason. */
  async recordFailureReason(
    jobId: string,
    actorId: string,
    reason: JobFailureReason,
    note?: string,
  ): Promise<PrintJobResponse> {
    await this.prisma.$transaction(
      async (tx) => {
        const found = await tx.printJob.findUnique({
          where: { id: jobId },
          select: { orderId: true },
        });
        if (!found) {
          throw new NotFoundException("Print job not found.");
        }
        await tx.$queryRaw`SELECT id FROM orders WHERE id = ${found.orderId} FOR UPDATE`;
        const rows = await tx.$queryRaw<
          Array<{ status: PrintJobStatus; failureReason: JobFailureReason | null }>
        >`
          SELECT status, failure_reason AS "failureReason" FROM print_jobs WHERE id = ${jobId} FOR UPDATE
        `;
        const row = rows[0];
        if (!row) {
          throw new NotFoundException("Print job not found.");
        }
        if (row.status !== PrintJobStatus.FAILED && row.status !== PrintJobStatus.TIMEOUT) {
          throw new AppException(
            HttpStatus.CONFLICT,
            "JOB_NOT_FAILED",
            `A failure reason can only be recorded on a failed job; this one is ${row.status}.`,
            false,
          );
        }
        await tx.printJob.update({
          where: { id: jobId },
          data: { failureReason: reason, failureNote: note ?? null },
        });
        await tx.auditLog.create({
          data: {
            actorId,
            action: AuditAction.JOB_FAILURE_REASON_RECORDED,
            resourceType: "print_job",
            resourceId: jobId,
            metadata: {
              reason,
              previousReason: row.failureReason,
              ...(note ? { note } : {}),
              orderId: found.orderId,
            },
          },
        });
      },
      { maxWait: 10_000, timeout: 10_000 },
    );
    return this.loadResponse(jobId);
  }

  private async loadResponse(jobId: string): Promise<PrintJobResponse> {
    const job = await this.prisma.printJob.findUniqueOrThrow({
      where: { id: jobId },
      include: { printer: { select: { name: true } } },
    });
    return this.toResponse(job);
  }

  private toResponse(job: {
    id: string;
    orderId: string;
    status: PrintJobStatus;
    printerId: string | null;
    operatorId: string | null;
    blockedReason: string | null;
    failureReason: string | null;
    failureNote: string | null;
    priority: number;
    attempt: number;
    printer: { name: string } | null;
  }): PrintJobResponse {
    return {
      id: job.id,
      orderId: job.orderId,
      status: job.status,
      printerId: job.printerId,
      printerName: job.printer?.name ?? null,
      operatorId: job.operatorId,
      blockedReason: job.blockedReason,
      failureReason: job.failureReason,
      failureNote: job.failureNote,
      priority: job.priority,
      attempt: job.attempt,
    };
  }
}
