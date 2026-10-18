import { ForbiddenException, HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { type PageLimitPeriod, type Prisma, PrinterStatus, PrintJobStatus } from "@prisma/client";
import type { Page, PrinterCapabilities } from "@print-automated/types";
import {
  AppException,
  AuditService,
  periodStart,
  PrismaService,
} from "@print-automated/backend-shared";
import { AgentJobsService } from "../agents/agent-jobs.service.js";
import { AuditAction } from "../audit/audit-action.js";
import { ShopMembershipService, type MemberAccess } from "../auth/shop-membership.service.js";
import { resolveBranchForStaffOperation } from "../branches/branch-resolution.js";
import { resolveBranchScope } from "../shop-staff/branch-scope.js";
import { ilike } from "../common/search.js";
import type {
  ListPrintersQueryInput,
  RegisterPrinterInput,
  UpdatePrinterInput,
} from "@print-automated/validation";
import { listResult, resolvePagination } from "../common/pagination.js";

/** A printer row with its branch's name joined in (every printer response shows where it is). */
const PRINTER_INCLUDE = { branch: { select: { name: true } } } satisfies Prisma.PrinterInclude;
type Printer = Prisma.PrinterGetPayload<{ include: typeof PRINTER_INCLUDE }>;

export interface PrinterResponse {
  id: string;
  shopId: string;
  // Step 3: where the printer is. A printer with a paired PC is where that PC is.
  branchId: string;
  branchName: string;
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
  // 23.14 (additive, plain columns): the printer profile and when its status last changed.
  model: string | null;
  location: string | null;
  maintenanceStatus: string | null;
  lastStatusAt: Date | null;
}

/** 23.14: `GET /shop/printers/:id`. */
export interface PrinterDetailResponse extends PrinterResponse {
  connectionType: string | null;
  supportedSizes: string[];
  supportedPaperTypes: string[];
  maxJobPages: number | null;
  /** The paired agent's last heartbeat (null when no agent, or never seen). */
  lastSeenAt: Date | null;
  /** Start (UTC) of the period `pagesUsedInPeriod` counts. */
  pageLimitPeriodStart: Date;
  /** Jobs currently queued/claimed/printing/unknown on this printer. */
  activeJobs: number;
  /** Automation rules (22.3) whose printer set names this printer, in rule order. */
  rules: Array<{ id: string; name: string; action: string; enabled: boolean; position: number }>;
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
  async list(
    requestingUserId: string,
    query: ListPrintersQueryInput,
  ): Promise<PrinterResponse[] | Page<PrinterResponse>> {
    const actor = await this.requireAccess(query.shopId, requestingUserId);
    // Step 3: a branch-bound person only gets their own branch's printers (naming another is
    // 403); an all-branches person gets every branch's unless they narrow it to one.
    const branchId = resolveBranchScope(actor.branchId, query.branchId);
    const pagination = resolvePagination(query);
    const where: Prisma.PrinterWhereInput = {
      shopId: query.shopId,
      ...(branchId ? { branchId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [{ name: ilike(query.q) }, { model: ilike(query.q) }, { location: ilike(query.q) }],
          }
        : {}),
    };
    const [printers, total] = await Promise.all([
      this.prisma.printer.findMany({
        where,
        include: PRINTER_INCLUDE,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: pagination.take,
        skip: pagination.skip,
      }),
      pagination.paged ? this.prisma.printer.count({ where }) : Promise.resolve(0),
    ]);
    return listResult(pagination, await this.withUsage(printers), total);
  }

  /** 23.14. ShopScopeGuard (PrinterShopResolver) has already confirmed the caller is active
   * staff at this printer's business. */
  async getDetail(printerId: string): Promise<PrinterDetailResponse> {
    const printer = await this.prisma.printer.findUnique({
      where: { id: printerId },
      include: { ...PRINTER_INCLUDE, agent: { select: { lastSeenAt: true } } },
    });
    if (!printer) {
      throw new NotFoundException("Printer not found.");
    }
    const [base, rules, activeJobs] = await Promise.all([
      this.toResponseWithUsage(printer),
      // Same business only (defence in depth: rules carry printer ids, not a foreign key).
      this.prisma.printerAutomationRule.findMany({
        where: { shopId: printer.shopId, printerIds: { has: printerId } },
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: { id: true, name: true, action: true, enabled: true, position: true },
      }),
      this.prisma.printJob.count({
        where: { printerId, status: { in: ACTIVE_JOB_STATUSES } },
      }),
    ]);
    return {
      ...base,
      connectionType: printer.connectionType,
      supportedSizes: printer.supportedSizes,
      supportedPaperTypes: printer.supportedPaperTypes,
      maxJobPages: printer.maxJobPages,
      lastSeenAt: printer.agent?.lastSeenAt ?? null,
      pageLimitPeriodStart: periodStart(printer.pageLimitPeriod, new Date()),
      activeJobs,
      rules,
    };
  }

  async register(requestingUserId: string, input: RegisterPrinterInput): Promise<PrinterResponse> {
    const actor = await this.requireAccess(input.shopId, requestingUserId);
    // Step 3: the branch the printer is at, decided like a pairing code's (a branch-bound person's
    // own, else the named one, else the business's only branch) and share-locked with the insert.
    const printer = await this.prisma.$transaction(async (tx) => {
      const branch = await resolveBranchForStaffOperation(tx, {
        shopId: input.shopId,
        actorBranchId: actor.branchId,
        requested: input.branchId,
      });
      return tx.printer.create({
        data: {
          shopId: input.shopId,
          branchId: branch.id,
          name: input.name,
          capabilities: input.capabilities as unknown as Prisma.InputJsonValue | undefined,
        },
        include: PRINTER_INCLUDE,
      });
    });

    // §45/16.6: printer create/update/delete previously wrote no audit
    // row at all.
    await this.audit.record({
      actorId: requestingUserId,
      action: AuditAction.PRINTER_CREATED,
      resourceType: "printer",
      resourceId: printer.id,
      metadata: { shopId: printer.shopId, branchId: printer.branchId, name: printer.name },
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
    const existing = await this.prisma.printer.findUnique({
      where: { id: printerId },
      include: PRINTER_INCLUDE,
    });
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
      include: PRINTER_INCLUDE,
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

  /** Moves a paired PC, with every printer it reports, to another branch (the route needs business
   * settings access, so owners only); a printer no PC has claimed moves on its own. Printing never
   * crosses branches, so the move is refused (409 AGENT_HAS_ACTIVE_JOBS) while any printer of the
   * PC has a job in flight, and the PC and its printers move together or not at all.
   *
   * Race with job creation: a job being placed share-locks its printer's row and re-reads that
   * printer's branch (`assertPrinterInBranch` in the job state machine). The move takes the same
   * rows FOR UPDATE, in one fixed order, then looks for live jobs: whichever side commits first, the
   * other sees it (the job makes the move refuse, or the move makes the job refuse the printer), so
   * no job is ever left on a printer of another branch. Finished jobs keep the branch they ran at. */
  async moveBranch(
    printerId: string,
    branchId: string,
    actorId: string,
  ): Promise<PrinterResponse[]> {
    const target = await this.prisma.printer.findUnique({
      where: { id: printerId },
      select: { shopId: true, agentId: true },
    });
    if (!target) {
      throw new NotFoundException("Printer not found.");
    }
    const access = await this.requireAccess(target.shopId, actorId);

    const outcome = await this.prisma.$transaction(async (tx) => {
      const destination = await resolveBranchForStaffOperation(tx, {
        shopId: target.shopId,
        actorBranchId: access.branchId,
        requested: branchId,
      });
      if (target.agentId) {
        await tx.$queryRaw`SELECT id FROM printer_agents WHERE id = ${target.agentId} FOR UPDATE`;
      }
      const rows = target.agentId
        ? await tx.$queryRaw<Array<{ id: string; branchId: string }>>`
            SELECT id, branch_id AS "branchId" FROM printers
            WHERE agent_id = ${target.agentId} ORDER BY id FOR UPDATE`
        : await tx.$queryRaw<Array<{ id: string; branchId: string }>>`
            SELECT id, branch_id AS "branchId" FROM printers
            WHERE id = ${printerId} ORDER BY id FOR UPDATE`;
      if (rows.length === 0) {
        throw new NotFoundException("Printer not found.");
      }
      // Which PC this printer belongs to was read before the locks; a heartbeat may have linked
      // (or moved) it since. Now that its row is held, confirm it still belongs to the same PC,
      // or the move would act on a stale picture and split the printer from its computer.
      const current = await tx.$queryRaw<Array<{ agentId: string | null }>>`
        SELECT agent_id AS "agentId" FROM printers WHERE id = ${printerId}
      `;
      if ((current[0]?.agentId ?? null) !== (target.agentId ?? null)) {
        throw new AppException(
          HttpStatus.CONFLICT,
          "PRINTER_CHANGED",
          "This printer was just updated by its computer. Try the move again.",
          true,
        );
      }
      const ids = rows.map((row) => row.id);
      const fromBranchId = rows[0]!.branchId;
      const changed = rows.some((row) => row.branchId !== destination.id);
      if (changed) {
        // A paused job still holds its printer and would resume onto it, so it counts too.
        const live = await tx.printJob.count({
          where: {
            printerId: { in: ids },
            status: { in: [...ACTIVE_JOB_STATUSES, PrintJobStatus.PAUSED] },
          },
        });
        if (live > 0) {
          throw new AppException(
            HttpStatus.CONFLICT,
            "AGENT_HAS_ACTIVE_JOBS",
            "This computer or one of its printers has a print job in progress. Move it once the jobs are finished.",
            false,
          );
        }
        if (target.agentId) {
          await tx.printerAgent.update({
            where: { id: target.agentId },
            data: { branchId: destination.id },
          });
        }
        await tx.printer.updateMany({
          where: { id: { in: ids } },
          data: { branchId: destination.id },
        });
      }
      const printers = await tx.printer.findMany({
        where: { id: { in: ids } },
        include: PRINTER_INCLUDE,
        orderBy: [{ name: "asc" }, { id: "asc" }],
      });
      return { printers, ids, fromBranchId, toBranchId: destination.id, changed };
    });

    if (outcome.changed) {
      await this.audit.record({
        actorId,
        action: AuditAction.PRINTER_BRANCH_MOVED,
        resourceType: target.agentId ? "printer_agent" : "printer",
        resourceId: target.agentId ?? printerId,
        metadata: {
          shopId: target.shopId,
          fromBranchId: outcome.fromBranchId,
          toBranchId: outcome.toBranchId,
          printerIds: outcome.ids,
        },
      });
    }
    return this.withUsage(outcome.printers);
  }

  /** The caller's access at this business (role, permissions, and the branch they work at). */
  private async requireAccess(shopId: string, userId: string): Promise<MemberAccess> {
    const access = await this.shopMembership.getAccess(shopId, userId);
    if (!access) {
      throw new ForbiddenException("You do not have access to this shop's printers.");
    }
    return access;
  }

  /** Semantics (documented): the period is part of the usage key, so changing
   * a printer's period DAILY -> MONTHLY mid-month addresses a different key and
   * effectively resets its allowance (the old period's rows are not merged).
   *
   * 19.2: usage for the CURRENT period (UTC), read live so the figure
   * rolls over with no reset job. */
  private async toResponseWithUsage(printer: Printer): Promise<PrinterResponse> {
    return (await this.withUsage([printer]))[0]!;
  }

  /** One usage query for the whole page (not one per printer). */
  private async withUsage(printers: Printer[]): Promise<PrinterResponse[]> {
    if (printers.length === 0) {
      return [];
    }
    const now = new Date();
    const periods = new Map(
      printers.map((printer) => [printer.id, periodStart(printer.pageLimitPeriod, now)]),
    );
    const usage = await this.prisma.printerPageUsage.findMany({
      where: {
        OR: printers.map((printer) => ({
          printerId: printer.id,
          periodStart: periods.get(printer.id)!,
        })),
      },
      select: { printerId: true, pagesUsed: true },
    });
    const used = new Map(usage.map((row) => [row.printerId, row.pagesUsed]));
    return printers.map((printer) => {
      const pagesUsedInPeriod = used.get(printer.id) ?? 0;
      return {
        ...this.toResponse(printer),
        pagesUsedInPeriod,
        remainingAllowance:
          printer.pageLimitEnabled && printer.pageLimit !== null
            ? Math.max(0, printer.pageLimit - pagesUsedInPeriod)
            : null,
      };
    });
  }

  private toResponse(
    printer: Printer,
  ): Omit<PrinterResponse, "pagesUsedInPeriod" | "remainingAllowance"> {
    return {
      id: printer.id,
      shopId: printer.shopId,
      branchId: printer.branchId,
      branchName: printer.branch.name,
      name: printer.name,
      capabilities: printer.capabilities as unknown as PrinterCapabilities | null,
      status: printer.status,
      createdAt: printer.createdAt,
      pageLimit: printer.pageLimit,
      pageLimitEnabled: printer.pageLimitEnabled,
      pageLimitPeriod: printer.pageLimitPeriod,
      model: printer.model,
      location: printer.location,
      maintenanceStatus: printer.maintenanceStatus,
      lastStatusAt: printer.lastStatusAt,
    };
  }
}
