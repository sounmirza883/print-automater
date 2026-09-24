import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
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
import { IdempotencyInterceptor } from "../idempotency/idempotency.interceptor.js";
import {
  CreateInventoryItemDto,
  GetInventorySettingsQueryDto,
  UpdateInventorySettingsDto,
  ListInventoryItemsQueryDto,
  ListInventoryMovementsQueryDto,
  RecordInventoryMovementDto,
  UpdateInventoryItemDto,
} from "./dto/inventory.dto.js";
import { InventoryItemShopResolver } from "./inventory-item-shop.resolver.js";
import {
  InventoryService,
  type InventoryItemResponse,
  type InventoryMovementResponse,
  type InventorySettingsResponse,
  type Page,
} from "./inventory.service.js";

/** §26/§27/20.2. Reads need VIEW_INVENTORY (operators, printer managers,
 * managers, owners); every write needs MANAGE_INVENTORY (managers, owners) --
 * both are data in ROLE_PERMISSIONS. `shopId` routes (list/create) check
 * membership in the service; `:id` routes go through ShopScopeGuard, so an item
 * of another shop is a 403, never a leak. */
@Controller("shop/inventory")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(
  UserRole.SHOP_COUNTER,
  UserRole.SHOP_MANAGER,
  UserRole.SHOP_OWNER,
  UserRole.OPERATOR,
  UserRole.PRINTER_MANAGER,
)
@RequirePermission(Permission.VIEW_INVENTORY)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get("settings")
  @ShopScopedField("query", "shopId")
  getSettings(
    @Req() req: RequestWithUser,
    @Query() query: GetInventorySettingsQueryDto,
  ): Promise<InventorySettingsResponse> {
    return this.inventory.getSettings(query.shopId, req.user!.id);
  }

  /** PRD 28: switch paper-availability gating and consumption on/off (default off). */
  @Put("settings")
  @RequirePermission(Permission.MANAGE_INVENTORY)
  @ShopScopedField("body", "shopId")
  updateSettings(
    @Req() req: RequestWithUser,
    @Body() dto: UpdateInventorySettingsDto,
  ): Promise<InventorySettingsResponse> {
    return this.inventory.updateSettings(dto, req.user!.id);
  }

  @Get("items")
  @ShopScopedField("query", "shopId")
  listItems(
    @Req() req: RequestWithUser,
    @Query() query: ListInventoryItemsQueryDto,
  ): Promise<Page<InventoryItemResponse>> {
    return this.inventory.listItems(req.user!.id, query);
  }

  @Post("items")
  @RequirePermission(Permission.MANAGE_INVENTORY)
  @ShopScopedField("body", "shopId")
  createItem(
    @Req() req: RequestWithUser,
    @Body() dto: CreateInventoryItemDto,
  ): Promise<InventoryItemResponse> {
    return this.inventory.createItem(req.user!.id, dto);
  }

  @Get("items/:id")
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", InventoryItemShopResolver)
  getItem(@Param("id") id: string): Promise<InventoryItemResponse> {
    return this.inventory.getItem(id);
  }

  @Patch("items/:id")
  @RequirePermission(Permission.MANAGE_INVENTORY)
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", InventoryItemShopResolver)
  updateItem(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: UpdateInventoryItemDto,
  ): Promise<InventoryItemResponse> {
    return this.inventory.updateItem(id, dto, req.user!.id);
  }

  /** Idempotent under a client-supplied `Idempotency-Key` header: a retried tap
   * after a dropped response replays the first result instead of moving stock
   * twice. */
  @Post("items/:id/movements")
  @RequirePermission(Permission.MANAGE_INVENTORY)
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", InventoryItemShopResolver)
  @UseInterceptors(IdempotencyInterceptor)
  recordMovement(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: RecordInventoryMovementDto,
  ): Promise<{ movement: InventoryMovementResponse; item: InventoryItemResponse }> {
    return this.inventory.recordMovement(id, dto, req.user!.id);
  }

  @Get("items/:id/movements")
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", InventoryItemShopResolver)
  listMovements(
    @Param("id") id: string,
    @Query() query: ListInventoryMovementsQueryDto,
  ): Promise<Page<InventoryMovementResponse>> {
    return this.inventory.listMovements(id, query);
  }
}
