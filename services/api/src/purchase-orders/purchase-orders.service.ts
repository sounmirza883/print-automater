import { ForbiddenException, HttpStatus, Injectable } from "@nestjs/common";
import { Prisma, type PurchaseOrderStatus } from "@prisma/client";
import type {
  CreatePurchaseOrderInput,
  ListPurchaseOrdersQueryInput,
  ReceivePurchaseOrderInput,
  UpdatePurchaseOrderInput,
  UpdatePurchaseOrderPaymentInput,
} from "@print-automated/validation";
import {
  AppException,
  AuditService,
  PrismaService,
  applyStockMovement,
  redactMetadata,
} from "@print-automated/backend-shared";
import { AgentJobsService } from "../agents/agent-jobs.service.js";
import { AuditAction } from "../audit/audit-action.js";
import { ShopMembershipService } from "../auth/shop-membership.service.js";
import type { Page } from "../inventory/inventory.service.js";

const INT_MAX = 2_147_483_647;

const PO_INCLUDE = {
  supplier: { select: { name: true } },
  lines: {
    include: { item: { select: { name: true } } },
    orderBy: [{ inventoryItemId: "asc" }],
  },
} satisfies Prisma.PurchaseOrderInclude;

type PoRow = Prisma.PurchaseOrderGetPayload<{ include: typeof PO_INCLUDE }>;

export interface PurchaseOrderResponse {
  id: string;
  shopId: string;
  supplierId: string;
  supplierName: string;
  poNumber: string;
  status: PurchaseOrderStatus;
  paymentStatus: string;
  expectedDeliveryAt: Date | null;
  actualDeliveryAt: Date | null;
  totalCostMinor: number;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  lines: Array<{
    id: string;
    inventoryItemId: string;
    itemName: string;
    quantityOrdered: number;
    unitCostMinor: number;
    quantityReceived: number | null;
  }>;
}

function toResponse(row: PoRow): PurchaseOrderResponse {
  return {
    id: row.id,
    shopId: row.shopId,
    supplierId: row.supplierId,
    supplierName: row.supplier.name,
    poNumber: row.poNumber,
    status: row.status,
    paymentStatus: row.paymentStatus,
    expectedDeliveryAt: row.expectedDeliveryAt,
    actualDeliveryAt: row.actualDeliveryAt,
    totalCostMinor: row.totalCostMinor,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lines: row.lines.map((line) => ({
      id: line.id,
      inventoryItemId: line.inventoryItemId,
      itemName: line.item.name,
      quantityOrdered: line.quantityOrdered,
      unitCostMinor: line.unitCostMinor,
      quantityReceived: line.quantityReceived,
    })),
  };
}

function invalidState(from: string, wanted: string): AppException {
  return new AppException(
    HttpStatus.CONFLICT,
    "PURCHASE_ORDER_INVALID_STATE",
    `A purchase order in ${from} cannot be ${wanted}.`,
    false,
  );
}

/** 31/20.7. Lifecycle DRAFT -> ORDERED -> RECEIVED, CANCELLED from DRAFT or
 * ORDERED. Every transition is one guarded statement or runs under the PO row
 * lock, so racing actors (two receives, receive vs cancel) serialise and exactly
 * one wins. */
