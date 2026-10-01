import { ForbiddenException, HttpStatus, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { AppException, PrismaService, redactMetadata } from "@print-automated/backend-shared";
import type { ShopPlanResponse } from "@print-automated/types";
import { AuditAction } from "../audit/audit-action.js";
import { ShopMembershipService } from "../auth/shop-membership.service.js";
import {
  PLAN_DEFINITION_WITH_COUNT,
  toPlanDefinitionResponse,
  type PlanDefinitionWithCount,
} from "./plan-definition-response.js";
import { planDefinitionArchived, planDefinitionNotFound } from "./plan-definition.service.js";
import { cancelledExpiry, extendedExpiry, isActiveAt } from "./plan-period.js";

export type { ShopPlanResponse };

/** Every ShopPlanResponse carries the joined plan definition (with its live
 * subscriber count) -- every query that builds one includes this. */
const WITH_PLAN = {
  planDefinition: { include: PLAN_DEFINITION_WITH_COUNT },
} satisfies Prisma.ShopPlanInclude;

const SHOP_NOT_FOUND = (): AppException =>
  new AppException(HttpStatus.NOT_FOUND, "SHOP_NOT_FOUND", "No such business.", false);

const TX_OPTIONS = { maxWait: 10_000, timeout: 10_000 } as const;

function toResponse(row: {
  shopId: string;
  expiresAt: Date | null;
  activatedAt: Date | null;
  planDefinition: PlanDefinitionWithCount | null;
}): ShopPlanResponse {
  return {
    shopId: row.shopId,
    active: isActiveAt(row.expiresAt, new Date()),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    activatedAt: row.activatedAt?.toISOString() ?? null,
    plan: row.planDefinition ? toPlanDefinitionResponse(row.planDefinition) : null,
  };
}

/** 26.2 (Phase 26): whether a business's plan is active gates the print pipeline
 * only -- login, dashboards and every non-print route are unaffected. There is no
 * stored status column: activate/renew only ever moves `expiresAt` forward (cancel
 * only ever moves it back to now), and "is this plan active" is always a live
 * comparison against now(), the same way page-limit enforcement (19.2) is a live
 * comparison, never a cached boolean that could drift from the date itself.
 *
 * Plan management: a business is assigned a named PlanDefinition (or none -- an
 * old-style or never-assigned business reads `plan: null`); the activation length
 * is that plan's own `billingPeriodDays`. */
@Injectable()
export class ShopPlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shopMembership: ShopMembershipService,
  ) {}

  /** `@ShopScopedField` (query-based shopId) does NOT enforce real membership at
   * the guard layer -- unlike `@ShopScoped` route-param routes, it only affects
   * effective-role resolution and falls back to the caller's account-level role
   * when there's no membership. Real enforcement is this explicit check, the
   * same pattern ShopSettingsService.assertMember uses. */
  async getStatus(shopId: string, userId: string): Promise<ShopPlanResponse> {
    if (!(await this.shopMembership.isActiveStaff(shopId, userId))) {
      throw new ForbiddenException("You do not have access to this business's plan.");
    }
    return this.getStatusForAdmin(shopId);
  }

  /** No membership check: `/admin/*` sees across every business, not one --
   * matching AdminController's own comment ("no ShopScopeGuard anywhere in this
   * controller, by design"). Callable only from the ADMIN-gated admin module.
   * Every shop has a row (the `shops` insert trigger), so "no row" means "no such
   * business" -- a 404, not the raw 500 a findUniqueOrThrow would leak. */
  async getStatusForAdmin(shopId: string): Promise<ShopPlanResponse> {
    const row = await this.prisma.shopPlan.findUnique({ where: { shopId }, include: WITH_PLAN });
    if (!row) {
      throw SHOP_NOT_FOUND();
    }
    return toResponse(row);
  }

  /** Read inside the caller's own transaction, no lock -- the same way every other
   * per-shop toggle (shop.autoFailoverEnabled, shopSettings.autoPrinterAssignmentEnabled)
   * is read on the dispatch/allocation path in shop-orders.service.ts: a plan that
   * expires in the same instant as a dispatch is an acceptable race, not a
   * money-critical one like stock consumption (which does lock). */
  async isActive(tx: Prisma.TransactionClient, shopId: string): Promise<boolean> {
    const row = await tx.shopPlan.findUnique({ where: { shopId }, select: { expiresAt: true } });
    return isActiveAt(row?.expiresAt ?? null, new Date());
  }

  /** Assigns (or re-assigns) a named plan to a business: the same plan again
   * renews it, a different plan switches to it. Either way the expiry is extended
   * by THAT plan's `billingPeriodDays` from the LATER of now or the current expiry
   * -- renewing early adds to what's left rather than discarding it.
   *
   * Locks: the business's `shop_plans` row FOR UPDATE (two admins acting on the same
   * business must not clobber one another), then the plan's row FOR SHARE (a
   * concurrent archive/delete of that plan is ordered strictly before or after this
   * assignment -- see PlanDefinitionService). An archived plan is refused with 409
   * PLAN_DEFINITION_ARCHIVED -- including for a business already on it: renewing on
   * a retired plan means unarchiving it, or moving the business to a live one. The
   * audit row records the plan's price/period AT THIS MOMENT, so a later price edit
   * never rewrites what this business was assigned at. */
  async activate(
    shopId: string,
    adminUserId: string,
    planDefinitionId: string,
  ): Promise<ShopPlanResponse> {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.lockShopPlan(tx, shopId);
      const plans = await tx.$queryRaw<
        Array<{
          name: string;
          price_minor: number;
          currency: string;
          billing_period_days: number;
          archived: boolean;
        }>
      >`
        SELECT name, price_minor, currency, billing_period_days, archived
        FROM plan_definitions WHERE id = ${planDefinitionId} FOR SHARE
      `;
      const plan = plans[0];
      if (!plan) {
        throw planDefinitionNotFound();
      }
      if (plan.archived) {
        throw planDefinitionArchived(plan.name);
      }

      const now = new Date();
      const expiresAt = extendedExpiry(current.expires_at, now, plan.billing_period_days);
      const after = await tx.shopPlan.update({
        where: { shopId },
        data: { expiresAt, activatedAt: now, activatedByUserId: adminUserId, planDefinitionId },
        include: WITH_PLAN,
      });

      await this.audit(tx, adminUserId, AuditAction.SHOP_PLAN_ACTIVATED, shopId, {
        planDefinitionId,
        planName: plan.name,
        previousPlanDefinitionId: current.plan_definition_id,
        days: plan.billing_period_days,
        priceMinor: plan.price_minor,
        currency: plan.currency,
        previousExpiresAt: current.expires_at?.toISOString() ?? null,
        newExpiresAt: expiresAt.toISOString(),
      });

      return toResponse(after);
    }, TX_OPTIONS);
  }

  /** Clears a business's plan assignment and expires it immediately (an
   * already-lapsed expiry is left where it is, never pushed forward). The business,
   * its staff and its history are untouched; printing stops exactly as for any
   * expired plan until an admin assigns a plan again. Same FOR UPDATE row lock as
   * `activate`, so a cancel and an activate on one business are strictly ordered. */
  async cancel(shopId: string, adminUserId: string): Promise<ShopPlanResponse> {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.lockShopPlan(tx, shopId);
      const expiresAt = cancelledExpiry(current.expires_at, new Date());
      const after = await tx.shopPlan.update({
        where: { shopId },
        data: { planDefinitionId: null, expiresAt },
        include: WITH_PLAN,
      });

      await this.audit(tx, adminUserId, AuditAction.SHOP_PLAN_CANCELLED, shopId, {
        previousPlanDefinitionId: current.plan_definition_id,
        previousExpiresAt: current.expires_at?.toISOString() ?? null,
        newExpiresAt: expiresAt?.toISOString() ?? null,
      });

      return toResponse(after);
    }, TX_OPTIONS);
  }

  private async lockShopPlan(
    tx: Prisma.TransactionClient,
    shopId: string,
  ): Promise<{ expires_at: Date | null; plan_definition_id: string | null }> {
    const locked = await tx.$queryRaw<
      Array<{ expires_at: Date | null; plan_definition_id: string | null }>
    >`
      SELECT expires_at, plan_definition_id FROM shop_plans WHERE shop_id = ${shopId} FOR UPDATE
    `;
    if (locked.length === 0) {
      throw SHOP_NOT_FOUND();
    }
    return locked[0]!;
  }

  private async audit(
    tx: Prisma.TransactionClient,
    actorId: string,
    action: string,
    shopId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorId,
        action,
        resourceType: "shop_plan",
        resourceId: shopId,
        metadata: redactMetadata(metadata) as Prisma.InputJsonValue,
      },
    });
  }
}
