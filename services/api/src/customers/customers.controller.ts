import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { Permission } from "@print-automated/types";
import { JwtAuthGuard, type RequestWithUser } from "../auth/jwt-auth.guard.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { Roles } from "../auth/roles.decorator.js";
import { PermissionsGuard } from "../auth/permissions.guard.js";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { ShopScopeGuard } from "../auth/shop-scope.guard.js";
import { ShopScoped, ShopScopedField } from "../auth/shop-scoped.decorator.js";
import { CustomerShopResolver } from "./customer-shop.resolver.js";
import { CreateCustomerDto } from "./dto/create-customer.dto.js";
import { ListCustomersQueryDto } from "./dto/list-customers-query.dto.js";
import { UpdateCustomerDto } from "./dto/update-customer.dto.js";
import { CustomersService, type CustomerResponse } from "./customers.service.js";

/** §33/34/17.4: walk-in customer records -- see CustomersService's own
 * comment for the CREATE_ORDERS/VIEW_ORDERS/EDIT_ORDERS permission
 * choice (deliberately NOT MANAGE_USERS/MANAGE_PRICES). */
@Controller("shop/customers")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(
  UserRole.SHOP_COUNTER,
  UserRole.SHOP_MANAGER,
  UserRole.SHOP_OWNER,
  UserRole.OPERATOR,
  UserRole.PRINTER_MANAGER,
)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  @RequirePermission(Permission.VIEW_ORDERS)
  @ShopScopedField("query", "shopId")
  list(
    @Req() req: RequestWithUser,
    @Query() query: ListCustomersQueryDto,
  ): Promise<CustomerResponse[]> {
    return this.customersService.list(req.user!.id, query);
  }

  @Post()
  @RequirePermission(Permission.CREATE_ORDERS)
  @ShopScopedField("body", "shopId")
  create(@Req() req: RequestWithUser, @Body() dto: CreateCustomerDto): Promise<CustomerResponse> {
    return this.customersService.create(req.user!.id, dto);
  }

  @Patch(":id")
  @RequirePermission(Permission.EDIT_ORDERS)
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", CustomerShopResolver)
  update(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: UpdateCustomerDto,
  ): Promise<CustomerResponse> {
    return this.customersService.update(id, dto, req.user!.id);
  }
}
