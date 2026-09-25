import { ForbiddenException, HttpStatus, Injectable } from "@nestjs/common";
import {
  Prisma,
  type InventoryItem,
  type InventoryMovement,
  type InventoryMovementType,
} from "@prisma/client";
import type {
  CreateInventoryItemInput,
  ListInventoryAlertsQueryInput,
  ListInventoryItemsQueryInput,
  ListInventoryMovementsQueryInput,
  RecordInventoryMovementInput,
  UpdateInventoryItemInput,
  UpdateInventorySettingsInput,
} from "@print-automated/validation";
import {
  AppException,
  AuditService,
  PrismaService,
  applyStockMovement,
  isLowStock,
} from "@print-automated/backend-shared";
import { AuditAction } from "../audit/audit-action.js";
import { AgentJobsService } from "../agents/agent-jobs.service.js";
import { ShopMembershipService } from "../auth/shop-membership.service.js";
import { ShopSettingsService } from "../shop-settings/shop-settings.service.js";

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface InventoryItemResponse {
  id: string;
  shopId: string;
  name: string;
  sku: string | null;
  paperSize: string | null;
  paperType: string | null;
  weightGsm: number | null;
  quantity: number;
  minQuantity: number;
  maxQuantity: number | null;
  location: string | null;
  unitCostMinor: number | null;
  active: boolean;
  /** §32: quantity has reached the configured minimum (never true with no minimum). */
  lowStock: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface InventoryAlertResponse {
  id: string;
  shopId: string;
  inventoryItemId: string;
  itemName: string;
  status: "OPEN" | "RESOLVED";
  quantityAtAlert: number;
  minQuantity: number;
  /** Current stock, so a dashboard need not fetch the item. */
  currentQuantity: number;
  createdAt: Date;
  resolvedAt: Date | null;
}

export interface InventorySummaryResponse {
  shopId: string;
  trackingEnabled: boolean;
  activeItems: number;
  /** Items at or below a configured minimum (live). */
  lowStockCount: number;
  /** Active items with zero stock. */
  outOfStockCount: number;
  openAlertCount: number;
  lowStockItems: InventoryItemResponse[];
}

export interface InventorySettingsResponse {
  shopId: string;
  trackingEnabled: boolean;
}

export interface InventoryMovementResponse {
  id: string;
  inventoryItemId: string;
  type: InventoryMovementType;
  quantityDelta: number;
  quantityAfter: number;
  reason: string | null;
  actorId: string | null;
  printJobId: string | null;
  createdAt: Date;
}

export function toItemResponse(item: InventoryItem): InventoryItemResponse {
  return {
    id: item.id,
    shopId: item.shopId,
    name: item.name,
    sku: item.sku,
    paperSize: item.paperSize,
    paperType: item.paperType,
    weightGsm: item.weightGsm,
    quantity: item.quantity,
    minQuantity: item.minQuantity,
    maxQuantity: item.maxQuantity,
    location: item.location,
    unitCostMinor: item.unitCostMinor,
    active: item.active,
    lowStock: isLowStock(item.quantity, item.minQuantity),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function toMovementResponse(movement: InventoryMovement): InventoryMovementResponse {
  return {
    id: movement.id,
    inventoryItemId: movement.inventoryItemId,
    type: movement.type,
    quantityDelta: movement.quantityDelta,
    quantityAfter: movement.quantityAfter,
    reason: movement.reason,
    actorId: movement.actorId,
    printJobId: movement.printJobId,
    createdAt: movement.createdAt,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** §26/§27/20.2. `shopId` arrives in the query/body for list/create (membership
 * checked here, like ProductsService); `:id` methods run behind ShopScopeGuard,
 * which has already proven the caller is active staff at the item's shop.
 * Stock changes ONLY through `applyStockMovement` (row lock + atomic relative
 * UPDATE) -- there is no code path here that writes `quantity` directly. */
@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shopMembership: ShopMembershipService,
    private readonly audit: AuditService,
    private readonly agentJobs: AgentJobsService,
    private readonly settings: ShopSettingsService,
  ) {}

  async listItems(
    requestingUserId: string,
    query: ListInventoryItemsQueryInput,
  ): Promise<Page<InventoryItemResponse>> {
    await this.assertMember(query.shopId, requestingUserId);

    const where: Prisma.InventoryItemWhereInput = { shopId: query.shopId };
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: "insensitive" } },
        { sku: { contains: query.search, mode: "insensitive" } },
      ];
    }
    if (query.paperSize) where.paperSize = query.paperSize;
    if (query.active !== undefined) where.active = query.active;
    if (query.lowStock !== undefined) {
      // Column-to-column comparison isn't expressible in Prisma's `where`.
      const low = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM inventory_items
        WHERE shop_id = ${query.shopId} AND min_quantity > 0 AND quantity <= min_quantity
      `;
      where.id = query.lowStock
        ? { in: low.map((row) => row.id) }
        : { notIn: low.map((row) => row.id) };
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.inventoryItem.count({ where }),
      this.prisma.inventoryItem.findMany({
        where,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: query.limit,
        skip: query.offset,
      }),
    ]);
    return {
      items: rows.map(toItemResponse),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async createItem(
    requestingUserId: string,
    input: CreateInventoryItemInput,
  ): Promise<InventoryItemResponse> {
    await this.assertMember(input.shopId, requestingUserId);

    let item: InventoryItem;
    try {
      item = await this.prisma.$transaction(async (tx) => {
        const created = await tx.inventoryItem.create({
          data: {
            shopId: input.shopId,
            name: input.name,
            sku: input.sku,
            paperSize: input.paperSize,
            paperType: input.paperType,
            weightGsm: input.weightGsm,
            minQuantity: input.minQuantity,
            maxQuantity: input.maxQuantity,
            location: input.location,
            unitCostMinor: input.unitCostMinor,
          },
        });
        if (input.initialQuantity) {
          await applyStockMovement(tx, {
            shopId: input.shopId,
            itemId: created.id,
            type: "ADJUSTMENT",
            quantityDelta: input.initialQuantity,
            reason: "Initial stock",
            actorId: requestingUserId,
          });
          return tx.inventoryItem.findUniqueOrThrow({ where: { id: created.id } });
        }
        return created;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw this.skuTaken();
      }
      throw error;
    }

    await this.audit.record({
      actorId: requestingUserId,
      action: AuditAction.INVENTORY_ITEM_CREATED,
      resourceType: "inventory_item",
      resourceId: item.id,
      metadata: { shopId: item.shopId, name: item.name, sku: item.sku },
    });
    return toItemResponse(item);
  }

  async getItem(itemId: string): Promise<InventoryItemResponse> {
    return toItemResponse(await this.requireItem(itemId));
  }

  async updateItem(
    itemId: string,
    input: UpdateInventoryItemInput,
    actorId: string,
  ): Promise<InventoryItemResponse> {
    const existing = await this.requireItem(itemId);
    const min = input.minQuantity ?? existing.minQuantity;
    const max = input.maxQuantity === undefined ? existing.maxQuantity : input.maxQuantity;
    if (max !== null && max < min) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        "INVENTORY_MAX_BELOW_MIN",
        "maxQuantity must be at least minQuantity.",
        false,
      );
    }

    let updated: InventoryItem;
    try {
      // `quantity` is not part of this update, by construction.
      updated = await this.prisma.inventoryItem.update({
        where: { id: itemId },
        data: {
          name: input.name,
          sku: input.sku,
          paperSize: input.paperSize,
          paperType: input.paperType,
          weightGsm: input.weightGsm,
          minQuantity: input.minQuantity,
          maxQuantity: input.maxQuantity,
          location: input.location,
          unitCostMinor: input.unitCostMinor,
          active: input.active,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw this.skuTaken();
      }
      throw error;
    }

    await this.audit.record({
      actorId,
      action: AuditAction.INVENTORY_ITEM_UPDATED,
      resourceType: "inventory_item",
      resourceId: itemId,
      metadata: { shopId: existing.shopId, changes: input },
    });
    return toItemResponse(updated);
  }

  async recordMovement(
    itemId: string,
    input: RecordInventoryMovementInput,
    actorId: string,
  ): Promise<{ movement: InventoryMovementResponse; item: InventoryItemResponse }> {
    const existing = await this.requireItem(itemId);
    const { movement, item } = await this.prisma.$transaction(async (tx) => {
      const applied = await applyStockMovement(tx, {
        shopId: existing.shopId,
        itemId,
        type: input.type,
        quantityDelta: input.quantityDelta,
        mode: "STRICT",
        reason: input.reason,
        actorId,
      });
      // STRICT with no idempotency key: always APPLIED (no shortfall, no duplicate).
      if (applied.outcome !== "APPLIED") {
        throw new AppException(
          HttpStatus.CONFLICT,
          "STOCK_MOVEMENT_NOT_APPLIED",
          "The movement was not applied.",
          false,
        );
      }
      return {
        movement: await tx.inventoryMovement.findUniqueOrThrow({
          where: { id: applied.movementId },
        }),
        item: await tx.inventoryItem.findUniqueOrThrow({ where: { id: itemId } }),
      };
    });
    if (movement.quantityDelta > 0) {
      // 20.3: stock went up; jobs parked NO_PAPER may now allocate (opt-in, post-commit).
      await this.agentJobs.recoverPaperBlockedJobs(existing.shopId);
    }
    return { movement: toMovementResponse(movement), item: toItemResponse(item) };
  }

  async listAlerts(
    userId: string,
    query: ListInventoryAlertsQueryInput,
  ): Promise<Page<InventoryAlertResponse>> {
    await this.assertMember(query.shopId, userId);
    const where = { shopId: query.shopId, status: query.status };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.inventoryAlert.count({ where }),
      this.prisma.inventoryAlert.findMany({
        where,
        include: { item: { select: { name: true, quantity: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.limit,
        skip: query.offset,
      }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        shopId: row.shopId,
        inventoryItemId: row.inventoryItemId,
        itemName: row.item.name,
        status: row.status,
        quantityAtAlert: row.quantityAtAlert,
        minQuantity: row.minQuantity,
        currentQuantity: row.item.quantity,
        createdAt: row.createdAt,
        resolvedAt: row.resolvedAt,
      })),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async summary(shopId: string, userId: string): Promise<InventorySummaryResponse> {
    await this.assertMember(shopId, userId);
    const [shop, activeItems, outOfStockCount, openAlertCount, low] = await Promise.all([
      this.prisma.shop.findUniqueOrThrow({
        where: { id: shopId },
        select: { inventoryTrackingEnabled: true },
      }),
      this.prisma.inventoryItem.count({ where: { shopId, active: true } }),
      this.prisma.inventoryItem.count({ where: { shopId, active: true, quantity: 0 } }),
      this.prisma.inventoryAlert.count({ where: { shopId, status: "OPEN" } }),
      this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM inventory_items
        WHERE shop_id = ${shopId} AND active AND min_quantity > 0 AND quantity <= min_quantity
        ORDER BY quantity ASC, name ASC, id ASC
      `,
    ]);
    const top = low.slice(0, 20).map((row) => row.id);
    const rows = await this.prisma.inventoryItem.findMany({ where: { id: { in: top } } });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return {
      shopId,
      trackingEnabled: shop.inventoryTrackingEnabled,
      activeItems,
      lowStockCount: low.length,
      outOfStockCount,
      openAlertCount,
      lowStockItems: top.map((id) => toItemResponse(byId.get(id)!)),
    };
  }

  async getSettings(shopId: string, userId: string): Promise<InventorySettingsResponse> {
    await this.assertMember(shopId, userId);
    const shop = await this.prisma.shop.findUniqueOrThrow({
      where: { id: shopId },
      select: { inventoryTrackingEnabled: true },
    });
    return { shopId, trackingEnabled: shop.inventoryTrackingEnabled };
  }

  /** 22.1: the legacy route is an alias over the one settings surface (same
   * column, version bumped, SHOP_SETTINGS_CHANGED audited). It keeps its own
   * MANAGE_INVENTORY gate, its INVENTORY_TRACKING_CHANGED audit row (written on
   * every call, as before) and the recovery hook. */
  async updateSettings(
    input: UpdateInventorySettingsInput,
    userId: string,
  ): Promise<InventorySettingsResponse> {
    await this.assertMember(input.shopId, userId);
    await this.settings.update(
      { shopId: input.shopId, inventoryTrackingEnabled: input.trackingEnabled },
      userId,
      { viaInventoryAlias: true },
    );
    await this.audit.record({
      actorId: userId,
      action: AuditAction.INVENTORY_TRACKING_CHANGED,
      resourceType: "shop",
      resourceId: input.shopId,
      metadata: { enabled: input.trackingEnabled },
    });
    if (!input.trackingEnabled) {
      // The gate is released: NO_PAPER jobs are no longer blocked by anything.
      await this.agentJobs.recoverPaperBlockedJobs(input.shopId);
    }
    return { shopId: input.shopId, trackingEnabled: input.trackingEnabled };
  }

  async listMovements(
    itemId: string,
    query: ListInventoryMovementsQueryInput,
  ): Promise<Page<InventoryMovementResponse>> {
    const where = { inventoryItemId: itemId };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.inventoryMovement.count({ where }),
      this.prisma.inventoryMovement.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.limit,
        skip: query.offset,
      }),
    ]);
    return {
      items: rows.map(toMovementResponse),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  private async requireItem(itemId: string): Promise<InventoryItem> {
    const item = await this.prisma.inventoryItem.findUnique({ where: { id: itemId } });
    if (!item) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        "INVENTORY_ITEM_NOT_FOUND",
        "Inventory item not found.",
        false,
      );
    }
    return item;
  }

  private skuTaken(): AppException {
    return new AppException(
      HttpStatus.CONFLICT,
      "INVENTORY_SKU_TAKEN",
      "Another inventory item in this shop already uses that SKU.",
      false,
    );
  }

  private async assertMember(shopId: string, userId: string): Promise<void> {
    if (!(await this.shopMembership.isActiveStaff(shopId, userId))) {
      throw new ForbiddenException("You do not have access to this shop's inventory.");
    }
  }
}
