import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { createZodDto } from "nestjs-zod";
import {
  createPurchaseOrderSchema,
  listPurchaseOrdersQuerySchema,
  receivePurchaseOrderSchema,
  updatePurchaseOrderPaymentSchema,
  updatePurchaseOrderSchema,
} from "@print-automated/validation";
import { Permission } from "@print-automated/types";
import { Injectable } from "@nestjs/common";
import { PrismaService } from "@print-automated/backend-shared";
import { JwtAuthGuard, type RequestWithUser } from "../auth/jwt-auth.guard.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { Roles } from "../auth/roles.decorator.js";
import { PermissionsGuard } from "../auth/permissions.guard.js";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { ShopScopeGuard } from "../auth/shop-scope.guard.js";
import type { ShopResourceResolver } from "../auth/shop-scope.interfaces.js";
import { ShopScoped, ShopScopedField } from "../auth/shop-scoped.decorator.js";
import type { Page } from "../inventory/inventory.service.js";
import { PurchaseOrdersService, type PurchaseOrderResponse } from "./purchase-orders.service.js";

class CreatePurchaseOrderDto extends createZodDto(createPurchaseOrderSchema) {}
class UpdatePurchaseOrderDto extends createZodDto(updatePurchaseOrderSchema) {}
class ListPurchaseOrdersQueryDto extends createZodDto(listPurchaseOrdersQuerySchema) {}
class ReceivePurchaseOrderDto extends createZodDto(receivePurchaseOrderSchema) {}
class UpdatePurchaseOrderPaymentDto extends createZodDto(updatePurchaseOrderPaymentSchema) {}

@Injectable()
export class PurchaseOrderShopResolver implements ShopResourceResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolveShopId(purchaseOrderId: string): Promise<string | null> {
    const row = await this.prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      select: { shopId: true },
    });
    return row?.shopId ?? null;
  }
}

/** 31/20.7. MANAGE_INVENTORY on every route (receiving changes stock; manager
 * and owner, data in ROLE_PERMISSIONS). `:id` routes resolve the PO shop through
 * ShopScopeGuard. */
@Controller("shop/purchase-orders")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(
  UserRole.SHOP_COUNTER,
  UserRole.SHOP_MANAGER,
  UserRole.SHOP_OWNER,
  UserRole.OPERATOR,
  UserRole.PRINTER_MANAGER,
)
@RequirePermission(Permission.MANAGE_INVENTORY)
export class PurchaseOrdersController {
  constructor(private readonly purchaseOrders: PurchaseOrdersService) {}

  @Get()
  @ShopScopedField("query", "shopId")
  list(
    @Req() req: RequestWithUser,
    @Query() query: ListPurchaseOrdersQueryDto,
  ): Promise<Page<PurchaseOrderResponse>> {
    return this.purchaseOrders.list(req.user!.id, query);
  }

  @Post()
  @ShopScopedField("body", "shopId")
  create(
    @Req() req: RequestWithUser,
    @Body() dto: CreatePurchaseOrderDto,
  ): Promise<PurchaseOrderResponse> {
    return this.purchaseOrders.create(req.user!.id, dto);
  }

  @Get(":id")
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", PurchaseOrderShopResolver)
  get(@Param("id") id: string): Promise<PurchaseOrderResponse> {
    return this.purchaseOrders.get(id);
  }

  @Patch(":id")
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", PurchaseOrderShopResolver)
  update(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: UpdatePurchaseOrderDto,
  ): Promise<PurchaseOrderResponse> {
    return this.purchaseOrders.update(id, dto, req.user!.id);
  }

  @Patch(":id/payment")
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", PurchaseOrderShopResolver)
  updatePayment(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: UpdatePurchaseOrderPaymentDto,
  ): Promise<PurchaseOrderResponse> {
    return this.purchaseOrders.updatePayment(id, dto, req.user!.id);
  }

  @Post(":id/order")
  @HttpCode(HttpStatus.OK)
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", PurchaseOrderShopResolver)
  place(@Req() req: RequestWithUser, @Param("id") id: string): Promise<PurchaseOrderResponse> {
    return this.purchaseOrders.place(id, req.user!.id);
  }

  @Post(":id/cancel")
  @HttpCode(HttpStatus.OK)
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", PurchaseOrderShopResolver)
  cancel(@Req() req: RequestWithUser, @Param("id") id: string): Promise<PurchaseOrderResponse> {
    return this.purchaseOrders.cancel(id, req.user!.id);
  }

  /** Idempotent: receiving an already-received PO returns it and changes nothing. */
  @Post(":id/receive")
  @HttpCode(HttpStatus.OK)
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", PurchaseOrderShopResolver)
  receive(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: ReceivePurchaseOrderDto,
  ): Promise<PurchaseOrderResponse> {
    return this.purchaseOrders.receive(id, dto, req.user!.id);
  }
}
