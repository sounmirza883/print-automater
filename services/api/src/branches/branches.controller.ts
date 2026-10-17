import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { Permission } from "@print-automated/types";
import { JwtAuthGuard, type RequestWithUser } from "../auth/jwt-auth.guard.js";
import { PermissionsGuard } from "../auth/permissions.guard.js";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { ShopScopeGuard } from "../auth/shop-scope.guard.js";
import { ShopScoped, ShopScopedField } from "../auth/shop-scoped.decorator.js";
import { BranchShopResolver } from "./branch-shop.resolver.js";
import { BranchesService, type BranchResponse } from "./branches.service.js";
import {
  CreateBranchDto,
  ListBranchesQueryDto,
  SetBranchOpenStateDto,
  UpdateBranchDto,
} from "./dto/branch.dto.js";

/** A business's branches. Everyone on staff can read them (a branch-bound person only gets their
 * own); creating, editing and archiving are owner-only (business settings access); opening or
 * closing also lets a branch's own manager through, decided in the service. */
@Controller("shop/branches")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(
  UserRole.SHOP_COUNTER,
  UserRole.SHOP_MANAGER,
  UserRole.SHOP_OWNER,
  UserRole.OPERATOR,
  UserRole.PRINTER_MANAGER,
)
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  @RequirePermission(Permission.VIEW_STAFF_DIRECTORY)
  @ShopScopedField("query", "shopId")
  list(
    @Req() req: RequestWithUser,
    @Query() query: ListBranchesQueryDto,
  ): Promise<BranchResponse[]> {
    return this.branches.list(req.user!.id, query);
  }

  @Post()
  @RequirePermission(Permission.MANAGE_SETTINGS)
  @ShopScopedField("body", "shopId")
  create(@Req() req: RequestWithUser, @Body() dto: CreateBranchDto): Promise<BranchResponse> {
    return this.branches.create(req.user!.id, dto);
  }

  @Patch(":id")
  @RequirePermission(Permission.MANAGE_SETTINGS)
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", BranchShopResolver)
  update(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: UpdateBranchDto,
  ): Promise<BranchResponse> {
    return this.branches.update(id, dto, req.user!.id);
  }

  @Put(":id/open-state")
  @RequirePermission(Permission.MANAGE_USERS)
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", BranchShopResolver)
  setOpenState(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: SetBranchOpenStateDto,
  ): Promise<BranchResponse> {
    return this.branches.setOpenState(id, dto.isOpen, req.user!.id);
  }

  @Post(":id/archive")
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.MANAGE_SETTINGS)
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", BranchShopResolver)
  archive(@Req() req: RequestWithUser, @Param("id") id: string): Promise<BranchResponse> {
    return this.branches.archive(id, req.user!.id);
  }
}
