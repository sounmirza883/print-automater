import {
  ForbiddenException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  DocumentStatus,
  OrderCreationSource,
  OrderItemType,
  OrderStatus,
  PaymentStatus,
  Prisma,
  PrintJobStatus,
} from "@prisma/client";
import type { PrintConfiguration, ShopRejectionReason } from "@print-automated/types";
import type {
  CreateCounterOrderInput,
  ResolveUnknownPrintInput,
} from "@print-automated/validation";
import {
  allocatePrinter,
  AppException,
  buildPrinterCandidates,
  explodeOrderItems,
  jobPages,
  OrderEvent,
  OrderStateMachine,
  PrintJobEvent,
  PrintJobStateMachine,
  PrismaService,
  type AllocationResult,
  type SendEmailJob,
} from "@print-automated/backend-shared";
import { ShopScopedRepository } from "../prisma/shop-scoped-repository.js";
import { ShopMembershipService } from "../auth/shop-membership.service.js";
import { AgentJobsService } from "../agents/agent-jobs.service.js";
import { OrdersService, type OrderResponse } from "../orders/orders.service.js";
import { ManualPaymentService } from "../payments/manual-payment.service.js";
import { RefundService } from "../payments/refund.service.js";

const SHOP_ORDER_INCLUDE = {
  customer: { select: { name: true } },
  // 17.5: for a COUNTER order, `customer` is the STAFF member who
  // placed it (Order.customerId's own schema comment) -- the shop's
  // own order list should show the actual walk-in customer's name
  // when one exists, not the staff member's. toResponse() below
  // prefers `customerRecord.name` over `customer.name` whenever it's
  // present; every pre-17.5 (self-service) order has no
  // customerRecord at all, so its own `customer.name` is unaffected.
  customerRecord: { select: { name: true } },
  document: { select: { filename: true } },
  // §37's own printing screen needs a printer name to show. 18.5:
  // `supersededAt: null` (not `take: 1, orderBy: createdAt desc`) is
  // what "the current job(s)" means once an order can hold more than
  // one live job at a time (multiItemEnabled) -- every job a retry/
  // reassignment superseded is explicitly excluded here, rather than
  // relying on it happening to be older than the replacement. For
  // every pre-18.5 single-job order these two filters pick out the
  // exact same one row (there is only ever one non-superseded job),
  // which is what proves this change is behaviour-preserving.
  printJobs: {
    where: { supersededAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      blockedReason: true,
      printer: { select: { name: true } },
    },
  },
} satisfies Prisma.OrderInclude;

type ShopOrderWithRelations = Prisma.OrderGetPayload<{ include: typeof SHOP_ORDER_INCLUDE }>;

// 18.6's own Done-when: a blocked job's reason must be "visible via the
// shop-orders API response," not just a database column nothing ever
// surfaces.
export interface ShopOrderJobSummary {
  id: string;
  status: string;
  printerName: string | null;
  blockedReason: string | null;
}

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
  // §37: null until a print_job exists (i.e. before SHOP_ACCEPT) --
  // the printing screen has nothing to show a printer name for yet at
  // that point anyway. For a multi-item order this is the most
  // recently created job's own printer -- a per-job breakdown lives in
  // `printJobs` below.
  printerName: string | null;
  printJobs: ShopOrderJobSummary[];
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
/** 18.14: TOTAL over OrderStatus, so adding a status is a compile error
 * until someone decides whether the shop sees it. "hidden" = customer-/
 * payment-side-only. The four 18.2 statuses are all visible: PREPARING
 * and ASSIGNED are in-production ("printing"); PAUSED and QUALITY_CHECK
 * each need a human to act, so they are "needsAttention". (Previously
 * they were absent, which excluded them from the DB query and made such
 * orders vanish from the shop's list.) */
