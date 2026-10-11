import { HttpStatus, Injectable } from "@nestjs/common";
import { Prisma, type PlanDefinition } from "@prisma/client";
import { AppException, PrismaService, redactMetadata } from "@print-automated/backend-shared";
import type { PlanDefinitionResponse } from "@print-automated/types";
import type {
  CreatePlanDefinitionInput,
  UpdatePlanDefinitionInput,
} from "@print-automated/validation";
import { AuditAction } from "../audit/audit-action.js";
import {
  PLAN_DEFINITION_WITH_COUNT,
  toPlanDefinitionResponse,
  toPublicPlanResponse,
  type PublicPlanResponse,
} from "./plan-definition-response.js";
import { subscriberCountPhrase } from "./plan-period.js";

export const planDefinitionNotFound = (): AppException =>
  new AppException(HttpStatus.NOT_FOUND, "PLAN_DEFINITION_NOT_FOUND", "No such plan.", false);

/** "Exists, but can't be used for this right now" is a 409 in this codebase
 * (SUPPLIER_INACTIVE, INVENTORY_ITEM_INACTIVE, SHOP_PLAN_EXPIRED) -- never a 404
 * that would wrongly tell the admin the plan is gone. */
export const planDefinitionArchived = (name: string): AppException =>
  new AppException(
    HttpStatus.CONFLICT,
    "PLAN_DEFINITION_ARCHIVED",
    `The plan "${name}" is archived and can no longer be assigned. Unarchive it, or choose another plan.`,
    false,
  );

const NAME_TAKEN = (): AppException =>
  new AppException(
    HttpStatus.CONFLICT,
    "PLAN_DEFINITION_NAME_TAKEN",
    "A plan with this name already exists. Choose a different name.",
    false,
  );

const IN_USE = (count: number): AppException =>
  new AppException(
    HttpStatus.CONFLICT,
    "PLAN_DEFINITION_IN_USE",
    `${subscriberCountPhrase(count)} currently assigned to this plan — archive it instead, or move them to another plan first.`,
    false,
  );

/** Editable through PATCH, in this order (also the order `changedKeys` is audited in). */
const EDITABLE = [
  "name",
  "priceMinor",
  "currency",
  "billingPeriodDays",
  "description",
  "archived",
] as const;

const snapshot = (row: PlanDefinition): Record<string, unknown> => ({
  name: row.name,
  priceMinor: row.priceMinor,
  currency: row.currency,
  billingPeriodDays: row.billingPeriodDays,
  description: row.description,
  archived: row.archived,
});

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";
}

const TX_OPTIONS = { maxWait: 10_000, timeout: 10_000 } as const;

/** Plan management: platform-wide plan definitions (name, price, currency,
 * billing period) -- CRUD for the ADMIN-only `/v1/admin/plans` routes. No shop
 * boundary at all (like AdminService): a plan definition belongs to the
 * platform, not to any one business.
 *
 * Concurrency: every write locks the plan's row first (FOR UPDATE).
 * ShopPlanService.activate takes FOR SHARE on the same row before assigning it,
 * so an archive or delete and a concurrent assignment are strictly ordered:
 * either the assignment lands first (and the delete then sees it and refuses),
 * or the archive/delete lands first (and the assignment then sees the archived
 * flag, or no row, and refuses). shop_plans' RESTRICT FK is the last backstop. */
@Injectable()
export class PlanDefinitionService {
  constructor(private readonly prisma: PrismaService) {}

  /** Live plans first, cheapest first, then by name -- the order an admin picks from. */
  async list(): Promise<{ items: PlanDefinitionResponse[] }> {
    const rows = await this.prisma.planDefinition.findMany({
      include: PLAN_DEFINITION_WITH_COUNT,
      orderBy: [{ archived: "asc" }, { priceMinor: "asc" }, { name: "asc" }],
    });
    return { items: rows.map(toPlanDefinitionResponse) };
  }

  /** The public pricing list: only plans an admin has not archived (an archived
   * plan is no longer offered), cheapest first -- the same order the admin sees. */
  async listPublic(): Promise<{ items: PublicPlanResponse[] }> {
    const rows = await this.prisma.planDefinition.findMany({
      where: { archived: false },
      orderBy: [{ priceMinor: "asc" }, { name: "asc" }],
    });
    return { items: rows.map(toPublicPlanResponse) };
  }

