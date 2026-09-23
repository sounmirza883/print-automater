import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { Roles } from "../auth/roles.decorator.js";
import { AdminListQueryDto } from "./dto/admin-list-query.dto.js";
import { AdminAuditQueryDto } from "./dto/admin-audit-query.dto.js";
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
  constructor(private readonly adminService: AdminService) {}

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
}
