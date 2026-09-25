import { Body, Controller, Get, Put, Query, Req, UseGuards } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { Permission } from "@print-automated/types";
import { JwtAuthGuard, type RequestWithUser } from "../auth/jwt-auth.guard.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { Roles } from "../auth/roles.decorator.js";
import { PermissionsGuard } from "../auth/permissions.guard.js";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { ShopScopedField } from "../auth/shop-scoped.decorator.js";
import { GetShopSettingsQueryDto, UpdateShopSettingsDto } from "./dto/shop-settings.dto.js";
import { ShopSettingsService, type ShopSettingsResponse } from "./shop-settings.service.js";

/** 22.1 (PRD 75/76/81). VIEW_SETTINGS (owner, manager) to read or write at all;
 * the service then requires MANAGE_SETTINGS for business keys and
 * MANAGE_AUTOMATION for automation keys of the patch. Membership of the target
 * shop is enforced in the service (a `shopId` route, like inventory). */
@Controller("shop/settings")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(
  UserRole.SHOP_COUNTER,
  UserRole.SHOP_MANAGER,
  UserRole.SHOP_OWNER,
  UserRole.OPERATOR,
  UserRole.PRINTER_MANAGER,
)
@RequirePermission(Permission.VIEW_SETTINGS)
export class ShopSettingsController {
  constructor(private readonly settings: ShopSettingsService) {}

  @Get()
  @ShopScopedField("query", "shopId")
  get(
    @Req() req: RequestWithUser,
    @Query() query: GetShopSettingsQueryDto,
  ): Promise<ShopSettingsResponse> {
    return this.settings.get(query.shopId, req.user!.id);
  }

  @Put()
  @ShopScopedField("body", "shopId")
  update(
    @Req() req: RequestWithUser,
    @Body() dto: UpdateShopSettingsDto,
  ): Promise<ShopSettingsResponse> {
    return this.settings.update(dto, req.user!.id);
  }
}
