import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { JwtAuthGuard, type RequestWithUser } from "../auth/jwt-auth.guard.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { Roles } from "../auth/roles.decorator.js";
import { ShopScopedField } from "../auth/shop-scoped.decorator.js";
import { ShopPlanQueryDto } from "./dto/shop-plan-query.dto.js";
import { ShopPlanService, type ShopPlanResponse } from "./shop-plan.service.js";

/** 26.5: `GET /v1/shop/plan` -- deliberately no `@RequirePermission()` (see
 * PermissionsGuard's own comment: no requirement means nothing enforced there),
 * so every shop staff role can see their own business's plan status, the same
 * openness as `GET /shop/staff/me`. `@ShopScopedField` still proves real
 * membership of the requested shop -- another business's staff get 403. */
@Controller("shop/plan")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(
  UserRole.SHOP_COUNTER,
  UserRole.SHOP_MANAGER,
  UserRole.SHOP_OWNER,
  UserRole.OPERATOR,
  UserRole.PRINTER_MANAGER,
)
export class ShopPlanController {
  constructor(private readonly shopPlan: ShopPlanService) {}

  @Get()
  @ShopScopedField("query", "shopId")
  get(@Req() req: RequestWithUser, @Query() query: ShopPlanQueryDto): Promise<ShopPlanResponse> {
    return this.shopPlan.getStatus(query.shopId, req.user!.id);
  }
}
