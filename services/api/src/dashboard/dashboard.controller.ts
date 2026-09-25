import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import {
  Permission,
  type OperatorDashboardResponse,
  type OwnerDashboardResponse,
  type PrinterDashboardResponse,
} from "@print-automated/types";
import { JwtAuthGuard, type RequestWithUser } from "../auth/jwt-auth.guard.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { Roles } from "../auth/roles.decorator.js";
import { PermissionsGuard } from "../auth/permissions.guard.js";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { ShopScopedField } from "../auth/shop-scoped.decorator.js";
import { DashboardService } from "./dashboard.service.js";
import {
  OperatorDashboardQueryDto,
  OwnerDashboardQueryDto,
  ShopDashboardQueryDto,
} from "./dto/dashboard.dto.js";

/** 23.2 (PRD 39-41). Read-only aggregates, one dashboard per audience, each behind
 * its own permission (data in ROLE_PERMISSIONS): the caller's EFFECTIVE role at the
 * requested shop decides, and the service then proves active membership of that
 * shop, so another business's owner gets 403, never another business's numbers. */
@Controller("shop/dashboard")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(
  UserRole.SHOP_COUNTER,
  UserRole.SHOP_MANAGER,
  UserRole.SHOP_OWNER,
  UserRole.OPERATOR,
  UserRole.PRINTER_MANAGER,
)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get("owner")
  @RequirePermission(Permission.VIEW_DASHBOARD)
  @ShopScopedField("query", "shopId")
  owner(
    @Req() req: RequestWithUser,
    @Query() query: OwnerDashboardQueryDto,
  ): Promise<OwnerDashboardResponse> {
    return this.dashboard.owner(req.user!.id, query);
  }

  @Get("operator")
  @RequirePermission(Permission.VIEW_OPERATOR_DASHBOARD)
  @ShopScopedField("query", "shopId")
  operator(
    @Req() req: RequestWithUser,
    @Query() query: OperatorDashboardQueryDto,
  ): Promise<OperatorDashboardResponse> {
    return this.dashboard.operator(req.user!.id, query);
  }

  @Get("printers")
  @RequirePermission(Permission.VIEW_PRINTER_DASHBOARD)
  @ShopScopedField("query", "shopId")
  printers(
    @Req() req: RequestWithUser,
    @Query() query: ShopDashboardQueryDto,
  ): Promise<PrinterDashboardResponse> {
    return this.dashboard.printers(req.user!.id, query);
  }
}
