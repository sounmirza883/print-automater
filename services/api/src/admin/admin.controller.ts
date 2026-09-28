import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { JwtAuthGuard, type RequestWithUser } from "../auth/jwt-auth.guard.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { Roles } from "../auth/roles.decorator.js";
import type { AdminDashboardResponse } from "@print-automated/types";
import { AdminDashboardService } from "./admin-dashboard.service.js";
import { AdminListQueryDto } from "./dto/admin-list-query.dto.js";
import { AdminAuditQueryDto } from "./dto/admin-audit-query.dto.js";
import { CreateBusinessDto } from "./dto/create-business.dto.js";
import { UpdateBusinessStatusDto } from "./dto/update-business-status.dto.js";
import {
  AdminService,
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

  /** 23.7/Workstream A (PRD §106's admin-assisted onboarding fallback). */
  @Post("businesses")
  createBusiness(
    @Req() req: RequestWithUser,
    @Body() dto: CreateBusinessDto,
  ): Promise<AdminBusinessResponse> {
    return this.adminService.createBusiness(req.user!.id, dto);
  }

  @Get("businesses/:id")
  getBusiness(@Param("id") id: string): Promise<AdminBusinessDetailResponse> {
    return this.adminService.getBusiness(id);
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

  @Get("audit")
  listAudit(@Query() query: AdminAuditQueryDto): Promise<AdminListResult<AdminAuditEntryResponse>> {
    return this.adminService.listAudit(query);
  }

  @Get("system")
  getSystemStatus(): Promise<AdminSystemStatus> {
    return this.adminService.getSystemStatus();
  }
}
