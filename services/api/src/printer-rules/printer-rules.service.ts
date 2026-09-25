import { isDeepStrictEqual } from "node:util";
import { ForbiddenException, HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type PrinterAutomationRule } from "@prisma/client";
import {
  MAX_PRINTER_RULES_PER_SHOP,
  type CreatePrinterRuleInput,
  type ReorderPrinterRulesInput,
  type UpdatePrinterRuleInput,
} from "@print-automated/validation";
import { AppException, PrismaService, redactMetadata } from "@print-automated/backend-shared";
import { AuditAction } from "../audit/audit-action.js";
import { ShopMembershipService } from "../auth/shop-membership.service.js";

export interface PrinterRuleResponse {
  id: string;
  shopId: string;
  /** 0-based; rules apply in ascending order. */
  position: number;
  name: string;
  enabled: boolean;
  action: "PREFER" | "AVOID";
  printerIds: string[];
  conditions: Record<string, unknown>;
  /** Optimistic-concurrency token: send it back as `expectedVersion`. */
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

function toResponse(row: PrinterAutomationRule): PrinterRuleResponse {
  return {
    id: row.id,
    shopId: row.shopId,
    position: row.position,
    name: row.name,
    enabled: row.enabled,
    action: row.action,
    printerIds: row.printerIds,
    conditions: (row.conditions ?? {}) as Record<string, unknown>,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const EDITABLE = ["name", "action", "printerIds", "conditions", "enabled"] as const;

const snapshot = (row: PrinterAutomationRule): Record<string, unknown> => ({
  name: row.name,
  action: row.action,
  printerIds: row.printerIds,
  conditions: row.conditions,
  enabled: row.enabled,
  position: row.position,
});

/** 22.3 (PRD 77). Rules are DATA read by allocation; nothing here moves a job.
 * Every mutation of one shop's rules is serialised by locking that shop's
 * `shop_settings` row (FOR UPDATE), so positions stay contiguous under concurrency.
 * Only that one lock is taken, so it cannot deadlock with the settings writer
 * (which takes shops then shop_settings) or with recovery readers. */
@Injectable()
export class PrinterRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shopMembership: ShopMembershipService,
  ) {}

  async list(shopId: string, userId: string): Promise<PrinterRuleResponse[]> {
    await this.assertMember(shopId, userId);
    const rows = await this.prisma.printerAutomationRule.findMany({
      where: { shopId },
      orderBy: [{ position: "asc" }, { id: "asc" }],
    });
    return rows.map(toResponse);
  }

  async create(userId: string, input: CreatePrinterRuleInput): Promise<PrinterRuleResponse> {
    await this.assertMember(input.shopId, userId);
    await this.assertPrintersBelongToShop(input.shopId, input.printerIds);
    return this.prisma.$transaction(
      async (tx) => {
        await this.lockShopRules(tx, input.shopId);
        const count = await tx.printerAutomationRule.count({ where: { shopId: input.shopId } });
        if (count >= MAX_PRINTER_RULES_PER_SHOP) {
          throw new AppException(
            HttpStatus.CONFLICT,
            "RULE_LIMIT_REACHED",
            `A shop can have at most ${MAX_PRINTER_RULES_PER_SHOP} printer rules.`,
            false,
          );
        }
        const row = await tx.printerAutomationRule.create({
          data: {
            shopId: input.shopId,
            position: count,
            name: input.name,
            action: input.action,
            printerIds: input.printerIds,
            conditions: input.conditions as Prisma.InputJsonValue,
            enabled: input.enabled,
          },
        });
        await this.audit(tx, userId, AuditAction.PRINTER_RULE_CREATED, row.id, {
          after: snapshot(row),
          toVersion: row.version,
        });
        return toResponse(row);
      },
      { maxWait: 10_000, timeout: 10_000 },
    );
  }

  async update(
    ruleId: string,
    userId: string,
    input: UpdatePrinterRuleInput,
  ): Promise<PrinterRuleResponse> {
    const shopId = await this.shopOf(ruleId);
    await this.assertMember(shopId, userId);
    if (input.printerIds) {
      await this.assertPrintersBelongToShop(shopId, input.printerIds);
    }
    return this.prisma.$transaction(
      async (tx) => {
        await this.lockShopRules(tx, shopId);
        const before = await tx.printerAutomationRule.findFirst({ where: { id: ruleId, shopId } });
        if (!before) {
          throw new NotFoundException("Printer rule not found.");
        }
        if (input.expectedVersion !== undefined && input.expectedVersion !== before.version) {
          throw new AppException(
            HttpStatus.CONFLICT,
            "RULE_VERSION_CONFLICT",
            `The rule changed since you loaded it (now version ${before.version}). Reload and retry.`,
            false,
          );
        }
        const data: Prisma.PrinterAutomationRuleUpdateInput = {};
        const changedKeys: string[] = [];
        for (const key of EDITABLE) {
          const value = input[key];
          if (value === undefined || isDeepStrictEqual(value, before[key])) {
            continue;
          }
          changedKeys.push(key);
          (data as Record<string, unknown>)[key] = value;
        }
        if (changedKeys.length === 0) {
          return toResponse(before);
        }
        data.version = { increment: 1 };
        const after = await tx.printerAutomationRule.update({ where: { id: ruleId }, data });
        const pick = (row: PrinterAutomationRule): Record<string, unknown> =>
          Object.fromEntries(changedKeys.map((key) => [key, snapshot(row)[key]]));
        await this.audit(tx, userId, AuditAction.PRINTER_RULE_UPDATED, ruleId, {
          changedKeys,
          before: pick(before),
          after: pick(after),
          fromVersion: before.version,
          toVersion: after.version,
        });
        return toResponse(after);
      },
      { maxWait: 10_000, timeout: 10_000 },
    );
  }

  async remove(ruleId: string, userId: string): Promise<void> {
    const shopId = await this.shopOf(ruleId);
    await this.assertMember(shopId, userId);
    await this.prisma.$transaction(
      async (tx) => {
        await this.lockShopRules(tx, shopId);
        const before = await tx.printerAutomationRule.findFirst({ where: { id: ruleId, shopId } });
        if (!before) {
          throw new NotFoundException("Printer rule not found.");
        }
        await tx.printerAutomationRule.delete({ where: { id: ruleId } });
        await tx.printerAutomationRule.updateMany({
          where: { shopId, position: { gt: before.position } },
          data: { position: { decrement: 1 } },
        });
        await this.audit(tx, userId, AuditAction.PRINTER_RULE_DELETED, ruleId, {
          before: snapshot(before),
          fromVersion: before.version,
        });
      },
      { maxWait: 10_000, timeout: 10_000 },
    );
  }

  async reorder(userId: string, input: ReorderPrinterRulesInput): Promise<PrinterRuleResponse[]> {
    await this.assertMember(input.shopId, userId);
    return this.prisma.$transaction(
      async (tx) => {
        await this.lockShopRules(tx, input.shopId);
        const existing = await tx.printerAutomationRule.findMany({
          where: { shopId: input.shopId },
          orderBy: [{ position: "asc" }, { id: "asc" }],
          select: { id: true },
        });
        const existingIds = existing.map((row) => row.id);
        if (
          existingIds.length !== input.ruleIds.length ||
          !input.ruleIds.every((id) => existingIds.includes(id))
        ) {
          throw new AppException(
            HttpStatus.CONFLICT,
            "RULE_ORDER_MISMATCH",
            "The new order must list every existing rule of this shop exactly once.",
            false,
          );
        }
        if (!isDeepStrictEqual(existingIds, input.ruleIds)) {
          for (const [position, id] of input.ruleIds.entries()) {
            await tx.printerAutomationRule.update({
              where: { id },
              data: { position, version: { increment: 1 } },
            });
          }
          await tx.auditLog.create({
            data: {
              actorId: userId,
              action: AuditAction.PRINTER_RULES_REORDERED,
              resourceType: "shop",
              resourceId: input.shopId,
              metadata: { before: existingIds, after: input.ruleIds },
            },
          });
        }
        const rows = await tx.printerAutomationRule.findMany({
          where: { shopId: input.shopId },
          orderBy: [{ position: "asc" }, { id: "asc" }],
        });
        return rows.map(toResponse);
      },
      { maxWait: 10_000, timeout: 10_000 },
    );
  }

  private async lockShopRules(tx: Prisma.TransactionClient, shopId: string): Promise<void> {
    await tx.$queryRaw`SELECT shop_id FROM shop_settings WHERE shop_id = ${shopId} FOR UPDATE`;
  }

  private async shopOf(ruleId: string): Promise<string> {
    const row = await this.prisma.printerAutomationRule.findUnique({
      where: { id: ruleId },
      select: { shopId: true },
    });
    if (!row) {
      throw new NotFoundException("Printer rule not found.");
    }
    return row.shopId;
  }

  private async assertMember(shopId: string, userId: string): Promise<void> {
    if (!(await this.shopMembership.isActiveStaff(shopId, userId))) {
      throw new ForbiddenException("You do not have access to this shop's printer rules.");
    }
  }

  /** A rule may only name printers of its own shop (never another tenant's ids). */
  private async assertPrintersBelongToShop(
    shopId: string,
    printerIds: readonly string[],
  ): Promise<void> {
    const found = await this.prisma.printer.count({
      where: { shopId, id: { in: [...printerIds] } },
    });
    if (found !== new Set(printerIds).size) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        "RULE_PRINTER_INVALID",
        "Every printer in a rule must belong to this shop.",
        false,
      );
    }
  }

  private async audit(
    tx: Prisma.TransactionClient,
    actorId: string,
    action: string,
    resourceId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorId,
        action,
        resourceType: "printer_rule",
        resourceId,
        metadata: redactMetadata(metadata) as Prisma.InputJsonValue,
      },
    });
  }
}
