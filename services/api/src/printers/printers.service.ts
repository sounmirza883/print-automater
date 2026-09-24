import { ForbiddenException, HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import {
  type PageLimitPeriod,
  type Prisma,
  type Printer,
  PrinterStatus,
  PrintJobStatus,
} from "@prisma/client";
import type { PrinterCapabilities } from "@print-automated/types";
import {
  AppException,
  AuditService,
  periodStart,
  PrismaService,
} from "@print-automated/backend-shared";
import { AgentJobsService } from "../agents/agent-jobs.service.js";
import { AuditAction } from "../audit/audit-action.js";
import { ShopMembershipService } from "../auth/shop-membership.service.js";
import type { RegisterPrinterInput, UpdatePrinterInput } from "@print-automated/validation";

export interface PrinterResponse {
  id: string;
  shopId: string;
  name: string;
  capabilities: PrinterCapabilities | null;
  status: PrinterStatus;
  createdAt: Date;
  pageLimit: number | null;
  pageLimitEnabled: boolean;
  pageLimitPeriod: PageLimitPeriod;
  pagesUsedInPeriod: number;
  /** null when enforcement is disabled or no limit is set. */
  remainingAllowance: number | null;
}

/** §110/10.2's own "may still be physically printing, unresolved"
 * reasoning for UNKNOWN applies here too -- a printer with an
 * unresolved job is not safely removable any more than one with a
 * genuinely in-flight one. Only the settled terminal states (PRINTED,
 * FAILED, TIMEOUT, CANCELLED) are not "active" for this check. */
const ACTIVE_JOB_STATUSES: PrintJobStatus[] = [
  PrintJobStatus.QUEUED,
  PrintJobStatus.CLAIMED,
  PrintJobStatus.PRINTING,
  PrintJobStatus.UNKNOWN,
];

@Injectable()
export class PrintersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shopMembership: ShopMembershipService,
    private readonly audit: AuditService,
    private readonly agentJobs: AgentJobsService,
  ) {}

  /** §82: `shopId` arrives in the query string (list) or request body
   * (register), never a route param -- so, like ShopOrdersService's
   * own list endpoint, membership is checked directly here rather than
   * via ShopScopeGuard's resolver mechanism. */
  async list(requestingUserId: string, shopId: string): Promise<PrinterResponse[]> {
    await this.assertMember(shopId, requestingUserId);
    const printers = await this.prisma.printer.findMany({
      where: { shopId },
      orderBy: { createdAt: "asc" },
    });
    return Promise.all(printers.map((printer) => this.toResponseWithUsage(printer)));
  }

  async register(requestingUserId: string, input: RegisterPrinterInput): Promise<PrinterResponse> {
    await this.assertMember(input.shopId, requestingUserId);
    const printer = await this.prisma.printer.create({
      data: {
        shopId: input.shopId,
        name: input.name,
        capabilities: input.capabilities as unknown as Prisma.InputJsonValue | undefined,
      },
    });

    // §45/16.6: printer create/update/delete previously wrote no audit
    // row at all.
    await this.audit.record({
      actorId: requestingUserId,
      action: AuditAction.PRINTER_CREATED,
      resourceType: "printer",
      resourceId: printer.id,
      metadata: { shopId: printer.shopId, name: printer.name },
    });

    return this.toResponseWithUsage(printer);
  }

  /** §38/8.4: `enabled` toggles only to/from DISABLED -- ONLINE/ERROR
   * are agent-reported (9.4/9.11) and this endpoint never sets them.
   * Re-enabling a printer that wasn't actually disabled is a no-op on
   * `status` (idempotent), not a forced reset to OFFLINE that would
   * clobber a real agent-reported state. ShopScopeGuard (via
   * PrinterShopResolver, at the route level) has already confirmed the
   * caller is active staff at this printer's shop by the time this
   * runs. */
  async update(
    printerId: string,
    input: UpdatePrinterInput,
    actorId: string | null,
  ): Promise<PrinterResponse> {
    const existing = await this.prisma.printer.findUnique({ where: { id: printerId } });
    if (!existing) {
      throw new NotFoundException("Printer not found.");
    }

    let status = existing.status;
    if (input.enabled === false) {
      status = PrinterStatus.DISABLED;
    } else if (input.enabled === true && existing.status === PrinterStatus.DISABLED) {
      status = PrinterStatus.OFFLINE;
    }

    const updated = await this.prisma.printer.update({
      where: { id: printerId },
      data: {
        name: input.name,
        capabilities: input.capabilities as unknown as Prisma.InputJsonValue | undefined,
        status,
        pageLimit: input.pageLimit,
        pageLimitEnabled: input.pageLimitEnabled,
        pageLimitPeriod: input.pageLimitPeriod,
      },
    });

    await this.audit.record({
      actorId,
      action: AuditAction.PRINTER_UPDATED,
      resourceType: "printer",
      resourceId: printerId,
      metadata: {
        from: {
          name: existing.name,
          status: existing.status,
          pageLimit: existing.pageLimit,
          pageLimitEnabled: existing.pageLimitEnabled,
          pageLimitPeriod: existing.pageLimitPeriod,
        },
        to: input,
      },
    });

    // 19.4 trigger (a): staff just disabled it. After commit + audit; a
    // no-op unless the shop opted in to automatic handoff.
    if (updated.status === PrinterStatus.DISABLED && existing.status !== PrinterStatus.DISABLED) {
      await this.agentJobs.reevaluatePrinter(updated.shopId, updated.id, "PRINTER_DISABLED");
    }

    return this.toResponseWithUsage(updated);
  }

  /** §38/8.4's own Done-when: "deleting a printer with an active job
   * is refused." ShopScopeGuard has already confirmed shop membership
   * by the time this runs. */
  async remove(printerId: string, actorId: string | null): Promise<void> {
    const existing = await this.prisma.printer.findUnique({ where: { id: printerId } });
    if (!existing) {
      throw new NotFoundException("Printer not found.");
    }

    const activeJob = await this.prisma.printJob.findFirst({
      where: { printerId, status: { in: ACTIVE_JOB_STATUSES } },
    });
    if (activeJob) {
      throw new AppException(
        HttpStatus.CONFLICT,
        "PRINTER_HAS_ACTIVE_JOB",
        "This printer has an active print job and cannot be removed.",
        false,
      );
    }

    const result = await this.prisma.printer.deleteMany({ where: { id: printerId } });
    if (result.count === 0) {
      throw new NotFoundException("Printer not found.");
    }

    await this.audit.record({
      actorId,
      action: AuditAction.PRINTER_REMOVED,
      resourceType: "printer",
      resourceId: printerId,
      metadata: { shopId: existing.shopId, name: existing.name },
    });
  }

  private async assertMember(shopId: string, userId: string): Promise<void> {
    const isMember = await this.shopMembership.isActiveStaff(shopId, userId);
    if (!isMember) {
      throw new ForbiddenException("You do not have access to this shop's printers.");
    }
  }

  /** Semantics (documented): the period is part of the usage key, so changing
   * a printer's period DAILY -> MONTHLY mid-month addresses a different key and
   * effectively resets its allowance (the old period's rows are not merged).
   *
   * 19.2: usage for the CURRENT period (UTC), read live so the figure
   * rolls over with no reset job. */
  private async toResponseWithUsage(printer: Printer): Promise<PrinterResponse> {
    const usage = await this.prisma.printerPageUsage.findUnique({
      where: {
        printerId_periodStart: {
          printerId: printer.id,
          periodStart: periodStart(printer.pageLimitPeriod, new Date()),
        },
      },
      select: { pagesUsed: true },
    });
    const pagesUsedInPeriod = usage?.pagesUsed ?? 0;
    return {
      ...this.toResponse(printer),
      pagesUsedInPeriod,
      remainingAllowance:
        printer.pageLimitEnabled && printer.pageLimit !== null
          ? Math.max(0, printer.pageLimit - pagesUsedInPeriod)
          : null,
    };
  }

  private toResponse(
    printer: Printer,
  ): Omit<PrinterResponse, "pagesUsedInPeriod" | "remainingAllowance"> {
    return {
      id: printer.id,
      shopId: printer.shopId,
      name: printer.name,
      capabilities: printer.capabilities as unknown as PrinterCapabilities | null,
      status: printer.status,
      createdAt: printer.createdAt,
      pageLimit: printer.pageLimit,
      pageLimitEnabled: printer.pageLimitEnabled,
      pageLimitPeriod: printer.pageLimitPeriod,
    };
  }
}
