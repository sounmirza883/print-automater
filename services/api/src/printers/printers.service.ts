import { ForbiddenException, HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { type Prisma, type Printer, PrinterStatus, PrintJobStatus } from "@prisma/client";
import type { PrinterCapabilities } from "@print-automated/types";
import { AppException, AuditService, PrismaService } from "@print-automated/backend-shared";
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
    return printers.map((printer) => this.toResponse(printer));
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

    return this.toResponse(printer);
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
      },
    });

    await this.audit.record({
      actorId,
      action: AuditAction.PRINTER_UPDATED,
      resourceType: "printer",
      resourceId: printerId,
      metadata: { from: { name: existing.name, status: existing.status }, to: input },
    });

    return this.toResponse(updated);
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

  private toResponse(printer: Printer): PrinterResponse {
    return {
      id: printer.id,
      shopId: printer.shopId,
      name: printer.name,
      capabilities: printer.capabilities as unknown as PrinterCapabilities | null,
      status: printer.status,
      createdAt: printer.createdAt,
    };
  }
}
