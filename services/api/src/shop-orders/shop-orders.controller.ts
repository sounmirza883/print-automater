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
  Res,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import type { Response } from "express";
import { UserRole } from "@prisma/client";
import { Permission, type Page } from "@print-automated/types";
import { JwtAuthGuard, type RequestWithUser } from "../auth/jwt-auth.guard.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { Roles } from "../auth/roles.decorator.js";
import { PermissionsGuard } from "../auth/permissions.guard.js";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { ShopScopeGuard } from "../auth/shop-scope.guard.js";
import { ShopScoped, ShopScopedField } from "../auth/shop-scoped.decorator.js";
import { InvoicesService } from "../invoices/invoices.service.js";
import type { OrderResponse } from "../orders/orders.service.js";
import { ChangePrinterDto } from "./dto/change-printer.dto.js";
import { CreateCounterOrderDto } from "./dto/create-counter-order.dto.js";
import { ListShopOrdersQueryDto } from "./dto/list-shop-orders-query.dto.js";
import { SearchShopOrdersQueryDto } from "./dto/search-shop-orders-query.dto.js";
import { SearchRateLimitGuard } from "../rate-limit/search-rate-limit.guard.js";
import { DeliveryRedactionInterceptor } from "../deliveries/delivery-redaction.interceptor.js";
import { QualityCheckDto } from "./dto/quality-check.dto.js";
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
@UseInterceptors(DeliveryRedactionInterceptor)
export class ShopOrdersController {
  constructor(
    private readonly shopOrdersService: ShopOrdersService,
    private readonly invoicesService: InvoicesService,
  ) {}

  @Get()
  @RequirePermission(Permission.VIEW_ORDERS)
  @ShopScopedField("query", "shopId")
  listOrders(
    @Req() req: RequestWithUser,
    @Query() query: ListShopOrdersQueryDto,
  ): Promise<ShopOrdersGrouped | Page<ShopOrderResponse>> {
    return this.shopOrdersService.listGrouped(req.user!.id, query);
  }

  /** 23.6 (PRD 43/44): search + filters, one flat page. Declared before any `:id` route.
   * Shares the per-user search budget (SearchRateLimitGuard). */
  @Get("search")
  @UseGuards(SearchRateLimitGuard)
  @RequirePermission(Permission.VIEW_ORDERS)
  @ShopScopedField("query", "shopId")
  searchOrders(
    @Req() req: RequestWithUser,
    @Query() query: SearchShopOrdersQueryDto,
  ): Promise<Page<ShopOrderResponse>> {
    return this.shopOrdersService.search(req.user!.id, query);
  }

  /** §4.2/§11/17.5: staff placing an order at the counter on a
   * customer's behalf -- CREATE_ORDERS, the same permission the
   * customer-web-equivalent action would require of a self-service
   * customer, held by SHOP_COUNTER (role-permissions.ts). */
  @Post()
  @RequirePermission(Permission.CREATE_ORDERS)
  @ShopScopedField("body", "shopId")
  createCounterOrder(
    @Req() req: RequestWithUser,
    @Body() dto: CreateCounterOrderDto,
  ): Promise<OrderResponse> {
    return this.shopOrdersService.createCounterOrder(req.user!.id, dto);
  }

  @Get(":id")
  @RequirePermission(Permission.VIEW_ORDERS)
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", OrderShopResolver)
  getOrder(@Param("id") id: string): Promise<ShopOrderResponse> {
    return this.shopOrdersService.getOrder(id);
  }

  /** §36/17.7: shop staff's own access to any order at their shop.
   * Reuses this controller's own existing ShopScopeGuard/
   * OrderShopResolver chain -- the exact same authorization every
   * other :id route here already has -- rather than inventing new
   * access-control logic for this one endpoint. */
  @Get(":id/invoice")
  @RequirePermission(Permission.VIEW_ORDERS)
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", OrderShopResolver)
  async downloadInvoice(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.invoicesService.generateForOrder(id, req.user!.id);
    res
      .status(HttpStatus.OK)
      .set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${encodeURIComponent(filename)}"`,
        "Content-Length": String(buffer.length),
      })
      .send(buffer);
  }

  @Post(":id/accept")
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.EDIT_ORDERS)
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", OrderShopResolver)
  accept(@Req() req: RequestWithUser, @Param("id") id: string): Promise<ShopOrderResponse> {
    return this.shopOrdersService.acceptOrder(id, req.user!.id);
  }

  /** §35/17.6: staff recording a cash/offline payment against an
   * order with no PSP involved. EDIT_ORDERS -- same permission every
   * other staff-driven order action on this controller uses (see its
   * own class-level comment on that choice); this is squarely a
   * front-of-house counter action, not printer/job assignment. */
  @Post(":id/record-payment")
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.EDIT_ORDERS)
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", OrderShopResolver)
  recordManualPayment(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
  ): Promise<ShopOrderResponse> {
    return this.shopOrdersService.recordManualPayment(id, req.user!.id);
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

  /** 21.3 (§68/69): the quality-check verdict on an order waiting in
   * QUALITY_CHECK. QUALITY_CHECK is its own permission (data in ROLE_PERMISSIONS):
   * operators and above, not the front counter. */
  @Post(":id/quality-check")
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.QUALITY_CHECK)
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", OrderShopResolver)
  qualityCheck(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: QualityCheckDto,
  ): Promise<ShopOrderResponse> {
    return this.shopOrdersService.recordQualityCheck(id, req.user!.id, dto);
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
    return this.shopOrdersService.resolveUnknownPrint(id, req.user!.id, dto.resolution, dto.jobId, {
      reason: dto.failureReason,
      note: dto.failureNote,
    });
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
