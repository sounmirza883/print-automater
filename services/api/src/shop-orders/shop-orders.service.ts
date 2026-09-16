import { randomUUID } from "node:crypto";
import { ForbiddenException, HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { OrderStatus, Prisma, PrinterStatus } from "@prisma/client";
import type { ShopRejectionReason } from "@print-automated/types";
import {
  AppException,
  OrderEvent,
  OrderStateMachine,
  PrismaService,
} from "@print-automated/backend-shared";
import { ShopScopedRepository } from "../prisma/shop-scoped-repository.js";
import { ShopMembershipService } from "../auth/shop-membership.service.js";
import { AgentJobsService } from "../agents/agent-jobs.service.js";

const SHOP_ORDER_INCLUDE = {
  customer: { select: { name: true } },
  document: { select: { filename: true } },
} satisfies Prisma.OrderInclude;

type ShopOrderWithRelations = Prisma.OrderGetPayload<{ include: typeof SHOP_ORDER_INCLUDE }>;

export interface ShopOrderResponse {
  id: string;
  publicOrderNumber: string;
  customerName: string;
  documentFilename: string;
  printConfiguration: unknown;
  pricingSnapshot: unknown;
  paymentStatus: string;
  orderStatus: string;
  createdAt: Date;
}

export interface ShopOrdersGrouped {
  needsAttention: ShopOrderResponse[];
  printing: ShopOrderResponse[];
  ready: ShopOrderResponse[];
  completed: ShopOrderResponse[];
  failed: ShopOrderResponse[];
}

/** §32's five groups. An order sits in the shop's queue at all only
 * once it's reached WAITING_FOR_SHOP -- DRAFT/UPLOADED/PAYMENT_PENDING/
 * PAID/PAYMENT_FAILED/EXPIRED are customer- and payment-side-only
 * concerns the shop has no reason to see (PAID itself is transient
 * besides -- 6.6 routes it on to WAITING_FOR_SHOP in the same call, so
 * no order actually rests there). CANCELLED is grouped with the other
 * terminal-without-success outcomes ("failed") since §79 permits
 * cancelling from WAITING_FOR_SHOP -- a shop can briefly see an order
 * as "needs attention" and then have it cancelled out from under it. */
const GROUP_BY_STATUS: Partial<Record<OrderStatus, keyof ShopOrdersGrouped>> = {
  [OrderStatus.WAITING_FOR_SHOP]: "needsAttention",
  [OrderStatus.PRINT_STATUS_UNKNOWN]: "needsAttention",
  [OrderStatus.SHOP_ACCEPTED]: "printing",
  [OrderStatus.QUEUED_FOR_PRINT]: "printing",
  [OrderStatus.PRINTING]: "printing",
  [OrderStatus.PRINTED]: "ready",
  [OrderStatus.READY_FOR_COLLECTION]: "ready",
  [OrderStatus.COMPLETED]: "completed",
  [OrderStatus.PRINT_FAILED]: "failed",
  [OrderStatus.SHOP_REJECTED]: "failed",
  [OrderStatus.CANCELLED]: "failed",
};

const SHOP_VISIBLE_STATUSES = Object.keys(GROUP_BY_STATUS) as OrderStatus[];

@Injectable()
export class ShopOrdersService {
  private readonly repository: ReturnType<typeof ShopOrdersService.buildRepository>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly shopMembership: ShopMembershipService,
    private readonly orderStateMachine: OrderStateMachine,
    private readonly agentJobsService: AgentJobsService,
  ) {
    this.repository = ShopOrdersService.buildRepository(prisma);
  }

  // §82: this module's own delegate, wrapping prisma.order the way
  // every shop-scoped feature module is meant to -- the include/
  // orderBy baked in here are this module's fixed shape, not something
  // ShopScopedRepository itself needs to know about. A `static` method
  // (rather than building this object inline in the constructor) is
  // what lets TWhere/TResult be *inferred* from the delegate object
  // literal, the same way the working shop-scoped-repository.spec.ts
  // usage infers them from `prisma.shopStaff` directly -- explicitly
  // writing `new ShopScopedRepository<Prisma.OrderWhereInput, ...>(...)`
  // fails to typecheck, because Prisma's own `OrderWhereInput.shopId`
  // is `string | StringFilter | undefined`, not assignable to the
  // repository's `{ shopId?: string }` constraint when checked against
  // an explicitly-named type; inference from the literal's own return
  // type never hits that check.
  private static buildRepository(prisma: PrismaService) {
    return new ShopScopedRepository({
      findMany: (args: { where: Prisma.OrderWhereInput }) =>
        prisma.order.findMany({
          where: args.where,
          include: SHOP_ORDER_INCLUDE,
          orderBy: { createdAt: "desc" },
        }),
      findFirst: (args: { where: Prisma.OrderWhereInput }) =>
        prisma.order.findFirst({ where: args.where, include: SHOP_ORDER_INCLUDE }),
    });
  }

  /** §82: no route param to resolve a shop id from here (this is a
   * list, not one resource), so the membership check that ShopScopeGuard
   * would otherwise run is done directly against the caller-supplied
   * `shopId` before the scoped query ever runs. Mirrors ShopScopeGuard's
   * own choice of 403 (never 404) for both "not a member" and "this
   * shop doesn't exist at all" -- distinguishing the two would leak
   * which shop ids are real to a caller with no business knowing. */
  async listGrouped(requestingUserId: string, shopId: string): Promise<ShopOrdersGrouped> {
    const isMember = await this.shopMembership.isActiveStaff(shopId, requestingUserId);
    if (!isMember) {
      throw new ForbiddenException("You do not have access to this shop's orders.");
    }

    const orders = await this.repository.findMany(shopId, {
      orderStatus: { in: SHOP_VISIBLE_STATUSES },
    });

    const grouped: ShopOrdersGrouped = {
      needsAttention: [],
      printing: [],
      ready: [],
      completed: [],
      failed: [],
    };
    for (const order of orders) {
      const group = GROUP_BY_STATUS[order.orderStatus];
      if (group) {
        grouped[group].push(this.toResponse(order));
      }
    }
    return grouped;
  }

  /** §34. ShopScopeGuard (via OrderShopResolver, at the route level)
   * has already confirmed the caller is active staff at this exact
   * order's shop by the time this runs. */
  async getOrder(orderId: string): Promise<ShopOrderResponse> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: SHOP_ORDER_INCLUDE,
    });
    if (!order) {
      throw new NotFoundException("Order not found.");
    }
    return this.toResponse(order);
  }

  /** §36/8.3: one user-facing action, two internal transitions --
   * SHOP_ACCEPT (WAITING_FOR_SHOP -> SHOP_ACCEPTED, with the print_job
   * row created in the *same* transaction) then QUEUE_PRINT
   * (SHOP_ACCEPTED -> QUEUED_FOR_PRINT), the same "chain them in one
   * call" shape 6.6 already established for a confirmed payment
   * routing straight on to WAITING_FOR_SHOP. A genuine double-tap finds
   * the order already past WAITING_FOR_SHOP on its second attempt --
   * ILLEGAL_ORDER_TRANSITION is caught and treated as "already
   * accepted," not an error, mirroring 6.4's own checkout-race
   * handling -- so "exactly one print job" falls out of the order's
   * own row lock, the same guarantee that already protects the audit
   * row and notification, not a client-supplied idempotency key. */
  async acceptOrder(orderId: string, actorId: string): Promise<ShopOrderResponse> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { shopId: true },
    });
    if (!order) {
      throw new NotFoundException("Order not found.");
    }

    // Set inside the transaction's sideEffect (the only place the
    // winning printer -- and its agent, if any -- is known) but only
    // acted on after that transaction actually commits: Redis isn't
    // part of the Postgres transaction, so notifying from inside the
    // callback could announce a job that a later rollback undoes.
    let notifyDeviceId: string | null = null;

    try {
      await this.orderStateMachine.transition(
        orderId,
        OrderEvent.SHOP_ACCEPT,
        { id: actorId },
        {
          sideEffect: async (tx) => {
            const printer = await tx.printer.findFirst({
              where: { shopId: order.shopId, status: { not: PrinterStatus.DISABLED } },
              include: { agent: { select: { deviceId: true } } },
            });
            if (!printer) {
              throw new AppException(
                HttpStatus.CONFLICT,
                "NO_PRINTER_AVAILABLE",
                "No printer is available to accept this order.",
                true,
              );
            }
            await tx.printJob.create({
              data: {
                orderId,
                printerId: printer.id,
                shopId: order.shopId,
                idempotencyToken: randomUUID(),
              },
            });
            // A printer staff registered by hand (8.4) before any
            // agent ever heartbeated it has no agent yet -- nothing to
            // wake. The job still sits QUEUED for whenever an agent
            // does start reporting it.
            notifyDeviceId = printer.agent?.deviceId ?? null;
          },
        },
      );
    } catch (error) {
      if (!(error instanceof AppException && error.errorCode === "ILLEGAL_ORDER_TRANSITION")) {
        throw error;
      }
    }

    if (notifyDeviceId) {
      await this.agentJobsService.notify(notifyDeviceId);
    }

    await this.queuePrintIfStillAccepted(orderId, actorId);
    return this.getOrder(orderId);
  }

  private async queuePrintIfStillAccepted(orderId: string, actorId: string): Promise<void> {
    try {
      await this.orderStateMachine.transition(orderId, OrderEvent.QUEUE_PRINT, { id: actorId });
    } catch (error) {
      if (error instanceof AppException && error.errorCode === "ILLEGAL_ORDER_TRANSITION") {
        return;
      }
      throw error;
    }
  }

  /** §36: rejection requires a reason (the picker's four fixed options,
   * validated by the Zod schema before this ever runs) -- kept only in
   * the transition's own audit metadata, not a dedicated order column,
   * since nothing yet needs it queryable and SHOP_REJECTED isn't one
   * of 7.3's seven customer-notification events. */
  async rejectOrder(
    orderId: string,
    actorId: string,
    reason: ShopRejectionReason,
  ): Promise<ShopOrderResponse> {
    await this.orderStateMachine.transition(
      orderId,
      OrderEvent.SHOP_REJECT,
      { id: actorId },
      { metadata: { reason } },
    );
    return this.getOrder(orderId);
  }

  async markReady(orderId: string, actorId: string): Promise<ShopOrderResponse> {
    await this.orderStateMachine.transition(orderId, OrderEvent.MARK_READY, { id: actorId });
    return this.getOrder(orderId);
  }

  async completeOrder(orderId: string, actorId: string): Promise<ShopOrderResponse> {
    await this.orderStateMachine.transition(orderId, OrderEvent.COMPLETE, { id: actorId });
    return this.getOrder(orderId);
  }

  private toResponse(order: ShopOrderWithRelations): ShopOrderResponse {
    return {
      id: order.id,
      publicOrderNumber: order.publicOrderNumber,
      customerName: order.customer.name,
      documentFilename: order.document.filename,
      printConfiguration: order.printConfiguration,
      pricingSnapshot: order.pricingSnapshot,
      paymentStatus: order.paymentStatus,
      orderStatus: order.orderStatus,
      createdAt: order.createdAt,
    };
  }
}
