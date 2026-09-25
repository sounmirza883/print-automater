import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
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
import { ShopScoped } from "../auth/shop-scoped.decorator.js";
import { OrderShopResolver } from "../shop-orders/order-shop.resolver.js";
import { DeliveryStatusDto, SaveDeliveryDto } from "./dto/delivery.dto.js";
import { DeliveriesService, type DeliveryResponse } from "./deliveries.service.js";

/** 21.5 (§71). Reading a delivery needs VIEW_ORDERS (anyone who can see the
 * order); writing needs MANAGE_DELIVERY (data in ROLE_PERMISSIONS). Every route
 * resolves the order's shop through ShopScopeGuard, so another shop's staff get
 * 403, never the data. */
@Controller("shop/orders")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, ShopScopeGuard)
@Roles(
  UserRole.SHOP_COUNTER,
  UserRole.SHOP_MANAGER,
  UserRole.SHOP_OWNER,
  UserRole.OPERATOR,
  UserRole.PRINTER_MANAGER,
)
export class DeliveriesController {
  constructor(private readonly deliveries: DeliveriesService) {}

  @Get(":id/delivery")
  @RequirePermission(Permission.VIEW_ORDERS)
  @ShopScoped("id", OrderShopResolver)
  get(@Param("id") id: string): Promise<DeliveryResponse> {
    return this.deliveries.get(id);
  }

  @Put(":id/delivery")
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.MANAGE_DELIVERY)
  @ShopScoped("id", OrderShopResolver)
  save(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: SaveDeliveryDto,
  ): Promise<DeliveryResponse> {
    return this.deliveries.save(id, req.user!.id, dto);
  }

  @Post(":id/delivery/status")
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.MANAGE_DELIVERY)
  @ShopScoped("id", OrderShopResolver)
  setStatus(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: DeliveryStatusDto,
  ): Promise<DeliveryResponse> {
    return this.deliveries.setStatus(id, req.user!.id, dto);
  }
}
