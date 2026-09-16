import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { OrderStatus, Prisma } from "@prisma/client";
import { PrismaService } from "@print-automated/backend-shared";
import { ShopScopedRepository } from "../prisma/shop-scoped-repository.js";
import { ShopMembershipService } from "../auth/shop-membership.service.js";

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
