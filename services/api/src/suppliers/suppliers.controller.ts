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
import { InventoryItemShopResolver } from "../inventory/inventory-item-shop.resolver.js";
import type { Page } from "../inventory/inventory.service.js";
import {
  CreateSupplierDto,
  LinkSupplierProductDto,
  ListSuppliersQueryDto,
  PageQueryDto,
  UpdateSupplierDto,
  UpdateSupplierProductDto,
} from "./dto/suppliers.dto.js";
import { SupplierProductShopResolver, SupplierShopResolver } from "./supplier-shop.resolvers.js";
import {
  SuppliersService,
  type SupplierProductResponse,
  type SupplierResponse,
} from "./suppliers.service.js";

/** 29/30/20.6. Every route needs MANAGE_SUPPLIERS (manager, owner; data in
 * ROLE_PERMISSIONS). `:id` routes resolve the resource shop through
 * ShopScopeGuard, so another shop's staff get 403, never the data. */
@Controller("shop")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(
  UserRole.SHOP_COUNTER,
  UserRole.SHOP_MANAGER,
  UserRole.SHOP_OWNER,
  UserRole.OPERATOR,
  UserRole.PRINTER_MANAGER,
)
@RequirePermission(Permission.MANAGE_SUPPLIERS)
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get("suppliers")
  @ShopScopedField("query", "shopId")
  list(
    @Req() req: RequestWithUser,
    @Query() query: ListSuppliersQueryDto,
  ): Promise<Page<SupplierResponse>> {
    return this.suppliers.list(req.user!.id, query);
  }

  @Post("suppliers")
  @ShopScopedField("body", "shopId")
  create(@Req() req: RequestWithUser, @Body() dto: CreateSupplierDto): Promise<SupplierResponse> {
    return this.suppliers.create(req.user!.id, dto);
  }

  @Get("suppliers/:id")
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", SupplierShopResolver)
  get(@Param("id") id: string): Promise<SupplierResponse> {
    return this.suppliers.get(id);
  }

  @Patch("suppliers/:id")
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", SupplierShopResolver)
  update(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: UpdateSupplierDto,
  ): Promise<SupplierResponse> {
    return this.suppliers.update(id, dto, req.user!.id);
  }

  @Get("suppliers/:id/products")
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", SupplierShopResolver)
  listProducts(
    @Param("id") id: string,
    @Query() query: PageQueryDto,
  ): Promise<Page<SupplierProductResponse>> {
    return this.suppliers.listProducts(id, query);
  }

  @Post("suppliers/:id/products")
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", SupplierShopResolver)
  link(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: LinkSupplierProductDto,
  ): Promise<SupplierProductResponse> {
    return this.suppliers.link(id, dto, req.user!.id);
  }

  /** The other side of the many-to-many: who supplies this item. */
  @Get("inventory/items/:id/suppliers")
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", InventoryItemShopResolver)
  suppliersOfItem(
    @Param("id") id: string,
    @Query() query: PageQueryDto,
  ): Promise<Page<SupplierProductResponse>> {
    return this.suppliers.listSuppliersOfItem(id, query);
  }

  @Patch("supplier-products/:id")
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", SupplierProductShopResolver)
  updateLink(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: UpdateSupplierProductDto,
  ): Promise<SupplierProductResponse> {
    return this.suppliers.updateLink(id, dto, req.user!.id);
  }

  @Delete("supplier-products/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", SupplierProductShopResolver)
  unlink(@Req() req: RequestWithUser, @Param("id") id: string): Promise<void> {
    return this.suppliers.unlink(id, req.user!.id);
  }
}
