import { Body, Controller, Get, Post, Query, Req, UseGuards } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { Permission, type Page } from "@print-automated/types";
import { JwtAuthGuard, type RequestWithUser } from "../auth/jwt-auth.guard.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { Roles } from "../auth/roles.decorator.js";
import { PermissionsGuard } from "../auth/permissions.guard.js";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { ShopScopedField } from "../auth/shop-scoped.decorator.js";
import { CreatePricingRuleDto } from "./dto/create-pricing-rule.dto.js";
import { ListPricingRulesQueryDto } from "./dto/list-pricing-rules-query.dto.js";
import { PricingRulesService, type PricingRuleResponse } from "./pricing-rules.service.js";

/** §4.2/§19/§47/17.3: versioned, append-only -- there is deliberately
 * no PATCH/PUT here, only `list` (every version, newest first -- the
 * first element IS "the current rule," per PricingRule's own schema
 * comment) and `create` (always mints a NEW version, never mutates an
 * existing row). Gated by MANAGE_PRICES, same as ProductsController. */
@Controller("shop/pricing-rules")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(
  UserRole.SHOP_COUNTER,
  UserRole.SHOP_MANAGER,
  UserRole.SHOP_OWNER,
  UserRole.OPERATOR,
  UserRole.PRINTER_MANAGER,
)
@RequirePermission(Permission.MANAGE_PRICES)
export class PricingRulesController {
  constructor(private readonly pricingRulesService: PricingRulesService) {}

  @Get()
  @ShopScopedField("query", "shopId")
  list(
    @Req() req: RequestWithUser,
    @Query() query: ListPricingRulesQueryDto,
  ): Promise<PricingRuleResponse[] | Page<PricingRuleResponse>> {
    return this.pricingRulesService.list(req.user!.id, query);
  }

  @Post()
  @ShopScopedField("body", "shopId")
  create(
    @Req() req: RequestWithUser,
    @Body() dto: CreatePricingRuleDto,
  ): Promise<PricingRuleResponse> {
    return this.pricingRulesService.create(req.user!.id, dto);
  }
}