@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shopMembership: ShopMembershipService,
    private readonly audit: AuditService,
    private readonly agentJobs: AgentJobsService,
  ) {}

  async list(
    userId: string,
    query: ListPurchaseOrdersQueryInput,
  ): Promise<Page<PurchaseOrderResponse>> {
    await this.assertMember(query.shopId, userId);
    const where: Prisma.PurchaseOrderWhereInput = { shopId: query.shopId };
    if (query.status) where.status = query.status;
    if (query.supplierId) where.supplierId = query.supplierId;
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.purchaseOrder.count({ where }),
      this.prisma.purchaseOrder.findMany({
        where,
        include: PO_INCLUDE,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.limit,
        skip: query.offset,
      }),
    ]);
    return { items: rows.map(toResponse), total, limit: query.limit, offset: query.offset };
  }

  async get(id: string): Promise<PurchaseOrderResponse> {
    return toResponse(await this.load(this.prisma, id));
  }

  async create(userId: string, input: CreatePurchaseOrderInput): Promise<PurchaseOrderResponse> {
    await this.assertMember(input.shopId, userId);

    const supplier = await this.prisma.supplier.findFirst({
      where: { id: input.supplierId, shopId: input.shopId },
      select: { id: true, status: true },
    });
    if (supplier && supplier.status !== "ACTIVE") {
      throw new AppException(
        HttpStatus.CONFLICT,
        "SUPPLIER_INACTIVE",
        "This supplier is inactive; reactivate it before ordering from it.",
        false,
      );
    }
    if (!supplier) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        "SUPPLIER_NOT_FOUND",
        "Supplier not found.",
        false,
      );
    }
    const itemIds = input.lines.map((line) => line.inventoryItemId);
    const items = await this.prisma.inventoryItem.findMany({
      where: { id: { in: itemIds }, shopId: input.shopId },
      select: { id: true, unitCostMinor: true, active: true },
    });
    if (items.length !== itemIds.length) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        "INVENTORY_ITEM_NOT_FOUND",
        "Inventory item not found.",
        false,
      );
    }
    if (items.some((item) => !item.active)) {
      throw new AppException(
        HttpStatus.CONFLICT,
        "INVENTORY_ITEM_INACTIVE",
        "An inventory item on this order is inactive.",
        false,
      );
    }
    const supplierPrices = await this.prisma.supplierProduct.findMany({
      where: { supplierId: input.supplierId, inventoryItemId: { in: itemIds } },
      select: { inventoryItemId: true, unitPriceMinor: true },
    });
    const itemById = new Map(items.map((item) => [item.id, item]));
    const priceByItem = new Map(supplierPrices.map((p) => [p.inventoryItemId, p.unitPriceMinor]));

    const lines = input.lines.map((line) => ({
      shopId: input.shopId,
      inventoryItemId: line.inventoryItemId,
      quantityOrdered: line.quantity,
      // explicit cost, else the supplier's price, else the item's unit cost, else 0
      unitCostMinor:
        line.unitCostMinor ??
        priceByItem.get(line.inventoryItemId) ??
        itemById.get(line.inventoryItemId)!.unitCostMinor ??
        0,
    }));
    const totalCostMinor = lines.reduce((sum, l) => sum + l.quantityOrdered * l.unitCostMinor, 0);
    if (totalCostMinor > INT_MAX) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        "PURCHASE_ORDER_TOTAL_TOO_LARGE",
        "The purchase order total is too large.",
        false,
      );
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.create({
        data: {
          shopId: input.shopId,
          supplierId: input.supplierId,
          expectedDeliveryAt: input.expectedDeliveryAt,
          notes: input.notes,
          totalCostMinor,
          createdBy: userId,
        },
      });
      await tx.purchaseOrderLine.createMany({
        data: lines.map((line) => ({ ...line, purchaseOrderId: po.id })),
      });
      return po;
    });

    await this.audit.record({
      actorId: userId,
      action: AuditAction.PURCHASE_ORDER_CREATED,
      resourceType: "purchase_order",
      resourceId: created.id,
      metadata: { shopId: input.shopId, supplierId: input.supplierId, totalCostMinor },
    });
    return this.get(created.id);
  }

  async update(
    id: string,
    input: UpdatePurchaseOrderInput,
    actorId: string,
  ): Promise<PurchaseOrderResponse> {
    const existing = await this.load(this.prisma, id);
    if (existing.status === "RECEIVED" || existing.status === "CANCELLED") {
      throw invalidState(existing.status, "edited");
    }
    await this.prisma.purchaseOrder.update({
      where: { id },
      data: { expectedDeliveryAt: input.expectedDeliveryAt, notes: input.notes },
    });
    await this.audit.record({
      actorId,
      action: AuditAction.PURCHASE_ORDER_UPDATED,
      resourceType: "purchase_order",
      resourceId: id,
      metadata: { shopId: existing.shopId, changes: input },
    });
    return this.get(id);
  }

  async updatePayment(
    id: string,
    input: UpdatePurchaseOrderPaymentInput,
    actorId: string,
  ): Promise<PurchaseOrderResponse> {
    const existing = await this.load(this.prisma, id);
    if (existing.status === "CANCELLED") {
      throw invalidState(existing.status, "marked with a payment status");
    }
    // Guarded write: a cancel that lands between the read and this update wins.
    const moved = await this.prisma.purchaseOrder.updateMany({
      where: { id, status: { not: "CANCELLED" } },
      data: { paymentStatus: input.paymentStatus },
    });
    if (moved.count === 0) {
      throw invalidState("CANCELLED", "marked with a payment status");
    }
    await this.audit.record({
      actorId,
      action: AuditAction.PURCHASE_ORDER_PAYMENT_CHANGED,
      resourceType: "purchase_order",
      resourceId: id,
      metadata: {
        shopId: existing.shopId,
        from: existing.paymentStatus,
        to: input.paymentStatus,
      },
    });
    return this.get(id);
  }

  /** DRAFT -> ORDERED as ONE guarded UPDATE: a concurrent cancel/receive either
   * ran first (this matches no row -> 409) or waits for this commit. */
  async place(id: string, actorId: string): Promise<PurchaseOrderResponse> {
    const moved = await this.prisma.purchaseOrder.updateMany({
      where: { id, status: "DRAFT" },
      data: { status: "ORDERED" },
    });
    return this.afterGuardedMove(
      id,
      moved.count,
      "ORDERED",
      actorId,
      AuditAction.PURCHASE_ORDER_ORDERED,
    );
  }

  async cancel(id: string, actorId: string): Promise<PurchaseOrderResponse> {
    const moved = await this.prisma.purchaseOrder.updateMany({
      where: { id, status: { in: ["DRAFT", "ORDERED"] } },
      data: { status: "CANCELLED" },
    });
    return this.afterGuardedMove(
      id,
      moved.count,
      "CANCELLED",
      actorId,
      AuditAction.PURCHASE_ORDER_CANCELLED,
    );
  }

  /** 20.7: receive goods. One transaction that
   *  1. locks the PO row (FOR UPDATE) -- two receives, or a receive racing a
   *     cancel, serialise here;
   *  2. an already-RECEIVED PO is an idempotent REPLAY (returns it; touches
   *     nothing), so a retried request after a dropped response or a
   *     double-click can never double-count; DRAFT/CANCELLED are 409;
   *  3. validates the request against this PO's own lines BEFORE any write;
   *  4. applies one PURCHASE movement per line through `applyStockMovement`, in
   *     ascending item id (the lock order the job machine's consumption also
   *     uses), each keyed `po-receipt:<lineId>` so the database itself refuses a
   *     second application even if the status guard were bypassed;
   *  5. records received quantities, the delivery date and the receiver, and an
   *     audit row.
   * Any failure rolls the whole receipt back (PO stays ORDERED, no stock
   * moved). After commit, and only when stock actually arrived, jobs parked
   * NO_PAPER get another chance (opt-in, never throws). */
  async receive(
    id: string,
    input: ReceivePurchaseOrderInput,
    actorId: string,
  ): Promise<PurchaseOrderResponse> {
    const { po, applied, shopId } = await this.prisma.$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw<
          Array<{ id: string; shopId: string; status: PurchaseOrderStatus; poNumber: string }>
        >`
          SELECT id, shop_id AS "shopId", status, po_number AS "poNumber"
          FROM purchase_orders WHERE id = ${id} FOR UPDATE
        `;
        const current = locked[0];
        if (!current) {
          throw new AppException(
            HttpStatus.NOT_FOUND,
            "PURCHASE_ORDER_NOT_FOUND",
            "Purchase order not found.",
            false,
          );
        }
        if (current.status === "RECEIVED") {
          return { po: await this.load(tx, id), applied: false, shopId: current.shopId };
        }
        if (current.status !== "ORDERED") {
          throw invalidState(current.status, "received");
        }

        const lines = await tx.purchaseOrderLine.findMany({
          where: { purchaseOrderId: id },
          orderBy: { inventoryItemId: "asc" },
        });
        const lineIds = new Set(lines.map((line) => line.id));
        const overrides = new Map<string, number>();
        for (const entry of input.lines ?? []) {
          if (!lineIds.has(entry.lineId)) {
            throw new AppException(
              HttpStatus.BAD_REQUEST,
              "PURCHASE_ORDER_LINE_NOT_FOUND",
              "A received line does not belong to this purchase order.",
              false,
            );
          }
          overrides.set(entry.lineId, entry.quantityReceived);
        }

        let totalReceived = 0;
        for (const line of lines) {
          const received = overrides.get(line.id) ?? line.quantityOrdered;
          if (received > 0) {
            await applyStockMovement(tx, {
              shopId: current.shopId,
              itemId: line.inventoryItemId,
              type: "PURCHASE",
              quantityDelta: received,
              actorId,
              reason: `Received ${current.poNumber}`,
              idempotencyKey: `po-receipt:${line.id}`,
              auditMetadata: { purchaseOrderId: id, poNumber: current.poNumber, lineId: line.id },
            });
          }
          totalReceived += received;
          await tx.purchaseOrderLine.update({
            where: { id: line.id },
            data: { quantityReceived: received },
          });
        }

        await tx.purchaseOrder.update({
          where: { id },
          data: {
            status: "RECEIVED",
            actualDeliveryAt: input.actualDeliveryAt ?? new Date(),
            receivedBy: actorId,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId,
            action: AuditAction.PURCHASE_ORDER_RECEIVED,
            resourceType: "purchase_order",
            resourceId: id,
            metadata: redactMetadata({
              shopId: current.shopId,
              poNumber: current.poNumber,
              totalReceived,
            }) as Prisma.InputJsonValue,
          },
        });
        return { po: await this.load(tx, id), applied: totalReceived > 0, shopId: current.shopId };
      },
      { maxWait: 20_000, timeout: 30_000 },
    );

    if (applied) {
      await this.agentJobs.recoverPaperBlockedJobs(shopId);
    }
    return toResponse(po);
  }

  private async afterGuardedMove(
    id: string,
    movedCount: number,
    target: PurchaseOrderStatus,
    actorId: string,
    action: string,
  ): Promise<PurchaseOrderResponse> {
    const row = await this.load(this.prisma, id);
    if (movedCount === 0) {
      throw invalidState(row.status, target === "ORDERED" ? "placed" : "cancelled");
    }
    await this.audit.record({
      actorId,
      action,
      resourceType: "purchase_order",
      resourceId: id,
      metadata: { shopId: row.shopId, poNumber: row.poNumber },
    });
    return toResponse(row);
  }

  private async load(
    db: Pick<Prisma.TransactionClient, "purchaseOrder">,
    id: string,
  ): Promise<PoRow> {
    const row = await db.purchaseOrder.findUnique({ where: { id }, include: PO_INCLUDE });
    if (!row) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        "PURCHASE_ORDER_NOT_FOUND",
        "Purchase order not found.",
        false,
      );
    }
    return row;
  }

  private async assertMember(shopId: string, userId: string): Promise<void> {
    if (!(await this.shopMembership.isActiveStaff(shopId, userId))) {
      throw new ForbiddenException("You do not have access to this shop's purchase orders.");
    }
  }
}