export const GROUP_BY_STATUS: Record<OrderStatus, keyof ShopOrdersGrouped | "hidden"> = {
  [OrderStatus.DRAFT]: "hidden",
  [OrderStatus.UPLOADED]: "hidden",
  [OrderStatus.PAYMENT_PENDING]: "hidden",
  [OrderStatus.PAID]: "hidden",
  [OrderStatus.PAYMENT_FAILED]: "hidden",
  [OrderStatus.EXPIRED]: "hidden",
  [OrderStatus.WAITING_FOR_SHOP]: "needsAttention",
  [OrderStatus.PRINT_STATUS_UNKNOWN]: "needsAttention",
  [OrderStatus.PAUSED]: "needsAttention",
  [OrderStatus.QUALITY_CHECK]: "needsAttention",
  [OrderStatus.SHOP_ACCEPTED]: "printing",
  [OrderStatus.QUEUED_FOR_PRINT]: "printing",
  [OrderStatus.PREPARING]: "printing",
  [OrderStatus.ASSIGNED]: "printing",
  [OrderStatus.PRINTING]: "printing",
  [OrderStatus.PRINTED]: "ready",
  [OrderStatus.READY_FOR_COLLECTION]: "ready",
  [OrderStatus.COMPLETED]: "completed",
  [OrderStatus.PRINT_FAILED]: "failed",
  [OrderStatus.SHOP_REJECTED]: "failed",
  [OrderStatus.CANCELLED]: "failed",
};

export const SHOP_VISIBLE_STATUSES = (Object.keys(GROUP_BY_STATUS) as OrderStatus[]).filter(
  (status) => GROUP_BY_STATUS[status] !== "hidden",
);

/** 18.17: the job statuses a PRINT_FAILED order's retry/change-printer
 * acts on -- FAILED and TIMEOUT are the two that derive PRINT_FAILED. */
const RETRYABLE_FAILURES: PrintJobStatus[] = [PrintJobStatus.FAILED, PrintJobStatus.TIMEOUT];

