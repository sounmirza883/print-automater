import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { JwtAuthGuard, type RequestWithUser } from "../auth/jwt-auth.guard.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { Roles } from "../auth/roles.decorator.js";
import type { AdminDashboardResponse } from "@print-automated/types";
import { ShopPlanService, type ShopPlanResponse } from "../shop-plan/shop-plan.service.js";
import { AdminDashboardService } from "./admin-dashboard.service.js";
import { AdminListQueryDto } from "./dto/admin-list-query.dto.js";
import { AdminAuditQueryDto } from "./dto/admin-audit-query.dto.js";
import { ActivatePlanDto } from "./dto/activate-plan.dto.js";
import {
  AdminService,
  type AdminBusinessResponse,
  type AdminUserResponse,
  type AdminAuditEntryResponse,
  type AdminListResult,
  type AdminSystemStatus,
} from "./admin.service.js";

/** §4.7/§42/16.5: platform-admin surface. `@Roles(ADMIN)` only -- no
 * `ShopScopeGuard` anywhere in this controller, by design: admin sees
 * across every shop, not one. `UserRole.ADMIN` was a dead role before
 * this sub-phase (grepped: zero `@Roles(ADMIN)` usages anywhere in this
 * codebase); this is its first real gate. */
@Controller("admin")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly adminDashboard: AdminDashboardService,
    private readonly shopPlan: ShopPlanService,
  ) {}

  /** 23.2 (§42): platform-wide dashboard. Reuses this controller's ADMIN-only gate. */
  @Get("dashboard")
  dashboard(): Promise<AdminDashboardResponse> {
    return this.adminDashboard.get();
  }

  @Get("businesses")
  listBusinesses(
    @Query() query: AdminListQueryDto,
  ): Promise<AdminListResult<AdminBusinessResponse>> {
    return this.adminService.listBusinesses(query);
  }

  @Get("users")
  listUsers(@Query() query: AdminListQueryDto): Promise<AdminListResult<AdminUserResponse>> {
    return this.adminService.listUsers(query);
  }

  @Get("audit")
  listAudit(@Query() query: AdminAuditQueryDto): Promise<AdminListResult<AdminAuditEntryResponse>> {
    return this.adminService.listAudit(query);
  }

  @Get("system")
  getSystemStatus(): Promise<AdminSystemStatus> {
    return this.adminService.getSystemStatus();
  }

  /** 26.4: the Plan (subscription) system -- a platform admin manually
   * activates/renews a business's plan; there is no payment gateway here.
   * `ShopPlanService.getStatusForAdmin`/`activate` skip the shop-membership
   * check `GET /shop/plan` (26.5) requires, matching this whole controller's
   * own "no ShopScopeGuard, by design" comment above. */
  @Get("businesses/:shopId/plan")
  getPlan(@Param("shopId") shopId: string): Promise<ShopPlanResponse> {
    return this.shopPlan.getStatusForAdmin(shopId);
  }

  @Post("businesses/:shopId/plan/activate")
  activatePlan(
    @Req() req: RequestWithUser,
    @Param("shopId") shopId: string,
    @Body() body: ActivatePlanDto,
  ): Promise<ShopPlanResponse> {
    return this.shopPlan.activate(shopId, req.user!.id, body.days);
  }
}
