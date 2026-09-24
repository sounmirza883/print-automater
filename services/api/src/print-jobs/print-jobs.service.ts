import { HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, PrintJobStatus, ShopStaffStatus, UserRole } from "@prisma/client";
import type { PrintConfiguration } from "@print-automated/types";
import {
  allocatePrinter,
  AppException,
  AuditService,
  jobPages,
  PrintJobEvent,
  PrintJobStateMachine,
  PrismaService,
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
  priority: number;
  attempt: number;
}

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

  private toResponse(job: {
    id: string;
    orderId: string;
    status: PrintJobStatus;
    printerId: string | null;
    operatorId: string | null;
    blockedReason: string | null;
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
      priority: job.priority,
      attempt: job.attempt,
    };
  }
}
