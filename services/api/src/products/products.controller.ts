import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { Permission, type Page } from "@print-automated/types";
import { JwtAuthGuard, type RequestWithUser } from "../auth/jwt-auth.guard.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { Roles } from "../auth/roles.decorator.js";
import { PermissionsGuard } from "../auth/permissions.guard.js";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { ShopScopeGuard } from "../auth/shop-scope.guard.js";
import { ShopScoped, ShopScopedField } from "../auth/shop-scoped.decorator.js";
import { CreateProductDto } from "./dto/create-product.dto.js";
import { ListProductsQueryDto } from "./dto/list-products-query.dto.js";
import { UpdateProductDto } from "./dto/update-product.dto.js";
import { ProductShopResolver } from "./product-shop.resolver.js";
import { ProductsService, type ProductResponse } from "./products.service.js";
import { SearchRateLimitGuard } from "../rate-limit/search-rate-limit.guard.js";

/** §13/§47/17.3: a shop's own product catalog, gated by MANAGE_PRICES
 * (granted only to SHOP_MANAGER/SHOP_OWNER, role-permissions.ts) --
 * the same permission 17.3's pricing-rule-version endpoint uses, since
 * a product's fields are catalog/pricing configuration in the same
 * sense a PricingRule is, not day-to-day order handling. */
@Controller("shop/products")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(
  UserRole.SHOP_COUNTER,
  UserRole.SHOP_MANAGER,
  UserRole.SHOP_OWNER,
  UserRole.OPERATOR,
  UserRole.PRINTER_MANAGER,
)
@RequirePermission(Permission.MANAGE_PRICES)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @UseGuards(SearchRateLimitGuard)
  @ShopScopedField("query", "shopId")
  list(
    @Req() req: RequestWithUser,
    @Query() query: ListProductsQueryDto,
  ): Promise<ProductResponse[] | Page<ProductResponse>> {
    return this.productsService.list(req.user!.id, query);
  }

  @Post()
  @ShopScopedField("body", "shopId")
  create(@Req() req: RequestWithUser, @Body() dto: CreateProductDto): Promise<ProductResponse> {
    return this.productsService.create(req.user!.id, dto);
  }

  @Patch(":id")
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", ProductShopResolver)
  update(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<ProductResponse> {
    return this.productsService.update(id, dto, req.user!.id);
  }
}
