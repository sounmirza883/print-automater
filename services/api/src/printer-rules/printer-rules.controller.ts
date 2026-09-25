import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { Permission } from "@print-automated/types";
import { JwtAuthGuard, type RequestWithUser } from "../auth/jwt-auth.guard.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { Roles } from "../auth/roles.decorator.js";
import { PermissionsGuard } from "../auth/permissions.guard.js";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { ShopScopeGuard } from "../auth/shop-scope.guard.js";
import { ShopScoped, ShopScopedField } from "../auth/shop-scoped.decorator.js";
import {
  CreatePrinterRuleDto,
  ListPrinterRulesQueryDto,
  ReorderPrinterRulesDto,
  UpdatePrinterRuleDto,
} from "./dto/printer-rules.dto.js";
import { PrinterRuleShopResolver } from "./printer-rule-shop.resolver.js";
import { PrinterRulesService, type PrinterRuleResponse } from "./printer-rules.service.js";

/** 22.3 (PRD 77). Reading needs VIEW_SETTINGS (owner, manager); every write needs
 * MANAGE_AUTOMATION (owner, manager). `:id` routes resolve the rule's shop through
 * ShopScopeGuard, so another shop's staff get 403, never the data. */
@Controller("shop/printer-rules")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(
  UserRole.SHOP_COUNTER,
  UserRole.SHOP_MANAGER,
  UserRole.SHOP_OWNER,
  UserRole.OPERATOR,
  UserRole.PRINTER_MANAGER,
)
@RequirePermission(Permission.VIEW_SETTINGS)
export class PrinterRulesController {
  constructor(private readonly rules: PrinterRulesService) {}

  @Get()
  @ShopScopedField("query", "shopId")
  list(
    @Req() req: RequestWithUser,
    @Query() query: ListPrinterRulesQueryDto,
  ): Promise<PrinterRuleResponse[]> {
    return this.rules.list(query.shopId, req.user!.id);
  }

  @Post()
  @RequirePermission(Permission.MANAGE_AUTOMATION)
  @ShopScopedField("body", "shopId")
  create(
    @Req() req: RequestWithUser,
    @Body() dto: CreatePrinterRuleDto,
  ): Promise<PrinterRuleResponse> {
    return this.rules.create(req.user!.id, dto);
  }

  /** The complete new order (every existing rule id exactly once). */
  @Put("order")
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.MANAGE_AUTOMATION)
  @ShopScopedField("body", "shopId")
  reorder(
    @Req() req: RequestWithUser,
    @Body() dto: ReorderPrinterRulesDto,
  ): Promise<PrinterRuleResponse[]> {
    return this.rules.reorder(req.user!.id, dto);
  }

  @Patch(":id")
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", PrinterRuleShopResolver)
  @RequirePermission(Permission.MANAGE_AUTOMATION)
  update(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: UpdatePrinterRuleDto,
  ): Promise<PrinterRuleResponse> {
    return this.rules.update(id, req.user!.id, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", PrinterRuleShopResolver)
  @RequirePermission(Permission.MANAGE_AUTOMATION)
  async remove(@Req() req: RequestWithUser, @Param("id") id: string): Promise<{ deleted: true }> {
    await this.rules.remove(id, req.user!.id);
    return { deleted: true };
  }
}