  async get(id: string): Promise<PlanDefinitionResponse> {
    const row = await this.prisma.planDefinition.findUnique({
      where: { id },
      include: PLAN_DEFINITION_WITH_COUNT,
    });
    if (!row) {
      throw planDefinitionNotFound();
    }
    return toPlanDefinitionResponse(row);
  }

  /** `id`, `archived` and `subscriberCount` never come from the client (the schema
   * strips them): a new plan is server-identified, live, and has no subscribers.
   * The name is unique in the database; a collision -- including two admins racing
   * to create the same name -- is a clean 409, never a raw 500. */
  async create(actorId: string, input: CreatePlanDefinitionInput): Promise<PlanDefinitionResponse> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.planDefinition.create({
          data: {
            name: input.name,
            priceMinor: input.priceMinor,
            currency: input.currency,
            billingPeriodDays: input.billingPeriodDays,
            description: input.description ?? null,
          },
          include: PLAN_DEFINITION_WITH_COUNT,
        });
        await this.audit(tx, actorId, AuditAction.PLAN_DEFINITION_CREATED, row.id, {
          after: snapshot(row),
        });
        return toPlanDefinitionResponse(row);
      }, TX_OPTIONS);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw NAME_TAKEN();
      }
      throw error;
    }
  }

  /** Partial update. Changing the price or billing period affects the NEXT
   * activation/renewal only: a business's current expiry is never recomputed, and
   * what each business was assigned at is recorded on its own SHOP_PLAN_ACTIVATED
   * audit row. A PATCH that changes nothing writes nothing (no audit row). */
  async update(
    actorId: string,
    id: string,
    input: UpdatePlanDefinitionInput,
  ): Promise<PlanDefinitionResponse> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const before = await this.lockForWrite(tx, id);
        const data: Prisma.PlanDefinitionUpdateInput = {};
        const changedKeys: string[] = [];
        for (const key of EDITABLE) {
          const value = input[key];
          if (value === undefined || value === before[key]) {
            continue;
          }
          changedKeys.push(key);
          (data as Record<string, unknown>)[key] = value;
        }
        if (changedKeys.length > 0) {
          const after = await tx.planDefinition.update({ where: { id }, data });
          const pick = (row: PlanDefinition): Record<string, unknown> =>
            Object.fromEntries(changedKeys.map((key) => [key, snapshot(row)[key]]));
          await this.audit(tx, actorId, AuditAction.PLAN_DEFINITION_UPDATED, id, {
            changedKeys,
            before: pick(before),
            after: pick(after),
          });
        }
        const fresh = await tx.planDefinition.findUniqueOrThrow({
          where: { id },
          include: PLAN_DEFINITION_WITH_COUNT,
        });
        return toPlanDefinitionResponse(fresh);
      }, TX_OPTIONS);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw NAME_TAKEN();
      }
      throw error;
    }
  }

  /** Hard delete -- refused (409 PLAN_DEFINITION_IN_USE, naming how many) while ANY
   * business is assigned to the plan, active or expired: archiving is how a plan
   * with subscribers is retired. */
  async remove(actorId: string, id: string): Promise<{ result: "DELETED" }> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const before = await this.lockForWrite(tx, id);
        const subscribers = await tx.shopPlan.count({ where: { planDefinitionId: id } });
        if (subscribers > 0) {
          throw IN_USE(subscribers);
        }
        await tx.planDefinition.delete({ where: { id } });
        await this.audit(tx, actorId, AuditAction.PLAN_DEFINITION_DELETED, id, {
          before: snapshot(before),
        });
      }, TX_OPTIONS);
    } catch (error) {
      // The RESTRICT FK refusing the delete: only reachable if an assignment slipped
      // past the row lock above (it cannot through ShopPlanService). Same answer.
      if (isForeignKeyViolation(error)) {
        throw IN_USE(await this.prisma.shopPlan.count({ where: { planDefinitionId: id } }));
      }
      throw error;
    }
    return { result: "DELETED" };
  }

  /** FOR UPDATE on the plan's row, then the row itself (re-read after the lock is
   * held, so it is the latest committed version). 404 if it does not exist. */
  private async lockForWrite(tx: Prisma.TransactionClient, id: string): Promise<PlanDefinition> {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM plan_definitions WHERE id = ${id} FOR UPDATE
    `;
    if (locked.length === 0) {
      throw planDefinitionNotFound();
    }
    return tx.planDefinition.findUniqueOrThrow({ where: { id } });
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
        resourceType: "plan_definition",
        resourceId,
        metadata: redactMetadata(metadata) as Prisma.InputJsonValue,
      },
    });
  }
}
