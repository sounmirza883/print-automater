import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
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
import { ChangePrinterDto } from "./dto/change-printer.dto.js";
import { ListShopOrdersQueryDto } from "./dto/list-shop-orders-query.dto.js";
import { RejectOrderDto } from "./dto/reject-order.dto.js";
import { ResolveUnknownPrintDto } from "./dto/resolve-unknown-print.dto.js";
import { OrderShopResolver } from "./order-shop.resolver.js";
import {
  ShopOrdersService,
  type ShopOrderResponse,
  type ShopOrdersGrouped,
} from "./shop-orders.service.js";

/** §81's guard chain: JwtAuthGuard (authenticated at all) -> RolesGuard
 * (one of the shop-staff roles) -> PermissionsGuard (real per-action
 * differentiation, §47/16.3) -> ShopScopeGuard (active staff at *this*
 * shop specifically, on the `:id` routes -- the list route has no
 * single resource for it to resolve, so its own membership check runs
 * inside ShopOrdersService.listGrouped instead).
 *
 * §47/16.3 permission assignment: reads (list/detail) need VIEW_ORDERS,
 * every write here (accept/reject/ready/complete/retry-print/resolve-
 * unknown/change-printer) needs EDIT_ORDERS -- OPERATOR has VIEW_ORDERS
 * but not EDIT_ORDERS (production-floor role, not front-of-house), so
 * it can see this list but not act on it; the reverse is true nowhere
 * in this controller (every shop-staff role with EDIT_ORDERS also has
 * VIEW_ORDERS). change-printer is deliberately kept at EDIT_ORDERS
 * rather than ASSIGN_JOBS for this sub-phase -- it's staff's own manual
 * override of a PRINT_FAILED order (§49/10.4), the same actor and
 * situation as the rest of this controller's failure-recovery actions,
 * not the operator-facing job (re)assignment ASSIGN_JOBS is meant to
 * gate (18.7/18.9's own scope). Revisit once Phase 18 gives ASSIGN_JOBS
 * a real, separate route to mean something distinct from this. */
@Controller("shop/orders")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(
  UserRole.SHOP_COUNTER,
  UserRole.SHOP_MANAGER,
  UserRole.SHOP_OWNER,
  UserRole.OPERATOR,
  UserRole.PRINTER_MANAGER,
)
export class ShopOrdersController {
  constructor(private readonly shopOrdersService: ShopOrdersService) {}

  @Get()
  @RequirePermission(Permission.VIEW_ORDERS)
  @ShopScopedField("query", "shopId")
  listOrders(
    @Req() req: RequestWithUser,
    @Query() query: ListShopOrdersQueryDto,
  ): Promise<ShopOrdersGrouped> {
    return this.shopOrdersService.listGrouped(req.user!.id, query.shopId);
  }

  @Get(":id")
  @RequirePermission(Permission.VIEW_ORDERS)
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", OrderShopResolver)
  getOrder(@Param("id") id: string): Promise<ShopOrderResponse> {
    return this.shopOrdersService.getOrder(id);
  }

  @Post(":id/accept")
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.EDIT_ORDERS)
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", OrderShopResolver)
  accept(@Req() req: RequestWithUser, @Param("id") id: string): Promise<ShopOrderResponse> {
    return this.shopOrdersService.acceptOrder(id, req.user!.id);
  }

  @Post(":id/reject")
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.EDIT_ORDERS)
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", OrderShopResolver)
  reject(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: RejectOrderDto,
  ): Promise<ShopOrderResponse> {
    return this.shopOrdersService.rejectOrder(id, req.user!.id, dto.reason);
  }

  @Post(":id/ready")
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.EDIT_ORDERS)
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", OrderShopResolver)
  markReady(@Req() req: RequestWithUser, @Param("id") id: string): Promise<ShopOrderResponse> {
    return this.shopOrdersService.markReady(id, req.user!.id);
  }

  @Post(":id/complete")
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.EDIT_ORDERS)
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", OrderShopResolver)
  complete(@Req() req: RequestWithUser, @Param("id") id: string): Promise<ShopOrderResponse> {
    return this.shopOrdersService.completeOrder(id, req.user!.id);
  }

  /** §48/10.1: staff's "Retry" choice on a PRINT_FAILED order. */
  @Post(":id/retry-print")
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.EDIT_ORDERS)
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", OrderShopResolver)
  retryPrint(@Req() req: RequestWithUser, @Param("id") id: string): Promise<ShopOrderResponse> {
    return this.shopOrdersService.retryPrint(id, req.user!.id);
  }

  /** §47/10.3: staff's own resolution of a PRINT_STATUS_UNKNOWN order. */
  @Post(":id/resolve-unknown")
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.EDIT_ORDERS)
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", OrderShopResolver)
  resolveUnknown(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: ResolveUnknownPrintDto,
  ): Promise<ShopOrderResponse> {
    return this.shopOrdersService.resolveUnknownPrint(id, req.user!.id, dto.resolution);
  }

  /** §49/10.4: staff's own "Change Printer" choice. */
  @Post(":id/change-printer")
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.EDIT_ORDERS)
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", OrderShopResolver)
  changePrinter(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: ChangePrinterDto,
  ): Promise<ShopOrderResponse> {
    return this.shopOrdersService.changePrinter(id, req.user!.id, dto.printerId);
  }
}
