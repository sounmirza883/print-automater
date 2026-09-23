import { HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { PrintJobStatus, ShopStaffStatus, UserRole } from "@prisma/client";
import {
  AppException,
  AuditService,
  OrderStateMachine,
  PrintJobEvent,
  PrintJobStateMachine,
  PrismaService,
} from "@print-automated/backend-shared";
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
    private readonly orderStateMachine: OrderStateMachine,
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

    const newPrinter = await this.prisma.printer.findFirst({
      where: { id: newPrinterId, shopId: job.shopId },
    });
    if (!newPrinter) {
      throw new AppException(
        HttpStatus.CONFLICT,
        "PRINTER_NOT_AVAILABLE",
        "That printer is not available for this shop.",
        true,
      );
    }

    await this.jobStateMachine.transition(
      jobId,
      PrintJobEvent.SUPERSEDE,
      { id: actorId },
      { metadata: { reason, newPrinterId } },
    );

    const attempt = await this.prisma.printJob.count({ where: { orderItemId: job.orderItemId } });
    const replacement = await this.prisma.printJob.create({
      data: {
        orderId: job.orderId,
        shopId: job.shopId,
        orderItemId: job.orderItemId,
        printerId: newPrinterId,
        attempt: attempt + 1,
        idempotencyToken: `${job.orderItemId}:${attempt + 1}`,
        status: PrintJobStatus.QUEUED,
      },
      include: { printer: { select: { name: true } } },
    });

    try {
      await this.orderStateMachine.syncFromJobs(job.orderId, { id: actorId });
    } catch (error) {
      if (!(error instanceof AppException && error.errorCode === "ILLEGAL_ORDER_TRANSITION")) {
        throw error;
      }
    }

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
