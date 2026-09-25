import { HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { DeliveryStatus, OrderStatus, Prisma, type OrderDelivery } from "@prisma/client";
import type { DeliveryStatusInput, SaveDeliveryInput } from "@print-automated/validation";
import { AppException, PrismaService } from "@print-automated/backend-shared";
import { AuditAction } from "../audit/audit-action.js";

export interface DeliveryResponse {
  id: string;
  orderId: string;
  status: DeliveryStatus;
  address: string;
  courier: string | null;
  trackingNumber: string | null;
  feeMinor: number;
  dispatchedAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toDeliveryResponse(row: OrderDelivery): DeliveryResponse {
  return {
    id: row.id,
    orderId: row.orderId,
    status: row.status,
    address: row.address,
    courier: row.courier,
    trackingNumber: row.trackingNumber,
    feeMinor: row.feeMinor,
    dispatchedAt: row.dispatchedAt,
    deliveredAt: row.deliveredAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Orders a delivery can attach to: from the moment the shop has the order until
 * it is completed. Anything that died before production (draft, unpaid, rejected,
 * cancelled, expired) never gets one. */
const DELIVERABLE_ORDER_STATUSES: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.WAITING_FOR_SHOP,
  OrderStatus.SHOP_ACCEPTED,
  OrderStatus.QUEUED_FOR_PRINT,
  OrderStatus.PRINTING,
  OrderStatus.PRINTED,
  OrderStatus.PRINT_FAILED,
  OrderStatus.PRINT_STATUS_UNKNOWN,
  OrderStatus.PREPARING,
  OrderStatus.ASSIGNED,
  OrderStatus.PAUSED,
  OrderStatus.QUALITY_CHECK,
  OrderStatus.READY_FOR_COLLECTION,
  OrderStatus.COMPLETED,
]);

/** Handing the parcel over needs a finished order. */
const DISPATCHABLE_ORDER_STATUSES: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.READY_FOR_COLLECTION,
  OrderStatus.COMPLETED,
]);

const DELIVERY_TRANSITIONS: Record<DeliveryStatus, readonly DeliveryStatus[]> = {
  PENDING: ["OUT_FOR_DELIVERY", "CANCELLED"],
  OUT_FOR_DELIVERY: ["DELIVERED", "FAILED"],
  FAILED: ["OUT_FOR_DELIVERY", "CANCELLED"],
  DELIVERED: [],
  CANCELLED: [],
};

/** 21.5 (PRD 71). The optional delivery workflow. It never touches
 * orders.order_status (the order machine's) or the order's price: the fee is a
 * recorded figure. Every write is audited WITHOUT the address (personal data).
 * Concurrency: the order row is read FOR SHARE (so the order cannot be cancelled
 * mid-write) and the delivery row FOR UPDATE, so two status changes serialise and
 * the loser is refused by the transition table, never overwriting the winner. */
@Injectable()
export class DeliveriesService {
  constructor(private readonly prisma: PrismaService) {}

