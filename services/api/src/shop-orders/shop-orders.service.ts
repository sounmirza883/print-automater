import { randomUUID } from "node:crypto";
import { ForbiddenException, HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import {
  DocumentStatus,
  OrderStatus,
  PaymentStatus,
  Prisma,
  PrintJobStatus,
  PrinterStatus,
} from "@prisma/client";
import type {
  PrintConfiguration,
  PrinterCapabilities,
  ShopRejectionReason,
} from "@print-automated/types";
import type { ResolveUnknownPrintInput } from "@print-automated/validation";
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
  // §37's own printing screen needs a printer name to show -- the
  // most recently created job is "the" job for MVP purposes (nothing
  // before 10.4's own "change printer" ever creates a second one for
  // the same order).
  printJobs: {
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { status: true, printer: { select: { name: true } } },
  },
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
  // §37: null until a print_job exists (i.e. before SHOP_ACCEPT) --
  // the printing screen has nothing to show a printer name for yet at
  // that point anyway.
  printerName: string | null;
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
            notifyDeviceId = (await this.dispatchToPrinter(tx, orderId)).notifyDeviceId;
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

  /** §44's own gate, re-checked fresh through `tx` rather than trusted
   * from however the caller got here -- shared by acceptOrder() and
   * 10.1's retryPrint(), since a retry is itself a fresh dispatch
   * attempt, not a resume of the one that failed, and deserves the
   * exact same four-condition check. Always creates a NEW print_job
   * row rather than reusing/flipping an old FAILED one: each row is
   * one attempt, preserving "attempt 1 failed, attempt 2 succeeded"
   * as real history instead of overwriting it -- the same shape
   * 10.4's own eventual change-printer reassignment needs anyway. */
  private async dispatchToPrinter(
    tx: Prisma.TransactionClient,
    orderId: string,
    requestedPrinterId?: string,
  ): Promise<{ notifyDeviceId: string | null }> {
    const freshOrder = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { shopId: true, paymentStatus: true, documentId: true, printConfiguration: true },
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

    // §49/10.4: a staff-requested printer is an explicit, deliberate
    // choice (not auto-selected "any available printer"), so it gets
    // its own lookup and its own capability check against exactly what
    // this order needs.
    const printer = requestedPrinterId
      ? await this.findRequestedPrinter(
          tx,
          requestedPrinterId,
          freshOrder.shopId,
          freshOrder.printConfiguration as unknown as PrintConfiguration,
        )
      : await tx.printer.findFirst({
          where: { shopId: freshOrder.shopId, status: { not: PrinterStatus.DISABLED } },
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
        shopId: freshOrder.shopId,
        idempotencyToken: randomUUID(),
      },
    });
    // A printer staff registered by hand (8.4) before any agent ever
    // heartbeated it has no agent yet -- nothing to wake. The job
    // still sits QUEUED for whenever an agent does start reporting it.
    return { notifyDeviceId: printer.agent?.deviceId ?? null };
  }

  /** §49/10.4. Distinguishes "doesn't exist / wrong shop / disabled"
   * (PRINTER_NOT_AVAILABLE) from "exists, but can't do this job"
   * (PRINTER_CAPABILITY_MISMATCH) -- a readable, specific reason
   * either way, never a generic refusal. */
  private async findRequestedPrinter(
    tx: Prisma.TransactionClient,
    printerId: string,
    shopId: string,
    printConfiguration: PrintConfiguration,
  ) {
    const printer = await tx.printer.findFirst({
      where: { id: printerId, shopId, status: { not: PrinterStatus.DISABLED } },
      include: { agent: { select: { deviceId: true } } },
    });
    if (!printer) {
      throw new AppException(
        HttpStatus.CONFLICT,
        "PRINTER_NOT_AVAILABLE",
        "That printer is not available for this shop.",
        true,
      );
    }
    if (
      !printerSupportsConfiguration(
        printer.capabilities as unknown as PrinterCapabilities | null,
        printConfiguration,
      )
    ) {
      throw new AppException(
        HttpStatus.CONFLICT,
        "PRINTER_CAPABILITY_MISMATCH",
        "That printer cannot fulfil this order's configuration.",
        false,
      );
    }
    return printer;
  }

  /** §49/10.4: staff's own "Change Printer" choice, resolving a
   * PRINT_FAILED order by naming a *specific* replacement rather than
   * letting dispatchToPrinter() auto-select "any available printer" --
   * RETRY_PRINT is the same event 10.1's own plain retry uses (its own
   * comment already noted it covers both cases), just with a
   * requestedPrinterId this time. */
  async changePrinter(
    orderId: string,
    actorId: string,
    printerId: string,
  ): Promise<ShopOrderResponse> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException("Order not found.");
    }

    let notifyDeviceId: string | null = null;
    try {
      await this.orderStateMachine.transition(
        orderId,
        OrderEvent.RETRY_PRINT,
        { id: actorId },
        {
          metadata: { changedToPrinterId: printerId },
          sideEffect: async (tx) => {
            notifyDeviceId = (await this.dispatchToPrinter(tx, orderId, printerId)).notifyDeviceId;
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
    return this.getOrder(orderId);
  }

  /** §48/10.1: staff's own "Retry" choice on a PRINT_FAILED order --
   * RETRY_PRINT lands the order straight back in QUEUED_FOR_PRINT (no
   * SHOP_ACCEPT/QUEUE_PRINT chain needed, unlike acceptOrder(), since
   * the order never left the "shop already accepted this" side of the
   * machine). Idempotent the same way acceptOrder() is: a genuine
   * double-tap finds the order already past PRINT_FAILED on its second
   * attempt, and ILLEGAL_ORDER_TRANSITION is swallowed rather than
   * surfaced as an error. */
  async retryPrint(orderId: string, actorId: string): Promise<ShopOrderResponse> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException("Order not found.");
    }

    let notifyDeviceId: string | null = null;

    try {
      await this.orderStateMachine.transition(
        orderId,
        OrderEvent.RETRY_PRINT,
        { id: actorId },
        {
          sideEffect: async (tx) => {
            notifyDeviceId = (await this.dispatchToPrinter(tx, orderId)).notifyDeviceId;
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

    return this.getOrder(orderId);
  }

  /** §47/10.3: PRINT_STATUS_UNKNOWN is a first-class UI flow, not an
   * error toast -- a human staff member looks at the physical printer
   * and tells the system what actually happened. All three
   * resolutions were already legal transitions in order-state-
   * machine.ts's own table (RESOLVE_UNKNOWN_PRINTED/RETRY/FAILED) --
   * this is the endpoint that finally lets staff reach them. "Every
   * resolution is audited with the acting staff member" needs no
   * extra code here: `transition()` already writes `actor.id` into
   * every audit row it creates, and this call always passes the real
   * staff id, never null. RETRY re-dispatches through the same
   * dispatchToPrinter() gate as 10.1's own retryPrint(); the other two
   * resolutions only need the print_job row's own status brought in
   * line with what staff just confirmed, since nothing else about
   * dispatch applies to a terminal outcome. */
  async resolveUnknownPrint(
    orderId: string,
    actorId: string,
    resolution: ResolveUnknownPrintInput["resolution"],
  ): Promise<ShopOrderResponse> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException("Order not found.");
    }

    if (resolution === "RETRY") {
      let notifyDeviceId: string | null = null;
      await this.orderStateMachine.transition(
        orderId,
        OrderEvent.RESOLVE_UNKNOWN_RETRY,
        { id: actorId },
        {
          metadata: { resolution },
          sideEffect: async (tx) => {
            notifyDeviceId = (await this.dispatchToPrinter(tx, orderId)).notifyDeviceId;
          },
        },
      );
      if (notifyDeviceId) {
        await this.agentJobsService.notify(notifyDeviceId);
      }
      return this.getOrder(orderId);
    }

    const event =
      resolution === "CONFIRMED_PRINTED"
        ? OrderEvent.RESOLVE_UNKNOWN_PRINTED
        : OrderEvent.RESOLVE_UNKNOWN_FAILED;
    const printJobStatus =
      resolution === "CONFIRMED_PRINTED" ? PrintJobStatus.PRINTED : PrintJobStatus.FAILED;

    await this.orderStateMachine.transition(
      orderId,
      event,
      { id: actorId },
      {
        metadata: { resolution },
        sideEffect: async (tx) => {
          const latestJob = await tx.printJob.findFirst({
            where: { orderId },
            orderBy: { createdAt: "desc" },
          });
          if (latestJob) {
            await tx.printJob.update({
              where: { id: latestJob.id },
              data: { status: printJobStatus },
            });
          }
        },
      },
    );
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
      printerName: order.printJobs[0]?.printer.name ?? null,
    };
  }
}

/** §49/10.4. Deliberately the *opposite* null-handling from orders.
 * service.ts's own shopCanFulfil(): a shop's own capabilities being
 * null there means "never configured, refuse by default" (a system-
 * wide filter applied with no human involved). Here, a printer's
 * capabilities being null means "not yet probed by an agent heartbeat"
 * (9.4's own established meaning) -- and staff naming THIS printer by
 * id is itself a deliberate, informed choice, not a blind filter, so
 * unknown capabilities don't block it. A capability the system
 * actually knows is missing still refuses, unconditionally. */
function printerSupportsConfiguration(
  capabilities: PrinterCapabilities | null,
  config: PrintConfiguration,
): boolean {
  if (capabilities === null) {
    return true;
  }
  if (config.color === "COLOR" && !capabilities.color) {
    return false;
  }
  if (config.sides === "DOUBLE" && !capabilities.duplex) {
    return false;
  }
  if (config.paperSize === "A4" && !capabilities.a4) {
    return false;
  }
  return true;
}
