import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
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
import { CreateBusinessDto } from "./dto/create-business.dto.js";
import { UpdateBusinessStatusDto } from "./dto/update-business-status.dto.js";
import { UpdateUserRoleDto } from "./dto/update-user-role.dto.js";
import { UpdateUserStatusDto } from "./dto/update-user-status.dto.js";
import {
  AdminService,
  type AdminBusinessCreatedResponse,
  type AdminBusinessResponse,
  type AdminBusinessDetailResponse,
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

  /** 23.7/Workstream A (PRD §106's admin-assisted onboarding) -- since fix wave 1 the only
   * way a business is created, together with its named owner's account and invitation. */
  @Post("businesses")
  createBusiness(
    @Req() req: RequestWithUser,
    @Body() dto: CreateBusinessDto,
  ): Promise<AdminBusinessCreatedResponse> {
    return this.adminService.createBusiness(req.user!.id, dto);
  }

  @Get("businesses/:id")
  getBusiness(@Param("id") id: string): Promise<AdminBusinessDetailResponse> {
    return this.adminService.getBusiness(id);
  }

  /** Fix wave 1: email the owner a fresh activation code (the old one stops working) while
   * they still have not set a password. 202, like every other invitation send. */
  @Post("businesses/:id/owner-invite")
  @HttpCode(HttpStatus.ACCEPTED)
  reissueOwnerInvite(
    @Req() req: RequestWithUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<{ result: "PROCESSED" }> {
    return this.adminService.reissueOwnerInvite(req.user!.id, id);
  }

  @Patch("businesses/:id/status")
  updateBusinessStatus(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: UpdateBusinessStatusDto,
  ): Promise<AdminBusinessResponse> {
    return this.adminService.updateBusinessStatus(req.user!.id, id, dto.status);
  }

  @Get("users")
  listUsers(@Query() query: AdminListQueryDto): Promise<AdminListResult<AdminUserResponse>> {
    return this.adminService.listUsers(query);
  }

  /** Workstream B/23.7-cont'd: one user's detail, addressable by id. */
  @Get("users/:id")
  getUser(@Param("id") id: string): Promise<AdminUserResponse> {
    return this.adminService.getUser(id);
  }

  /** Workstream B: an admin changing a user's platform-wide role. */
  @Patch("users/:id/role")
  updateUserRole(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: UpdateUserRoleDto,
  ): Promise<AdminUserResponse> {
    return this.adminService.updateUserRole(req.user!.id, id, dto.role);
  }

  /** Workstream B: an admin forcing a user's account status. */
  @Patch("users/:id/status")
  updateUserStatus(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: UpdateUserStatusDto,
  ): Promise<AdminUserResponse> {
    return this.adminService.updateUserStatus(req.user!.id, id, dto.status);
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
