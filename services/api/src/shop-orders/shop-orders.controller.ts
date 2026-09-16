import { Controller, Get, Param, Query, Req, UseGuards } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { JwtAuthGuard, type RequestWithUser } from "../auth/jwt-auth.guard.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { Roles } from "../auth/roles.decorator.js";
import { ShopScopeGuard } from "../auth/shop-scope.guard.js";
import { ShopScoped } from "../auth/shop-scoped.decorator.js";
import { ListShopOrdersQueryDto } from "./dto/list-shop-orders-query.dto.js";
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
}
