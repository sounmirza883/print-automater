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
import { Permission, type Page } from "@print-automated/types";
import { JwtAuthGuard, type RequestWithUser } from "../auth/jwt-auth.guard.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { Roles } from "../auth/roles.decorator.js";
import { PermissionsGuard } from "../auth/permissions.guard.js";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { ShopScopeGuard } from "../auth/shop-scope.guard.js";
import { ShopScoped, ShopScopedField } from "../auth/shop-scoped.decorator.js";
import { AddShopStaffDto } from "./dto/add-shop-staff.dto.js";
import { ListShopStaffQueryDto } from "./dto/list-shop-staff-query.dto.js";
import { ChangeShopStaffRoleDto } from "./dto/change-shop-staff-role.dto.js";
import { ShopStaffShopResolver } from "./shop-staff-shop.resolver.js";
import {
  ShopStaffService,
  type MyShopMembership,
  type ShopStaffListItem,
  type ShopStaffMemberResponse,
} from "./shop-staff.service.js";

/** §47/16.4: add/remove/change-role need MANAGE_USERS, granted only to
 * SHOP_MANAGER/SHOP_OWNER (role-permissions.ts) -- COUNTER/OPERATOR/
 * PRINTER_MANAGER can all reach `GET /me` (it's just "which shops am I
 * staff at"), same as before 16.4, but not the management routes. */
@Controller("shop/staff")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(
  UserRole.SHOP_COUNTER,
  UserRole.SHOP_MANAGER,
  UserRole.SHOP_OWNER,
  UserRole.OPERATOR,
  UserRole.PRINTER_MANAGER,
)
export class ShopStaffController {
  constructor(private readonly shopStaffService: ShopStaffService) {}

  @Get("me")
  myShops(@Req() req: RequestWithUser): Promise<{ shops: MyShopMembership[] }> {
    return this.shopStaffService.myShops(req.user!.id).then((shops) => ({ shops }));
  }

  /** 23.6: the roster the staff-management page needs (MANAGE_USERS: owner and manager). */
  @Get()
  @RequirePermission(Permission.MANAGE_USERS)
  @ShopScopedField("query", "shopId")
  list(
    @Req() req: RequestWithUser,
    @Query() query: ListShopStaffQueryDto,
  ): Promise<Page<ShopStaffListItem>> {
    return this.shopStaffService.listStaff(req.user!.id, query);
  }

  @Post()
  @RequirePermission(Permission.MANAGE_USERS)
  @ShopScopedField("body", "shopId")
  add(@Req() req: RequestWithUser, @Body() dto: AddShopStaffDto): Promise<ShopStaffMemberResponse> {
    return this.shopStaffService.addStaff(req.user!.id, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.MANAGE_USERS)
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", ShopStaffShopResolver)
  remove(@Req() req: RequestWithUser, @Param("id") id: string): Promise<void> {
    return this.shopStaffService.removeStaff(id, req.user!.id);
  }

  @Patch(":id/role")
  @RequirePermission(Permission.MANAGE_USERS)
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", ShopStaffShopResolver)
  changeRole(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: ChangeShopStaffRoleDto,
  ): Promise<ShopStaffMemberResponse> {
    return this.shopStaffService.changeRole(id, dto.role, req.user!.id);
  }
}
