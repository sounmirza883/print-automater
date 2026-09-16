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
import { JwtAuthGuard, type RequestWithUser } from "../auth/jwt-auth.guard.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { Roles } from "../auth/roles.decorator.js";
import { ShopScopeGuard } from "../auth/shop-scope.guard.js";
import { ShopScoped } from "../auth/shop-scoped.decorator.js";
import { ListShopOrdersQueryDto } from "./dto/list-shop-orders-query.dto.js";
import { RejectOrderDto } from "./dto/reject-order.dto.js";
import { OrderShopResolver } from "./order-shop.resolver.js";
import {
  ShopOrdersService,
  type ShopOrderResponse,
  type ShopOrdersGrouped,
} from "./shop-orders.service.js";

/** §81's three stacked guards: JwtAuthGuard (authenticated at all) ->
 * RolesGuard (one of the shop-staff roles) -> ShopScopeGuard (active
 * staff at *this* shop specifically, on the `:id` route only -- the
 * list route has no single resource for it to resolve, so its own
 * membership check runs inside ShopOrdersService.listGrouped instead). */
@Controller("shop/orders")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SHOP_COUNTER, UserRole.SHOP_MANAGER, UserRole.SHOP_OWNER)
export class ShopOrdersController {
  constructor(private readonly shopOrdersService: ShopOrdersService) {}

  @Get()
  listOrders(
    @Req() req: RequestWithUser,
    @Query() query: ListShopOrdersQueryDto,
  ): Promise<ShopOrdersGrouped> {
    return this.shopOrdersService.listGrouped(req.user!.id, query.shopId);
  }

  @Get(":id")
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", OrderShopResolver)
  getOrder(@Param("id") id: string): Promise<ShopOrderResponse> {
    return this.shopOrdersService.getOrder(id);
  }

  @Post(":id/accept")
  @HttpCode(HttpStatus.OK)
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", OrderShopResolver)
  accept(@Req() req: RequestWithUser, @Param("id") id: string): Promise<ShopOrderResponse> {
    return this.shopOrdersService.acceptOrder(id, req.user!.id);
  }

  @Post(":id/reject")
  @HttpCode(HttpStatus.OK)
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
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", OrderShopResolver)
  markReady(@Req() req: RequestWithUser, @Param("id") id: string): Promise<ShopOrderResponse> {
    return this.shopOrdersService.markReady(id, req.user!.id);
  }

  @Post(":id/complete")
  @HttpCode(HttpStatus.OK)
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", OrderShopResolver)
  complete(@Req() req: RequestWithUser, @Param("id") id: string): Promise<ShopOrderResponse> {
    return this.shopOrdersService.completeOrder(id, req.user!.id);
  }

  /** §48/10.1: staff's "Retry" choice on a PRINT_FAILED order. */
  @Post(":id/retry-print")
  @HttpCode(HttpStatus.OK)
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", OrderShopResolver)
  retryPrint(@Req() req: RequestWithUser, @Param("id") id: string): Promise<ShopOrderResponse> {
    return this.shopOrdersService.retryPrint(id, req.user!.id);
  }
}
