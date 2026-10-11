import { HttpStatus, Injectable } from "@nestjs/common";
import { Prisma, type PlanFeature } from "@prisma/client";
import { AppException, PrismaService, redactMetadata } from "@print-automated/backend-shared";
import type { PlanFeatureResponse } from "@print-automated/types";
import type { CreatePlanFeatureInput, UpdatePlanFeatureInput } from "@print-automated/validation";
import { AuditAction } from "../audit/audit-action.js";

const NOT_FOUND = (): AppException =>
  new AppException(HttpStatus.NOT_FOUND, "PLAN_FEATURE_NOT_FOUND", "No such feature row.", false);

const TAKEN = (): AppException =>
  new AppException(
    HttpStatus.CONFLICT,
    "PLAN_FEATURE_TAKEN",
    "A feature with this section and label already exists.",
    false,
  );

export const toPlanFeatureResponse = (row: PlanFeature): PlanFeatureResponse => ({
  id: row.id,
  section: row.section,
  label: row.label,
  sortOrder: row.sortOrder,
  showOnCard: row.showOnCard,
  cardText: row.cardText,
});

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Rows of the public Compare plans table, defined once for every plan. Deleting a
 * row deletes every plan's value for it (FK cascade). Platform-wide and ADMIN-only,
 * like PlanDefinitionService. */
@Injectable()
export class PlanFeatureService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<{ items: PlanFeatureResponse[] }> {
    const rows = await this.prisma.planFeature.findMany({
      orderBy: [{ sortOrder: "asc" }, { section: "asc" }, { label: "asc" }],
    });
    return { items: rows.map(toPlanFeatureResponse) };
  }

  /** (section, label) is unique; a collision -- including two admins racing -- is a
   * clean 409, never a raw 500. */
  async create(actorId: string, input: CreatePlanFeatureInput): Promise<PlanFeatureResponse> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.planFeature.create({
          data: {
            section: input.section,
            label: input.label,
            sortOrder: input.sortOrder ?? 0,
            showOnCard: input.showOnCard ?? false,
            cardText: input.cardText ?? null,
          },
        });
        await this.audit(tx, actorId, AuditAction.PLAN_FEATURE_CREATED, row.id, {
          after: toPlanFeatureResponse(row),
        });
        return toPlanFeatureResponse(row);
      });
    } catch (error) {
      throw isUniqueViolation(error) ? TAKEN() : error;
    }
  }

  async update(
    actorId: string,
    id: string,
    input: UpdatePlanFeatureInput,
  ): Promise<PlanFeatureResponse> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const before = await tx.planFeature.findUnique({ where: { id } });
        if (!before) {
          throw NOT_FOUND();
        }
        const after = await tx.planFeature.update({
          where: { id },
          data: {
            ...(input.section !== undefined && { section: input.section }),
            ...(input.label !== undefined && { label: input.label }),
            ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
            ...(input.showOnCard !== undefined && { showOnCard: input.showOnCard }),
            ...(input.cardText !== undefined && { cardText: input.cardText }),
          },
        });
        await this.audit(tx, actorId, AuditAction.PLAN_FEATURE_UPDATED, id, {
          before: toPlanFeatureResponse(before),
          after: toPlanFeatureResponse(after),
        });
        return toPlanFeatureResponse(after);
      });
    } catch (error) {
      throw isUniqueViolation(error) ? TAKEN() : error;
    }
  }

  async remove(actorId: string, id: string): Promise<{ result: "DELETED" }> {
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.planFeature.findUnique({ where: { id } });
      if (!before) {
        throw NOT_FOUND();
      }
      await tx.planFeature.delete({ where: { id } });
      await this.audit(tx, actorId, AuditAction.PLAN_FEATURE_DELETED, id, {
        before: toPlanFeatureResponse(before),
      });
    });
    return { result: "DELETED" };
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
        resourceType: "plan_feature",
        resourceId,
        metadata: redactMetadata(metadata) as Prisma.InputJsonValue,
      },
    });
  }
}
