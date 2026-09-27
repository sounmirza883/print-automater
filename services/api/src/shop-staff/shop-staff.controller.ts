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
  Res,
  UseGuards,
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
import { AddShopStaffDto } from "./dto/add-shop-staff.dto.js";
import { ListShopStaffQueryDto } from "./dto/list-shop-staff-query.dto.js";
import {
  AcceptStaffInviteDto,
  ListStaffInvitesQueryDto,
  StaffDirectoryQueryDto,
} from "./dto/staff-invite.dto.js";
import { ShopStaffInviteShopResolver } from "./shop-staff-invite-shop.resolver.js";
import {
  ShopStaffInvitesService,
  type StaffInviteListItem,
  type StaffInviteProcessed,
} from "./shop-staff-invites.service.js";
import { ChangeShopStaffRoleDto } from "./dto/change-shop-staff-role.dto.js";
import { ShopStaffShopResolver } from "./shop-staff-shop.resolver.js";
import {
  ShopStaffService,
  type MyShopsResponse,
  type ShopStaffListItem,
  type StaffDirectoryItem,
  type ShopStaffMemberResponse,
} from "./shop-staff.service.js";
import { SearchRateLimitGuard } from "../rate-limit/search-rate-limit.guard.js";

/** 23.15: `POST /shop/staff-invites/accept` -- any signed-in account (a person with no staff
 * role yet has none of the roles the staff controller requires), authorised by the emailed
 * token plus the account's own email matching the invited address. */
@Controller("shop/staff-invites")
@UseGuards(JwtAuthGuard)
export class ShopStaffInvitesController {
  constructor(private readonly invitesService: ShopStaffInvitesService) {}

  @Post("accept")
  @HttpCode(HttpStatus.OK)
  accept(
    @Req() req: RequestWithUser,
    @Body() dto: AcceptStaffInviteDto,
  ): Promise<{ shopId: string; role: UserRole }> {
    return this.invitesService.acceptInvite(req.user!.id, dto.token);
  }
}

/** 23.22: `GET /shop/staff/me` -- the signed-in person plus the businesses they are an ACTIVE
 * member of, each with the effective role and permission list there. Any signed-in account:
 * it reports only the caller's own memberships (an empty list for someone with none), and
 * membership, not the account-level role, is what makes someone staff. The old account-role
 * gate refused an invited person whose account is a plain CUSTOMER account even after they
 * accepted, so they could never reach the business they had joined. Every business route
 * still authorises by the membership role. */
@Controller("shop/staff")
@UseGuards(JwtAuthGuard)
export class ShopStaffMeController {
  constructor(private readonly shopStaffService: ShopStaffService) {}

  @Get("me")
  me(@Req() req: RequestWithUser): Promise<MyShopsResponse> {
    return this.shopStaffService.me(req.user!.id);
  }
}

/** §47/16.4: add/remove/change-role need MANAGE_USERS, granted only to
 * SHOP_MANAGER/SHOP_OWNER (role-permissions.ts); the other staff roles reach
 * only the directory here. `GET /me` lives on ShopStaffMeController (23.22). */
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
  constructor(
    private readonly shopStaffService: ShopStaffService,
    private readonly invitesService: ShopStaffInvitesService,
  ) {}

  /** 23.15: id + display name of active members, for pickers (the order search's operator
   * filter). VIEW_STAFF_DIRECTORY is held by every staff role: no email/role/status leak. */
  @Get("directory")
  @UseGuards(SearchRateLimitGuard)
  @RequirePermission(Permission.VIEW_STAFF_DIRECTORY)
  @ShopScopedField("query", "shopId")
  directory(
    @Req() req: RequestWithUser,
    @Query() query: StaffDirectoryQueryDto,
  ): Promise<Page<StaffDirectoryItem>> {
    return this.shopStaffService.directory(req.user!.id, query);
  }

  /** 23.15: pending invitations (MANAGE_USERS). */
  @Get("invites")
  @RequirePermission(Permission.MANAGE_USERS)
  @ShopScopedField("query", "shopId")
  listInvites(
    @Req() req: RequestWithUser,
    @Query() query: ListStaffInvitesQueryDto,
  ): Promise<Page<StaffInviteListItem>> {
    return this.invitesService.listPending(req.user!.id, query);
  }

  @Delete("invites/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.MANAGE_USERS)
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", ShopStaffInviteShopResolver)
  revokeInvite(@Req() req: RequestWithUser, @Param("id") id: string): Promise<void> {
    return this.invitesService.revoke(id, req.user!.id);
  }

  /** 23.6: the roster the staff-management page needs (MANAGE_USERS: owner and manager). */
  @Get()
  @UseGuards(SearchRateLimitGuard)
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
  async add(
    @Req() req: RequestWithUser,
    @Body() dto: AddShopStaffDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ShopStaffMemberResponse | StaffInviteProcessed> {
    if (dto.email !== undefined) {
      // 23.15: by email -> ONE uniform 202 body whether the address had an account or not.
      res.status(HttpStatus.ACCEPTED);
      return this.invitesService.inviteByEmail(req.user!.id, {
        shopId: dto.shopId,
        email: dto.email,
        role: dto.role,
      });
    }
    return this.shopStaffService.addStaff(req.user!.id, {
      shopId: dto.shopId,
      userId: dto.userId!,
      role: dto.role,
    });
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