@Injectable()
export class ShopOrdersService {
  private readonly logger = new Logger(ShopOrdersService.name);
  private readonly repository: ReturnType<typeof ShopOrdersService.buildRepository>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly shopMembership: ShopMembershipService,
    private readonly orderStateMachine: OrderStateMachine,
    private readonly jobStateMachine: PrintJobStateMachine,
    private readonly agentJobsService: AgentJobsService,
    private readonly refundService: RefundService,
    private readonly ordersService: OrdersService,
    private readonly manualPaymentService: ManualPaymentService,
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
      if (group && group !== "hidden") {
        grouped[group].push(this.toResponse(order));
      }
    }
    return grouped;
  }

  /** §4.2/§11/17.5: `POST /shop/orders` -- staff placing an order at
   * the counter on a walk-in customer's behalf. A thin wrapper over
   * OrdersService.createOrder(), the exact same quote/pricing/state-
   * machine machinery the customer-web path uses -- NOT a parallel
   * implementation. `shopId` arrives in the body (no single route
   * param to resolve it from), so membership is checked directly here,
   * the same pattern listGrouped() above already establishes.
   *
   * `requestingUserId` passed down to OrdersService is the STAFF
   * member's own id, not a synthetic customer -- see Order.customerId's
   * own schema comment for the full reasoning (17.5's judgment call).
   * `customerRecordId` must belong to THIS shop -- checked with the
   * same 403-for-both-"missing"-and-"wrong shop" convention
   * ShopScopeGuard itself already uses, so a counter order can never be
   * filed against another shop's walk-in customer. */
  async createCounterOrder(
    staffUserId: string,
    input: CreateCounterOrderInput,
  ): Promise<OrderResponse> {
    const isMember = await this.shopMembership.isActiveStaff(input.shopId, staffUserId);
    if (!isMember) {
      throw new ForbiddenException("You do not have access to this shop's orders.");
    }

    const customerRecord = await this.prisma.customer.findUnique({
      where: { id: input.customerRecordId },
      select: { shopId: true },
    });
    if (!customerRecord || customerRecord.shopId !== input.shopId) {
      throw new ForbiddenException("That customer record does not belong to this shop.");
    }

    return this.ordersService.createOrder(
      staffUserId,
      {
        shopId: input.shopId,
        documentId: input.documentId,
        printConfiguration: input.printConfiguration,
      },
      { customerRecordId: input.customerRecordId, creationSource: OrderCreationSource.COUNTER },
    );
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

  /** §36/8.3/§44/9.13: one user-facing action, two internal transitions
   * -- SHOP_ACCEPT (WAITING_FOR_SHOP -> SHOP_ACCEPTED, with the
   * print_job row created in the *same* transaction) then QUEUE_PRINT
   * (SHOP_ACCEPTED -> QUEUED_FOR_PRINT), the same "chain them in one
   * call" shape 6.6 already established for a confirmed payment
   * routing straight on to WAITING_FOR_SHOP. A genuine double-tap finds
   * the order already past WAITING_FOR_SHOP on its second attempt --
   * ILLEGAL_ORDER_TRANSITION is caught and treated as "already
   * accepted," not an error, mirroring 6.4's own checkout-race
   * handling -- so "exactly one print job" falls out of the order's
   * own row lock, the same guarantee that already protects the audit
   * row and notification, not a client-supplied idempotency key.
   *
   * §44's own gate -- all four conditions, re-checked here rather than
   * trusted from however the order reached this call -- is enforced
   * inside the sideEffect, reading fresh through `tx` rather than the
   * outer, pre-transaction `order` lookup: `order_status ==
   * SHOP_ACCEPTED` is already guaranteed by the transition itself
   * having just legally succeeded to reach this point, but
   * `payment_status == PAID` and the document being `READY` are both
   * independently mutable state (a refund, a document deletion) that
   * could have changed in the gap between an earlier read and this
   * transaction acquiring the order's row lock -- checking them fresh,
   * inside the same lock, is what makes "dispatch is refused" an
   * atomic guarantee instead of a race. */
  async acceptOrder(orderId: string, actorId: string): Promise<ShopOrderResponse> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { shopId: true },
    });
    if (!order) {
      throw new NotFoundException("Order not found.");
    }

    // Set inside the transaction's sideEffect (the only place the
    // winning printer(s) -- and their agents, if any -- are known) but
    // only acted on after that transaction actually commits: Redis
    // isn't part of the Postgres transaction, so notifying from inside
    // the callback could announce a job that a later rollback undoes.
    let notifyDeviceIds: string[] = [];

    try {
      await this.orderStateMachine.transition(
        orderId,
        OrderEvent.SHOP_ACCEPT,
        { id: actorId },
        {
          sideEffect: async (tx) => {
            notifyDeviceIds = (await this.dispatchToPrinter(tx, orderId)).notifyDeviceIds;
          },
        },
      );
    } catch (error) {
      if (!(error instanceof AppException && error.errorCode === "ILLEGAL_ORDER_TRANSITION")) {
        throw error;
      }
    }

    await this.notifyDevices(notifyDeviceIds);

    await this.queuePrintIfStillAccepted(orderId, actorId);
    return this.getOrder(orderId);
  }

  private async notifyDevices(deviceIds: string[]): Promise<void> {
    await Promise.all(deviceIds.map((deviceId) => this.agentJobsService.notify(deviceId)));
  }

  /** §44's own gate, re-checked fresh through `tx` rather than trusted
   * from however the caller got here -- shared by acceptOrder() and
   * 10.1's retryPrint()/10.4's changePrinter()/10.3's resolveUnknownPrint().
   *
   * 18.3/18.4/18.5: explodes the order's own OrderItem rows (creating
   * exactly one synthetic PRINT item first, matching the 15.4 backfill's
   * own shape, if none exist yet -- true for every order today, since
   * nothing before Phase 18 ever creates one at order-creation time)
   * and allocates each through `allocatePrinter()`. `idempotencyToken`
   * is `${orderItemId}:${attempt}` -- a real database uniqueness
   * guarantee (the column is still `@unique`) that one-dispatch-per-
   * item-per-attempt actually holds, not just a convention.
   *
   * `shop.multiItemEnabled` gates the two behaviours the plan requires
   * kept strictly apart: disabled (the default, and every shop until
   * 18.10 proves this safe) means a per-item allocation failure throws
   * the exact same NO_PRINTER_AVAILABLE/PRINTER_NOT_AVAILABLE/
   * PRINTER_CAPABILITY_MISMATCH AppException the old findAutoPrinter()/
   * findRequestedPrinter() threw, and creates no job row at all --
   * byte-for-byte the pre-18.5 behaviour. Enabled means a blocked item
   * instead becomes a real WAITING print_job with a blockedReason
   * (18.6) and dispatch simply continues to the next item, never
   * throwing on a partial allocation. */
  private async dispatchToPrinter(
    tx: Prisma.TransactionClient,
    orderId: string,
    requestedPrinterId?: string,
    onlyItemIds?: ReadonlySet<string>,
  ): Promise<{ notifyDeviceIds: string[] }> {
    const freshOrder = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        shopId: true,
        paymentStatus: true,
        documentId: true,
        printConfiguration: true,
        shop: { select: { multiItemEnabled: true } },
      },
    });

    if (freshOrder.paymentStatus !== PaymentStatus.PAID) {
      throw new AppException(
        HttpStatus.CONFLICT,
        "PAYMENT_NOT_CONFIRMED",
        "This order's payment has not been confirmed.",
        true,
      );
    }

    const document = await tx.document.findUniqueOrThrow({
      where: { id: freshOrder.documentId },
      select: { status: true },
    });
    if (document.status !== DocumentStatus.READY) {
      throw new AppException(
        HttpStatus.CONFLICT,
        "DOCUMENT_NOT_READY",
        "This order's document is not ready to print.",
        true,
      );
    }

    let items = await tx.orderItem.findMany({ where: { orderId }, orderBy: { sequence: "asc" } });
    if (items.length === 0) {
      const config = freshOrder.printConfiguration as unknown as PrintConfiguration;
      // 18.19: `order_items(order_id, sequence)` is unique. createMany with
      // skipDuplicates is INSERT .. ON CONFLICT DO NOTHING: a concurrent
      // first-dispatch that lost the race inserts nothing (a plain create
      // would abort the whole Postgres transaction on the violation), and
      // both then re-read the single winning row.
      await tx.orderItem.createMany({
        data: [
          {
            orderId,
            documentId: freshOrder.documentId,
            printConfiguration: freshOrder.printConfiguration as Prisma.InputJsonValue,
            quantity: config.copies ?? 1,
            itemType: OrderItemType.PRINT,
            required: true,
            sequence: 0,
          },
        ],
        skipDuplicates: true,
      });
      items = await tx.orderItem.findMany({ where: { orderId }, orderBy: { sequence: "asc" } });
    }

    // 18.17: a retry re-dispatches only the items it superseded a job for.
    if (onlyItemIds) {
      items = items.filter((item) => onlyItemIds.has(item.id));
    }

    const drafts = explodeOrderItems(
      items.map((item) => ({
        id: item.id,
        documentId: item.documentId,
        printConfiguration: item.printConfiguration as unknown as PrintConfiguration,
        required: item.required,
      })),
    );

    const { candidates, deviceIdsByPrinterId } = await buildPrinterCandidates(
      tx,
      freshOrder.shopId,
      new Date(),
    );
    const notifyDeviceIds = new Set<string>();
    const itemQuantity = new Map(items.map((item) => [item.id, item.quantity]));

    for (const draft of drafts) {
      const document = await tx.document.findUnique({
        where: { id: draft.documentId },
        select: { pageCount: true },
      });
      // One measure everywhere (jobPages): pages x copies, so maxJobPages,
      // the page allowance, queue load and accrual agree.
      const pageCount = document?.pageCount ?? 1;
      const pages = jobPages(pageCount, itemQuantity.get(draft.orderItemId));
      const attempt = await tx.printJob.count({ where: { orderItemId: draft.orderItemId } });
      const idempotencyToken = `${draft.orderItemId}:${attempt + 1}`;

      const allocation = allocatePrinter(
        {
          printConfiguration: draft.printConfiguration,
          pageCount: pages,
          allowUnknownCapabilities: requestedPrinterId !== undefined,
          requestedPrinterId,
        },
        candidates,
      );

      if (allocation.outcome === "ALLOCATED") {
        const printer = candidates.find((c) => c.id === allocation.printerId);
        await tx.printJob.create({
          data: {
            orderId,
            shopId: freshOrder.shopId,
            orderItemId: draft.orderItemId,
            printerId: allocation.printerId,
            attempt: attempt + 1,
            idempotencyToken,
            status: PrintJobStatus.QUEUED,
          },
        });
        if (printer) {
          // Keep this dispatch call's own candidate load current so a
          // second item exploded in the SAME call sees an accurate
          // queue depth for tie-breaking, rather than every item in one
          // multi-item order racing to the same "least loaded" printer.
          printer.queuedJobs += 1;
          printer.queuedPages += pages;
          const deviceId = deviceIdsByPrinterId.get(printer.id);
          if (deviceId) {
            notifyDeviceIds.add(deviceId);
          }
        }
      } else if (freshOrder.shop.multiItemEnabled) {
        await tx.printJob.create({
          data: {
            orderId,
            shopId: freshOrder.shopId,
            orderItemId: draft.orderItemId,
            printerId: null,
            attempt: attempt + 1,
            idempotencyToken,
            status: PrintJobStatus.WAITING,
            blockedReason: allocation.blockedReason,
          },
        });
      } else {
        const requestedCandidateExists =
          requestedPrinterId !== undefined && candidates.some((c) => c.id === requestedPrinterId);
        throw this.blockedReasonToLegacyException(
          allocation,
          requestedPrinterId !== undefined,
          requestedCandidateExists,
        );
      }
    }

    return { notifyDeviceIds: [...notifyDeviceIds] };
  }

  /** Preserves the exact pre-18.5 error contract for
   * `multiItemEnabled: false` orders -- the equivalence this phase
   * gates on. `candidateExists` distinguishes 10.4's own two manual-
   * path outcomes: PRINTER_NOT_AVAILABLE covers "doesn't exist / wrong
   * shop / disabled" (findRequestedPrinter()'s old WHERE clause
   * excluded all three, so `allocatePrinter()` never even sees them as
   * a real candidate -- or sees one whose own status is
   * OFFLINE/DISABLED), PRINTER_CAPABILITY_MISMATCH covers "exists, but
   * can't do this job." */
  private blockedReasonToLegacyException(
    allocation: Extract<AllocationResult, { outcome: "BLOCKED" }>,
    manual: boolean,
    candidateExists: boolean,
  ): AppException {
    if (!manual) {
      return new AppException(
        HttpStatus.CONFLICT,
        "NO_PRINTER_AVAILABLE",
        // 19.2: the typed code is unchanged; the reason is visible in the
        // message so staff know it is a page limit, not an outage.
        allocation.blockedReason === "PAGE_LIMIT_REACHED"
          ? "No printer is available to accept this order: every suitable printer has reached its page limit."
          : "No printer is available to accept this order.",
        true,
      );
    }
    if (
      !candidateExists ||
      allocation.blockedReason === "PRINTER_OFFLINE" ||
      allocation.blockedReason === "PRINTER_DISABLED"
    ) {
      return new AppException(
        HttpStatus.CONFLICT,
        "PRINTER_NOT_AVAILABLE",
        "That printer is not available for this shop.",
        true,
      );
    }
    return new AppException(
      HttpStatus.CONFLICT,
      "PRINTER_CAPABILITY_MISMATCH",
      "That printer cannot fulfil this order's configuration.",
      false,
    );
  }

  /** 18.2: RETRY_PRINT/RESOLVE_UNKNOWN_* no longer exist as order-
   * machine events -- PRINT_FAILED/PRINT_STATUS_UNKNOWN are now DERIVED
   * (SYNC_JOBS), so "is this order still in the state this action
   * expects" is no longer a question the order machine's own legality
   * table answers for free. This locks the order row (mirroring
   * OrderStateMachine.applyLocked()'s own first step exactly) and
   * returns its current status so retry/change-printer/resolve-unknown
   * can each re-implement the same "double-tap finds it already moved
   * on, no-op rather than error" idempotency the deleted events used to
   * give them, still under a real row lock (no TOCTOU gap between the
   * check and the job rows this transaction goes on to touch). */
  private async lockOrderStatus(
    tx: Prisma.TransactionClient,
    orderId: string,
  ): Promise<OrderStatus> {
    const rows = await tx.$queryRaw<Array<{ order_status: OrderStatus }>>`
      SELECT order_status FROM orders WHERE id = ${orderId} FOR UPDATE
    `;
    const status = rows[0]?.order_status;
    if (status === undefined) {
      throw new NotFoundException("Order not found.");
    }
    return status;
  }

  /** 18.17: retry / change-printer / resolve-unknown act ONLY on the
   * items whose current (non-superseded) job is in `statuses` --
   * FAILED/TIMEOUT for retry and change-printer, UNKNOWN for resolve-
   * unknown's RETRY. Just those jobs are superseded (what keeps
   * SHOP_ORDER_INCLUDE's `supersededAt: null` filter meaning "the
   * current attempt" and stops aggregateOrderStatus() seeing a stale
   * FAILED job next to its replacement); PRINTED, PRINTING, CLAIMED,
   * QUEUED, PAUSED and WAITING siblings are left byte-for-byte alone, so
   * a retry can never reprint a finished item or orphan an in-flight
   * one. Returns the item ids to re-dispatch, or `undefined` meaning "all
   * items" for a legacy job that has no order item (single-item orders
   * behave exactly as before). Throws 409 NO_RETRYABLE_ITEMS if nothing
   * qualifies. */
  private async supersedeJobsForRetry(
    tx: Prisma.TransactionClient,
    orderId: string,
    statuses: PrintJobStatus[],
  ): Promise<Set<string> | undefined> {
    const eligible = await tx.printJob.findMany({
      where: { orderId, supersededAt: null, status: { in: statuses } },
      select: { id: true, orderItemId: true },
    });
    if (eligible.length === 0) {
      // No job history at all (an order moved to this status without any
      // job row): nothing to protect, so re-dispatch every item exactly
      // as the pre-18.17 code did.
      const liveJobs = await tx.printJob.count({ where: { orderId, supersededAt: null } });
      if (liveJobs === 0) {
        return undefined;
      }
      throw new AppException(
        HttpStatus.CONFLICT,
        "NO_RETRYABLE_ITEMS",
        "No item of this order has a job that can be retried.",
        false,
      );
    }
    await tx.printJob.updateMany({
      where: { id: { in: eligible.map((job) => job.id) } },
      data: { supersededAt: new Date() },
    });
    if (eligible.some((job) => job.orderItemId === null)) {
      return undefined;
    }
    return new Set(eligible.map((job) => job.orderItemId as string));
  }

  /** 18.16: re-derive the order INSIDE the caller's transaction, so the
   * job rows just written and the order status commit (or roll back)
   * together. Returns the pending notification email, which the caller
   * must hand to `enqueuePendingEmail` only after the transaction
   * committed. An already-closed order (ILLEGAL_ORDER_TRANSITION) is
   * tolerated; anything else propagates and aborts the transaction. */
  private async syncOrderWithin(
    tx: Prisma.TransactionClient,
    orderId: string,
    actorId: string,
  ): Promise<SendEmailJob | undefined> {
    try {
      const applied = await this.orderStateMachine.transitionWithin(
        tx,
        orderId,
        OrderEvent.SYNC_JOBS,
        { id: actorId },
      );
      return applied.pendingEmail;
    } catch (error) {
      if (error instanceof AppException && error.errorCode === "ILLEGAL_ORDER_TRANSITION") {
        return undefined;
      }
      throw error;
    }
  }

  /** §49/10.4: staff's own "Change Printer" choice, resolving a
   * PRINT_FAILED order by naming a *specific* replacement rather than
   * letting dispatchToPrinter() auto-select "any available printer." */
  async changePrinter(
    orderId: string,
    actorId: string,
    printerId: string,
  ): Promise<ShopOrderResponse> {
    let notifyDeviceIds: string[] = [];
    let pendingEmail: SendEmailJob | undefined;

    await this.prisma.$transaction(async (tx) => {
      const status = await this.lockOrderStatus(tx, orderId);
      if (status !== OrderStatus.PRINT_FAILED) {
        return;
      }
      const itemIds = await this.supersedeJobsForRetry(tx, orderId, RETRYABLE_FAILURES);
      notifyDeviceIds = (await this.dispatchToPrinter(tx, orderId, printerId, itemIds))
        .notifyDeviceIds;
      pendingEmail = await this.syncOrderWithin(tx, orderId, actorId);
    });

    await this.orderStateMachine.enqueuePendingEmail(pendingEmail);
    await this.notifyDevices(notifyDeviceIds);
    return this.getOrder(orderId);
  }

  /** §48/10.1: staff's own "Retry" choice on a PRINT_FAILED order.
   * Idempotent the same way acceptOrder() is: a genuine double-tap
   * finds the order no longer PRINT_FAILED by the time this locks the
   * row, and is a no-op rather than an error. */
  async retryPrint(orderId: string, actorId: string): Promise<ShopOrderResponse> {
    let notifyDeviceIds: string[] = [];
    let pendingEmail: SendEmailJob | undefined;

    await this.prisma.$transaction(async (tx) => {
      const status = await this.lockOrderStatus(tx, orderId);
      if (status !== OrderStatus.PRINT_FAILED) {
        return;
      }
      const itemIds = await this.supersedeJobsForRetry(tx, orderId, RETRYABLE_FAILURES);
      notifyDeviceIds = (await this.dispatchToPrinter(tx, orderId, undefined, itemIds))
        .notifyDeviceIds;
      pendingEmail = await this.syncOrderWithin(tx, orderId, actorId);
    });

    await this.orderStateMachine.enqueuePendingEmail(pendingEmail);
    await this.notifyDevices(notifyDeviceIds);
    return this.getOrder(orderId);
  }

  /** §47/10.3: PRINT_STATUS_UNKNOWN is a first-class UI flow, not an
   * error toast -- a human staff member looks at the physical printer
   * and tells the system what actually happened. RETRY re-dispatches
   * through the same supersede-then-dispatch-then-sync shape as 10.1's
   * own retryPrint(); the other two resolutions instead resolve the
   * specific UNKNOWN job (via PrintJobStateMachine's own
   * RESOLVE_PRINTED/RESOLVE_FAILED events -- illegal, and therefore
   * harmlessly skipped, if it's no longer UNKNOWN) and then let
   * `syncFromJobs` re-derive the order from that. */
  async resolveUnknownPrint(
    orderId: string,
    actorId: string,
    resolution: ResolveUnknownPrintInput["resolution"],
    jobId?: string,
  ): Promise<ShopOrderResponse> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException("Order not found.");
    }
    const illegal = (message: string) =>
      new AppException(HttpStatus.CONFLICT, "ILLEGAL_ORDER_TRANSITION", message, false);
    // Fast, unlocked pre-check for a clear error only. The AUTHORITATIVE check
    // is `guard` below, evaluated inside the job machine's transaction after
    // it has locked the orders row (18.26), for all three resolutions.
    if (order.orderStatus !== OrderStatus.PRINT_STATUS_UNKNOWN) {
      throw illegal(
        `Cannot resolve an unknown print outcome for an order in ${order.orderStatus}.`,
      );
    }

    const unknownJobs = await this.prisma.printJob.findMany({
      where: { orderId, status: PrintJobStatus.UNKNOWN, supersededAt: null },
      select: { id: true, orderItemId: true },
      orderBy: { id: "asc" },
    });
    if (unknownJobs.length === 0) {
      if (resolution === "RETRY" && (await this.hasNoLiveJobs(orderId))) {
        // Legacy/no-history order (moved to this status without any job row):
        // nothing to supersede, so re-dispatch every item as before 18.26.
        return this.retryWithoutJobHistory(orderId, actorId);
      }
      throw illegal("This order has no print job with an unknown outcome to resolve.");
    }
    let target = unknownJobs[0]!;
    if (jobId !== undefined) {
      const named = unknownJobs.find((job) => job.id === jobId);
      if (!named) {
        throw illegal("That job is not one of this order's UNKNOWN print jobs.");
      }
      target = named;
    } else if (unknownJobs.length > 1) {
      // Each unknown job may have a different real-world outcome, so one
      // answer must never silently apply to all of them.
      throw new AppException(
        HttpStatus.CONFLICT,
        "UNKNOWN_JOB_ID_REQUIRED",
        `This order has ${unknownJobs.length} print jobs with an unknown outcome; resolve one at a time by passing jobId. UNKNOWN job ids: ${unknownJobs
          .map((job) => job.id)
          .join(", ")}`,
        false,
      );
    }

    const guard = async (tx: Prisma.TransactionClient): Promise<void> => {
      const rows = await tx.$queryRaw<Array<{ order_status: OrderStatus }>>`
        SELECT order_status FROM orders WHERE id = ${orderId}
      `;
      if (rows[0]?.order_status !== OrderStatus.PRINT_STATUS_UNKNOWN) {
        throw illegal(
          `Cannot resolve an unknown print outcome for an order in ${rows[0]?.order_status}.`,
        );
      }
    };
    const event =
      resolution === "CONFIRMED_PRINTED"
        ? PrintJobEvent.RESOLVE_PRINTED
        : resolution === "MARK_FAILED"
          ? PrintJobEvent.RESOLVE_FAILED
          : PrintJobEvent.RESOLVE_RETRY;

    let notifyDeviceIds: string[] = [];
    try {
      // One transaction, orders row locked first: the job write, (for RETRY)
      // the replacement dispatch, and the order sync commit together. Never a
      // 200 when nothing was resolved: a job that is no longer UNKNOWN is a
      // 409 like any other lost race.
      await this.jobStateMachine.transition(
        target.id,
        event,
        { id: actorId },
        {
          metadata: { resolution },
          guard,
          beforeSync:
            resolution === "RETRY"
              ? async (tx) => {
                  notifyDeviceIds = (
                    await this.dispatchToPrinter(
                      tx,
                      orderId,
                      undefined,
                      target.orderItemId ? new Set([target.orderItemId]) : undefined,
                    )
                  ).notifyDeviceIds;
                }
              : undefined,
        },
      );
    } catch (error) {
      if (error instanceof AppException && error.errorCode === "ILLEGAL_JOB_TRANSITION") {
        throw illegal("This print job is no longer awaiting resolution.");
      }
      throw error;
    }

    await this.notifyDevices(notifyDeviceIds);
    return this.getOrder(orderId);
  }

  private async hasNoLiveJobs(orderId: string): Promise<boolean> {
    return (await this.prisma.printJob.count({ where: { orderId, supersededAt: null } })) === 0;
  }

  private async retryWithoutJobHistory(
    orderId: string,
    actorId: string,
  ): Promise<ShopOrderResponse> {
    let notifyDeviceIds: string[] = [];
    let pendingEmail: SendEmailJob | undefined;
    await this.prisma.$transaction(async (tx) => {
      const status = await this.lockOrderStatus(tx, orderId);
      if (status !== OrderStatus.PRINT_STATUS_UNKNOWN) {
        throw new AppException(
          HttpStatus.CONFLICT,
          "ILLEGAL_ORDER_TRANSITION",
          `Cannot resolve an unknown print outcome for an order in ${status}.`,
          false,
        );
      }
      notifyDeviceIds = (await this.dispatchToPrinter(tx, orderId)).notifyDeviceIds;
      pendingEmail = await this.syncOrderWithin(tx, orderId, actorId);
    });
    await this.orderStateMachine.enqueuePendingEmail(pendingEmail);
    await this.notifyDevices(notifyDeviceIds);
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
   * since nothing yet needs it queryable. The transition itself now
   * produces the customer's ORDER_REJECTED notification for free
   * (11.3 added SHOP_REJECT to NOTIFICATION_TYPE_BY_EVENT), atomically
   * with the state change; the refund trigger below is a genuinely
   * separate step, run only after that commits. */
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
    // §80/11.3: "shop rejection... trigger[s] refunds where payment
    // already succeeded" -- run as a separate step *after* the
    // transition commits, not inside its own `sideEffect`.
    // RefundService takes its own Redis order-lock and calls out to
    // the payment provider; holding the transition's Postgres row lock
    // open across that (the same thing webhooks.service.ts already
    // avoids for its own post-transition ROUTE_TO_SHOP step) is worth
    // avoiding even though the mock provider itself resolves
    // instantly.
    await this.refundService.refundOrderIfPaid(orderId, "shop_rejection", actorId);
    return this.getOrder(orderId);
  }

  /** §35/17.6: thin wrapper over ManualPaymentService -- see its own
   * comment for the full reasoning. ShopScopeGuard (via
   * OrderShopResolver, at the route level) has already confirmed the
   * caller is active staff at this exact order's shop by the time this
   * runs. */
  async recordManualPayment(orderId: string, actorId: string): Promise<ShopOrderResponse> {
    await this.manualPaymentService.recordManualPayment(orderId, actorId);
    return this.getOrder(orderId);
  }

  async markReady(orderId: string, actorId: string): Promise<ShopOrderResponse> {
    await this.orderStateMachine.transition(orderId, OrderEvent.MARK_READY, { id: actorId });
    return this.getOrder(orderId);
  }

  async completeOrder(orderId: string, actorId: string): Promise<ShopOrderResponse> {
    await this.orderStateMachine.transition(orderId, OrderEvent.COMPLETE, { id: actorId });
    this.logger.log({ metric: "order.completed", orderId }, "Order completed.");
    return this.getOrder(orderId);
  }

  private toResponse(order: ShopOrderWithRelations): ShopOrderResponse {
    return {
      id: order.id,
      publicOrderNumber: order.publicOrderNumber,
      customerName: order.customerRecord?.name ?? order.customer.name,
      documentFilename: order.document.filename,
      printConfiguration: order.printConfiguration,
      pricingSnapshot: order.pricingSnapshot,
      paymentStatus: order.paymentStatus,
      orderStatus: order.orderStatus,
      createdAt: order.createdAt,
      printerName: order.printJobs[0]?.printer?.name ?? null,
      printJobs: order.printJobs.map((job) => ({
        id: job.id,
        status: job.status,
        printerName: job.printer?.name ?? null,
        blockedReason: job.blockedReason,
      })),
    };
  }
}