  async get(orderId: string): Promise<DeliveryResponse> {
    const row = await this.prisma.orderDelivery.findUnique({ where: { orderId } });
    if (!row) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        "DELIVERY_NOT_FOUND",
        "This order has no delivery.",
        false,
      );
    }
    return toDeliveryResponse(row);
  }

  async save(
    orderId: string,
    actorId: string,
    input: SaveDeliveryInput,
  ): Promise<DeliveryResponse> {
    // Two concurrent first saves race on UNIQUE(order_id): the loser's transaction
    // aborts with P2002, and one retry then takes the update path.
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.saveOnce(orderId, actorId, input);
      } catch (error) {
        const raced =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
        if (!raced || attempt >= 2) {
          throw error;
        }
      }
    }
  }

  private async saveOnce(
    orderId: string,
    actorId: string,
    input: SaveDeliveryInput,
  ): Promise<DeliveryResponse> {
    return this.prisma.$transaction(
      async (tx) => {
        const order = await this.lockOrder(tx, orderId);
        if (!DELIVERABLE_ORDER_STATUSES.has(order.status)) {
          throw new AppException(
            HttpStatus.CONFLICT,
            "DELIVERY_NOT_ALLOWED",
            `An order in ${order.status} cannot have a delivery.`,
            false,
          );
        }
        const existing = await tx.$queryRaw<Array<{ id: string; status: DeliveryStatus }>>`
          SELECT id, status FROM order_deliveries WHERE order_id = ${orderId} FOR UPDATE
        `;
        const changed = Object.keys(input).filter(
          (key) => input[key as keyof SaveDeliveryInput] !== undefined,
        );
        if (existing[0]) {
          if (
            existing[0].status === DeliveryStatus.DELIVERED ||
            existing[0].status === DeliveryStatus.CANCELLED
          ) {
            throw new AppException(
              HttpStatus.CONFLICT,
              "DELIVERY_CLOSED",
              `This delivery is ${existing[0].status} and can no longer be edited.`,
              false,
            );
          }
          const row = await tx.orderDelivery.update({
            where: { id: existing[0].id },
            data: {
              address: input.address,
              ...(input.courier !== undefined ? { courier: input.courier } : {}),
              ...(input.trackingNumber !== undefined
                ? { trackingNumber: input.trackingNumber }
                : {}),
              ...(input.feeMinor !== undefined ? { feeMinor: input.feeMinor } : {}),
            },
          });
          await this.audit(tx, actorId, row, AuditAction.DELIVERY_DETAILS_SAVED, {
            created: false,
            changedFields: changed,
          });
          return toDeliveryResponse(row);
        }
        const row = await tx.orderDelivery.create({
          data: {
            orderId,
            shopId: order.shopId,
            address: input.address,
            courier: input.courier ?? null,
            trackingNumber: input.trackingNumber ?? null,
            feeMinor: input.feeMinor ?? 0,
          },
        });
        await this.audit(tx, actorId, row, AuditAction.DELIVERY_DETAILS_SAVED, {
          created: true,
          changedFields: changed,
        });
        return toDeliveryResponse(row);
      },
      { maxWait: 10_000, timeout: 10_000 },
    );
  }

  async setStatus(
    orderId: string,
    actorId: string,
    input: DeliveryStatusInput,
  ): Promise<DeliveryResponse> {
    return this.prisma.$transaction(
      async (tx) => {
        const order = await this.lockOrder(tx, orderId);
        const rows = await tx.$queryRaw<
          Array<{ id: string; status: DeliveryStatus; courier: string | null }>
        >`
          SELECT id, status, courier FROM order_deliveries WHERE order_id = ${orderId} FOR UPDATE
        `;
        const current = rows[0];
        if (!current) {
          throw new AppException(
            HttpStatus.NOT_FOUND,
            "DELIVERY_NOT_FOUND",
            "This order has no delivery.",
            false,
          );
        }
        const target = input.status as DeliveryStatus;
        if (!DELIVERY_TRANSITIONS[current.status].includes(target)) {
          throw new AppException(
            HttpStatus.CONFLICT,
            "DELIVERY_STATUS_INVALID",
            `A delivery in ${current.status} cannot move to ${target}.`,
            false,
          );
        }
        const courier = input.courier !== undefined ? input.courier : current.courier;
        if (target === DeliveryStatus.OUT_FOR_DELIVERY) {
          if (!DISPATCHABLE_ORDER_STATUSES.has(order.status)) {
            throw new AppException(
              HttpStatus.CONFLICT,
              "DELIVERY_ORDER_NOT_READY",
              `An order in ${order.status} is not ready to hand to a courier.`,
              false,
            );
          }
          if (!courier) {
            throw new AppException(
              HttpStatus.CONFLICT,
              "DELIVERY_COURIER_REQUIRED",
              "Name the courier before sending the delivery out.",
              false,
            );
          }
        }
        const now = new Date();
        const row = await tx.orderDelivery.update({
          where: { id: current.id },
          data: {
            status: target,
            ...(input.courier !== undefined ? { courier: input.courier } : {}),
            ...(input.trackingNumber !== undefined ? { trackingNumber: input.trackingNumber } : {}),
            ...(target === DeliveryStatus.OUT_FOR_DELIVERY ? { dispatchedAt: now } : {}),
            ...(target === DeliveryStatus.DELIVERED ? { deliveredAt: now } : {}),
          },
        });
        await this.audit(tx, actorId, row, AuditAction.DELIVERY_STATUS_CHANGED, {
          from: current.status,
          to: target,
        });
        return toDeliveryResponse(row);
      },
      { maxWait: 10_000, timeout: 10_000 },
    );
  }

  private async lockOrder(
    tx: Prisma.TransactionClient,
    orderId: string,
  ): Promise<{ status: OrderStatus; shopId: string }> {
    const rows = await tx.$queryRaw<Array<{ status: OrderStatus; shopId: string }>>`
      SELECT order_status AS status, shop_id AS "shopId" FROM orders WHERE id = ${orderId} FOR SHARE
    `;
    if (!rows[0]) {
      throw new NotFoundException("Order not found.");
    }
    return rows[0];
  }

  /** Audit row for one write. Metadata never carries the address. */
  private async audit(
    tx: Prisma.TransactionClient,
    actorId: string,
    row: OrderDelivery,
    action: string,
    extra: Record<string, unknown>,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorId,
        action,
        resourceType: "order_delivery",
        resourceId: row.id,
        metadata: {
          orderId: row.orderId,
          courier: row.courier,
          trackingNumber: row.trackingNumber,
          feeMinor: row.feeMinor,
          ...extra,
        } as Prisma.InputJsonValue,
      },
    });
  }
}
