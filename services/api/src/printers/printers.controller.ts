import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Patch,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { Permission, type Page } from "@print-automated/types";
import { JwtAuthGuard, type RequestWithUser } from "../auth/jwt-auth.guard.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { Roles } from "../auth/roles.decorator.js";
import { PermissionsGuard } from "../auth/permissions.guard.js";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { ShopScopeGuard } from "../auth/shop-scope.guard.js";
import { ShopScoped, ShopScopedField } from "../auth/shop-scoped.decorator.js";
import { ListPrintersQueryDto } from "./dto/list-printers-query.dto.js";
import { RegisterPrinterDto } from "./dto/register-printer.dto.js";
import { UpdatePrinterDto } from "./dto/update-printer.dto.js";
import { PrinterShopResolver } from "./printer-shop.resolver.js";
import {
  PrintersService,
  type PrinterDetailResponse,
  type PrinterResponse,
} from "./printers.service.js";
import { SearchRateLimitGuard } from "../rate-limit/search-rate-limit.guard.js";

/** §47/16.3: managing the printer fleet (register/update/delete) is
 * MANAGE_PRINTERS-gated -- counter staff can no longer add, edit or
 * remove printers. PRINTER_MANAGER is the one non-owner/manager role
 * that DOES get this permission (role-permissions.ts).
 *
 * Reading the list is NOT gated by MANAGE_PRINTERS, deliberately --
 * fixed here after a real regression surfaced in Phase 17's e2e sweep
 * (edge-case-suite.e2e-spec.ts's "printer offline -> no silent
 * failure" test): `apps/shop-mobile`'s order-detail screen
 * (use-printers.ts) calls `GET /shop/printers` to populate the printer
 * picker for the "Change Printer" retry action, which every shop role
 * INCLUDING SHOP_COUNTER can already perform (retry-print/change-
 * printer are EDIT_ORDERS-gated on ShopOrdersController, which
 * SHOP_COUNTER holds). Gating the read behind MANAGE_PRINTERS broke
 * that picker for the exact role that needs it most -- a counter
 * clerk retrying a failed job at the counter. §47's own permission
 * list has no separate "view printers" permission; any active shop
 * staff member listed in `@Roles()` below can read the list, matching
 * "MANAGE means write access", not "MANAGE means all access".
 *
 * 23.14 turns that convention into data: reads need VIEW_PRINTERS, granted (role-permissions.ts)
 * to every shop staff role including OPERATOR, so the assign-printer picker works for the
 * people who assign; writes still need MANAGE_PRINTERS and VIEW does not imply it. Pickers
 * should request `limit=100` (the page maximum); an unpaged call is a legacy bare array
 * bounded to 500 rows. */
@Controller("shop/printers")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(
  UserRole.SHOP_COUNTER,
  UserRole.SHOP_MANAGER,
  UserRole.SHOP_OWNER,
  UserRole.PRINTER_MANAGER,
  UserRole.OPERATOR,
)
export class PrintersController {
  constructor(private readonly printersService: PrintersService) {}

  @Get()
  @UseGuards(SearchRateLimitGuard)
  @RequirePermission(Permission.VIEW_PRINTERS)
  @ShopScopedField("query", "shopId")
  list(
    @Req() req: RequestWithUser,
    @Query() query: ListPrintersQueryDto,
  ): Promise<PrinterResponse[] | Page<PrinterResponse>> {
    return this.printersService.list(req.user!.id, query);
  }

  /** 23.14: detail (capabilities, page-limit usage, last seen, referencing rules). Same
   * VIEW_PRINTERS read permission as the list. */
  @Get(":id")
  @RequirePermission(Permission.VIEW_PRINTERS)
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", PrinterShopResolver)
  detail(@Param("id") id: string): Promise<PrinterDetailResponse> {
    return this.printersService.getDetail(id);
  }

  @Post()
  @RequirePermission(Permission.MANAGE_PRINTERS)
  @ShopScopedField("body", "shopId")
  register(@Req() req: RequestWithUser, @Body() dto: RegisterPrinterDto): Promise<PrinterResponse> {
    return this.printersService.register(req.user!.id, dto);
  }

  @Patch(":id")
  @RequirePermission(Permission.MANAGE_PRINTERS)
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", PrinterShopResolver)
  update(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: UpdatePrinterDto,
  ): Promise<PrinterResponse> {
    return this.printersService.update(id, dto, req.user!.id);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.MANAGE_PRINTERS)
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", PrinterShopResolver)
  remove(@Req() req: RequestWithUser, @Param("id") id: string): Promise<void> {
    return this.printersService.remove(id, req.user!.id);
  }
}
