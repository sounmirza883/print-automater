import { ForbiddenException, HttpStatus, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { AppException, PrismaService } from "@print-automated/backend-shared";
import { AuditAction } from "../audit/audit-action.js";
import { ShopMembershipService } from "../auth/shop-membership.service.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ShopPlanResponse {
  shopId: string;
  active: boolean;
  /** ISO-8601; null means never activated (reads identically to expired). */
  expiresAt: string | null;
  activatedAt: string | null;
}

function isActiveAt(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && expiresAt.getTime() > now.getTime();
}

function toResponse(row: {
  shopId: string;
  expiresAt: Date | null;
  activatedAt: Date | null;
}): ShopPlanResponse {
  return {
    shopId: row.shopId,
    active: isActiveAt(row.expiresAt, new Date()),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    activatedAt: row.activatedAt?.toISOString() ?? null,
  };
}

/** 26.2 (Phase 26): whether a business's plan is active gates the print pipeline
 * only -- login, dashboards and every non-print route are unaffected. There is no
 * stored status column: activate/renew only ever moves `expiresAt` forward, and
 * "is this plan active" is always a live comparison against now(), the same way
 * page-limit enforcement (19.2) is a live comparison, never a cached boolean that
 * could drift from the date itself. */
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
   * controller, by design"). Callable only from the ADMIN-gated admin module. */
  async getStatusForAdmin(shopId: string): Promise<ShopPlanResponse> {
    const row = await this.prisma.shopPlan.findUniqueOrThrow({ where: { shopId } });
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

  /** Extends (or starts) a shop's plan by `days` from the LATER of now or its
   * current expiry -- renewing early adds to what's left rather than discarding
   * it. Locked FOR UPDATE like shop_settings's own write path, since two admins
   * renewing the same business at once must not silently clobber one another. */
  async activate(shopId: string, adminUserId: string, days: number): Promise<ShopPlanResponse> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ expires_at: Date | null }>>`
        SELECT expires_at FROM shop_plans WHERE shop_id = ${shopId} FOR UPDATE
      `;
      if (locked.length === 0) {
        throw new AppException(HttpStatus.NOT_FOUND, "SHOP_NOT_FOUND", "No such business.", false);
      }
      const now = new Date();
      const previousExpiresAt = locked[0]!.expires_at;
      const base = isActiveAt(previousExpiresAt, now) ? previousExpiresAt! : now;
      const expiresAt = new Date(base.getTime() + days * DAY_MS);

      const after = await tx.shopPlan.update({
        where: { shopId },
        data: { expiresAt, activatedAt: now, activatedByUserId: adminUserId },
      });

      await tx.auditLog.create({
        data: {
          actorId: adminUserId,
          action: AuditAction.SHOP_PLAN_ACTIVATED,
          resourceType: "shop_plan",
          resourceId: shopId,
          metadata: { days, previousExpiresAt, newExpiresAt: expiresAt },
        },
      });

      return toResponse(after);
    });
  }
}
