import {
  ForbiddenException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  DocumentStatus,
  type JobFailureReason,
  OrderCreationSource,
  OrderItemType,
  OrderStatus,
  PaymentStatus,
  Prisma,
  PrintJobStatus,
} from "@prisma/client";
import {
  BlockedReason,
  Permission,
  QualityCheckStatus,
  type Page,
  type PrintConfiguration,
  type ReprintReason,
  type ShopRejectionReason,
} from "@print-automated/types";
import type {
  CreateCounterOrderInput,
  ListShopOrdersQueryInput,
  OrderHistoryQueryInput,
  SearchShopOrdersQueryInput,
  QualityCheckInput,
  ResolveUnknownPrintInput,
} from "@print-automated/validation";
import {
  allocatePrinter,
  AppException,
  buildPrinterCandidates,
  paperNeedFor,
  withPaperAvailability,
  explodeOrderItems,
  jobPages,
  logJobPagesFallback,
  OrderEvent,
  OrderStateMachine,
  PrintJobEvent,
  PrintJobStateMachine,
  PrismaService,
  ROLE_PERMISSIONS,
  type AllocationRequest,
  type AllocationResult,
  type PrinterCandidate,
  type SendEmailJob,
} from "@print-automated/backend-shared";
import { ShopScopedRepository } from "../prisma/shop-scoped-repository.js";
import { resolvePagination } from "../common/pagination.js";
import { ilike } from "../common/search.js";
import { sanitizeHistoryMetadata } from "./order-history.js";
import { ShopMembershipService } from "../auth/shop-membership.service.js";
import { AgentJobsService } from "../agents/agent-jobs.service.js";
import { OrdersService, type OrderResponse } from "../orders/orders.service.js";
import { toDeliveryResponse, type DeliveryResponse } from "../deliveries/deliveries.service.js";
import { ManualPaymentService } from "../payments/manual-payment.service.js";
import { RefundService } from "../payments/refund.service.js";
import { ShopPlanService } from "../shop-plan/shop-plan.service.js";

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
  // 21.5: the optional delivery record.
  delivery: true,
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
      failureReason: true,
      failureNote: true,
      // 21.4: set when this job IS a reprint of another job.
      reprintOf: { select: { originalJobId: true, reason: true, additionalCostMinor: true } },
      printer: { select: { name: true } },
      // 23.26: who is running the job (manual operator allocation, 18.9), for staff screens.
      operator: { select: { id: true, name: true } },
      // 23.13: per-job timeline and ordering facts (all plain columns, no extra join).
      orderItemId: true,
      attempt: true,
      priority: true,
      createdAt: true,
      updatedAt: true,
      pausedAt: true,
      supersededAt: true,
    },
  },
} satisfies Prisma.OrderInclude;

/** 23.13: what ONE order's detail view adds to the list shape -- line items, the
 * customer's contact details and the payment, so a list of 50-1000 orders never pays for
 * them. A superset of SHOP_ORDER_INCLUDE (same keys, wider selects). */
const SHOP_ORDER_DETAIL_INCLUDE = {
  ...SHOP_ORDER_INCLUDE,
  customer: { select: { name: true, email: true, phone: true } },
  customerRecord: { select: { name: true, email: true, phone: true } },
  items: {
    orderBy: { sequence: "asc" },
    select: {
      id: true,
      sequence: true,
      itemType: true,
      required: true,
      quantity: true,
      printConfiguration: true,
      pricingSnapshot: true,
      document: { select: { filename: true } },
    },
  },
  // Only what the shop may see: never providerPaymentId or checkoutUrl.
  payments: {
    orderBy: { createdAt: "desc" },
    select: {
      provider: true,
      status: true,
      amountMinor: true,
      currency: true,
      paidAt: true,
      refunds: { select: { amountMinor: true, status: true, currency: true } },
    },
  },
} satisfies Prisma.OrderInclude;

type ShopOrderWithRelations = Prisma.OrderGetPayload<{ include: typeof SHOP_ORDER_INCLUDE }>;
type ShopOrderDetailWithRelations = Prisma.OrderGetPayload<{
  include: typeof SHOP_ORDER_DETAIL_INCLUDE;
}>;

// 18.6's own Done-when: a blocked job's reason must be "visible via the
// shop-orders API response," not just a database column nothing ever
// surfaces.
export interface ShopOrderJobSummary {
  id: string;
  status: string;
  printerName: string | null;
  blockedReason: string | null;
  // 21.2 (§66): the operator's failure-reason pick, null until chosen.
  failureReason: string | null;
  failureNote: string | null;
  // 21.4 (§67): non-null when this job is a reprint of `originalJobId`.
  reprint: { originalJobId: string; reason: string; additionalCostMinor: number } | null;
  // 23.26: the assigned operator (18.9), null when none (additive).
  operatorId: string | null;
  operatorName: string | null;
  // 23.13: per-job timeline/ordering facts (additive).
  attempt: number;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
  pausedAt: Date | null;
  supersededAt: Date | null;
}

/** 23.13: one line of an order. `status` is the current (non-superseded) job's status for
 * this item, null before dispatch. `priceMinor` comes from the item's own price snapshot,
 * else the order quote when the order has a single item (never a live price lookup). */
export interface ShopOrderItemSummary {
  id: string | null;
  sequence: number;
  itemType: string;
  required: boolean;
  documentName: string;
  quantity: number;
  printConfiguration: unknown;
  status: string | null;
  priceMinor: number | null;
}

/** 23.13: contact details. `kind` WALK_IN = the shop's own customer record (or a counter
 * order with none: then only the placing staff member's name is known); ACCOUNT = the
 * customer's own account. phone/email are nulled and `contactRedacted` set for roles that
 * cannot manage deliveries (DeliveryRedactionInterceptor). */
export interface ShopOrderCustomerContact {
  kind: "WALK_IN" | "ACCOUNT";
  name: string;
  phone: string | null;
  email: string | null;
  contactRedacted?: boolean;
}

/** 23.13: the paying side, without any provider identifier or checkout link. */
export interface ShopOrderPaymentSummary {
  provider: string;
  status: string;
  amountMinor: number;
  currency: string;
  paidAt: Date | null;
}

export interface ShopOrderDetailResponse extends ShopOrderResponse {
  items: ShopOrderItemSummary[];
  customerContact: ShopOrderCustomerContact;
  payment: ShopOrderPaymentSummary | null;
  refunds: { count: number; refundedMinor: number; pendingMinor: number; currency: string | null };
}

/** 23.13: one row of `GET /shop/orders/:id/history`. */
export interface OrderHistoryEvent {
  id: string;
  at: Date;
  action: string;
  resourceType: string;
  resourceId: string | null;
  actor: { id: string; name: string } | null;
  metadata: unknown;
}

/** 21.4 (§67): what POST /print-jobs/:id/reprint returns. */
export interface ReprintResponse {
  reprintId: string;
  originalJobId: string;
  reason: string;
  note: string | null;
  additionalCostMinor: number;
  requestedBy: string | null;
  createdAt: Date;
  job: {
    id: string;
    orderId: string;
    status: string;
    printerId: string | null;
    printerName: string | null;
    blockedReason: string | null;
    attempt: number;
  };
}

/** Order statuses a reprint may be requested in: still in production, waiting on
 * a quality check, or already ready for collection (the customer came back with a
 * bad print). COMPLETED and every dead status are closed. */
const REPRINTABLE_ORDER_STATUSES: ReadonlySet<OrderStatus> = new Set([
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
]);

/** Job statuses that mean "an attempt for this item is still in flight or
 * unresolved": a reprint must never start a second copy next to one of these. */
const REPRINT_BLOCKING_JOB_STATUSES: PrintJobStatus[] = [
  PrintJobStatus.CREATED,
  PrintJobStatus.WAITING,
  PrintJobStatus.QUEUED,
  PrintJobStatus.CLAIMED,
  PrintJobStatus.PRINTING,
  PrintJobStatus.PAUSED,
  PrintJobStatus.UNKNOWN,
];

export interface ShopOrderResponse {
  id: string;
  publicOrderNumber: string;
  customerName: string;
  documentFilename: string;
  printConfiguration: unknown;
  pricingSnapshot: unknown;
  paymentStatus: string;
  orderStatus: string;
  // 24.1: CUSTOMER_WEB, COUNTER or QR -- lets staff tell a QR order awaiting
  // payment at the counter from any other order in needsAttention.
  creationSource: OrderCreationSource;
  createdAt: Date;
  // §37: null until a print_job exists (i.e. before SHOP_ACCEPT) --
  // the printing screen has nothing to show a printer name for yet at
  // that point anyway. For a multi-item order this is the most
  // recently created job's own printer -- a per-job breakdown lives in
  // `printJobs` below.
  printerName: string | null;
  printJobs: ShopOrderJobSummary[];
  // 21.3 (§68): NOT_REQUIRED unless the shop runs quality checks.
  qualityCheckStatus: string | null;
  // 21.5 (§71): the optional delivery record, null when the order has none.
  delivery: DeliveryResponse | null;
  // 23.13: the highest priority among the order's current jobs (0 when none/unset).
  priority: number;
  // 23.16: the pricing-rule version this order was quoted under, read from the order's OWN
  // pricing snapshot (never a live rule); null for a snapshot that predates versioning.
  pricingRuleVersion: number | null;
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

/** 19.12: the group an order is shown in. PRECEDENCE:
 *   1. "hidden" (customer/payment-side only) is never overridden.
 *   2. A NON-TERMINAL, in-production order (base group "printing") that has at
 *      least one non-superseded job that is WAITING with a blockedReason is
 *      STRANDED -- a human has to act (e.g. failover parked it, or nothing
 *      qualified at dispatch) -- so it is "needsAttention" whatever its derived
 *      status (PREPARING, QUEUED_FOR_PRINT, PRINTING, ...).
 *   3. Everything else keeps its GROUP_BY_STATUS group: terminal orders
 *      (ready/completed/failed) and orders already needing attention never move,
 *      and an order with no blocked job (every single-job order today) is
 *      unchanged. GROUP_BY_STATUS stays total and typed; this only refines it.
 *   4. (24.1) The one exception to rule 1: a QR order resting in UPLOADED is
 *      "needsAttention" (see QR_AWAITING_PAYMENT). Every other UPLOADED order
 *      -- customer-web mid-checkout, a counter order before its immediate
 *      payment call -- stays hidden exactly as before.
 * Callers pass only the order's NON-superseded jobs (SHOP_ORDER_INCLUDE). */
export function groupForOrder(
  status: OrderStatus,
  jobs: ReadonlyArray<{ status: string; blockedReason: string | null }>,
  creationSource: OrderCreationSource,
): keyof ShopOrdersGrouped | "hidden" {
  // 24.1: no payment step exists for a QR order in this scope (the guest has no
  // account to check out with), so its visibility cannot wait for one -- staff
  // must see it to take payment at the counter (record-payment accepts UPLOADED).
  if (status === OrderStatus.UPLOADED && creationSource === OrderCreationSource.QR) {
    return "needsAttention";
  }
  const base = GROUP_BY_STATUS[status];
  if (base === "printing" && jobs.some((job) => job.status === "WAITING" && job.blockedReason)) {
    return "needsAttention";
  }
  return base;
}

/** 24.1: the SQL form of groupForOrder's QR rule -- a guest's QR order that
 * no one has taken payment for yet. The only non-SHOP_VISIBLE_STATUSES
 * orders a shop sees; every shop-side read that filters on visibility or on
 * the needsAttention group ORs this in (whereInGroup, shopVisibleWhere,
 * the legacy grouped list, the owner dashboard's counts). */
export const QR_AWAITING_PAYMENT = {
  orderStatus: OrderStatus.UPLOADED,
  creationSource: OrderCreationSource.QR,
} satisfies Prisma.OrderWhereInput;

function statusesInGroup(...groups: Array<keyof ShopOrdersGrouped>): OrderStatus[] {
  return (Object.keys(GROUP_BY_STATUS) as OrderStatus[]).filter((status) =>
    (groups as string[]).includes(GROUP_BY_STATUS[status]),
  );
}

/** 23.6: the SQL form of `groupForOrder` for one group, so a paged group agrees with the
 * grouped list: an in-production order that has a live job parked WAITING with a reason
 * is stranded, so it belongs to needsAttention rather than printing. 24.1: a QR order
 * awaiting payment belongs to needsAttention too (groupForOrder rule 4). */
export function whereInGroup(group: keyof ShopOrdersGrouped): Prisma.OrderWhereInput {
  const stranded: Prisma.OrderWhereInput = {
    printJobs: { some: { supersededAt: null, status: "WAITING", blockedReason: { not: null } } },
  };
  if (group === "needsAttention") {
    return {
      OR: [
        { orderStatus: { in: statusesInGroup("needsAttention") } },
        { orderStatus: { in: statusesInGroup("printing") }, ...stranded },
        QR_AWAITING_PAYMENT,
      ],
    };
  }
  if (group === "printing") {
    return { orderStatus: { in: statusesInGroup("printing") }, NOT: stranded };
  }
  return { orderStatus: { in: statusesInGroup(group) } };
}

/** 23.6: bounds of the legacy grouped list (see listGrouped). */
export const LIVE_QUEUE_CAP = 1000;
export const HISTORY_GROUP_CAP = 200;

export const SHOP_VISIBLE_STATUSES = (Object.keys(GROUP_BY_STATUS) as OrderStatus[]).filter(
  (status) => GROUP_BY_STATUS[status] !== "hidden",
);

/** 24.1: every order a shop can see -- SHOP_VISIBLE_STATUSES plus QR orders
 * awaiting payment -- optionally narrowed to one status (the search filter).
 * A status filter of UPLOADED therefore finds only QR orders, never a
 * customer's mid-checkout one. */
export function shopVisibleWhere(status?: OrderStatus): Prisma.OrderWhereInput {
  const statuses = status
    ? SHOP_VISIBLE_STATUSES.filter((visible) => visible === status)
    : SHOP_VISIBLE_STATUSES;
  const qr = !status || status === QR_AWAITING_PAYMENT.orderStatus ? [QR_AWAITING_PAYMENT] : [];
  return { OR: [{ orderStatus: { in: statuses } }, ...qr] };
}

/** 23.16: the rule version stored in an order's own pricing snapshot, if any. */
function pricingRuleVersionOf(snapshot: unknown): number | null {
  const version = (snapshot as { pricingRuleVersion?: unknown } | null)?.pricingRuleVersion;
  return typeof version === "number" && Number.isInteger(version) ? version : null;
}

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
    private readonly shopPlan: ShopPlanService,
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
      findMany: (args: { where: Prisma.OrderWhereInput; take?: number; skip?: number }) =>
        prisma.order.findMany({
          where: args.where,
          include: SHOP_ORDER_INCLUDE,
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          take: args.take,
          skip: args.skip,
        }),
      count: (args: { where: Prisma.OrderWhereInput }) => prisma.order.count({ where: args.where }),
      findFirst: (args: { where: Prisma.OrderWhereInput }) =>
        prisma.order.findFirst({ where: args.where, include: SHOP_ORDER_INCLUDE }),
    });
  }

  /** 23.6 (PRD 43/44): search + filters over one shop's orders, always a page, newest
   * first. Membership is checked like listGrouped's; every predicate is ANDed onto the
   * repository's mandatory shopId. Search terms are LIKE-escaped bound parameters. Only
   * shop-visible statuses are ever returned (never a customer's DRAFT). */
  async search(
    requestingUserId: string,
    query: SearchShopOrdersQueryInput,
  ): Promise<Page<ShopOrderResponse>> {
    const { shopId } = query;
    if (!(await this.shopMembership.isActiveStaff(shopId, requestingUserId))) {
      throw new ForbiddenException("You do not have access to this shop's orders.");
    }

    const and: Prisma.OrderWhereInput[] = [shopVisibleWhere(query.status)];
    if (query.paymentStatus) and.push({ paymentStatus: query.paymentStatus });
    if (query.from || query.to) {
      and.push({
        createdAt: {
          ...(query.from ? { gte: query.from } : {}),
          ...(query.to ? { lte: query.to } : {}),
        },
      });
    }
    if (query.customerId) and.push({ customerRecordId: query.customerId });
    if (
      query.printerId !== undefined ||
      query.operatorId !== undefined ||
      query.priority !== undefined
    ) {
      // One live job must satisfy every job filter together.
      and.push({
        printJobs: {
          some: {
            supersededAt: null,
            ...(query.printerId ? { printerId: query.printerId } : {}),
            ...(query.operatorId ? { operatorId: query.operatorId } : {}),
            ...(query.priority !== undefined ? { priority: query.priority } : {}),
          },
        },
      });
    }
    if (query.q) {
      const term = query.q;
      and.push({
        OR: [
          { publicOrderNumber: ilike(term) },
          { document: { filename: ilike(term) } },
          { items: { some: { document: { filename: ilike(term) } } } },
          {
            customerRecord: {
              OR: [{ name: ilike(term) }, { phone: ilike(term) }, { email: ilike(term) }],
            },
          },
          // A counter order's customerId is the STAFF account that keyed it in, so the
          // account is only a customer identity for self-service orders.
          {
            creationSource: OrderCreationSource.CUSTOMER_WEB,
            customer: {
              OR: [{ name: ilike(term) }, { email: ilike(term) }, { phone: ilike(term) }],
            },
          },
        ],
      });
    }
    const where: Prisma.OrderWhereInput = { AND: and };

    const [orders, total] = await Promise.all([
      this.repository.findMany(shopId, where, { take: query.limit, skip: query.offset }),
      this.repository.count(shopId, where),
    ]);
    return {
      items: orders.map((order) => this.toResponse(order)),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  /** §82: no route param to resolve a shop id from here (this is a
   * list, not one resource), so the membership check that ShopScopeGuard
   * would otherwise run is done directly against the caller-supplied
   * `shopId` before the scoped query ever runs. Mirrors ShopScopeGuard's
   * own choice of 403 (never 404) for both "not a member" and "this
   * shop doesn't exist at all" -- distinguishing the two would leak
   * which shop ids are real to a caller with no business knowing. */
  async listGrouped(
    requestingUserId: string,
    query: ListShopOrdersQueryInput,
  ): Promise<ShopOrdersGrouped | Page<ShopOrderResponse>> {
    const { shopId } = query;
    const isMember = await this.shopMembership.isActiveStaff(shopId, requestingUserId);
    if (!isMember) {
      throw new ForbiddenException("You do not have access to this shop's orders.");
    }

    const pagination = resolvePagination(query);
    if (query.group || pagination.paged) {
      // 23.6: one flat page, newest first, of one group (or of every visible order).
      const where: Prisma.OrderWhereInput = query.group
        ? whereInGroup(query.group)
        : shopVisibleWhere();
      const [orders, total] = await Promise.all([
        this.repository.findMany(shopId, where, { take: pagination.take, skip: pagination.skip }),
        this.repository.count(shopId, where),
      ]);
      return {
        items: orders.map((order) => this.toResponse(order)),
        total,
        limit: pagination.limit,
        offset: pagination.offset,
      };
    }

    // Legacy grouped shape, now bounded: the live queue (needsAttention/printing/ready) is
    // returned whole up to LIVE_QUEUE_CAP, while the two ever-growing history groups
    // (completed, failed) are the newest HISTORY_GROUP_CAP each.
    const [live, completed, failed] = await Promise.all([
      this.repository.findMany(
        shopId,
        {
          OR: [
            { orderStatus: { in: statusesInGroup("needsAttention", "printing", "ready") } },
            // 24.1: groupForOrder puts these in needsAttention (rule 4).
            QR_AWAITING_PAYMENT,
          ],
        },
        { take: LIVE_QUEUE_CAP },
      ),
      this.repository.findMany(
        shopId,
        { orderStatus: { in: statusesInGroup("completed") } },
        { take: HISTORY_GROUP_CAP },
      ),
      this.repository.findMany(
        shopId,
        { orderStatus: { in: statusesInGroup("failed") } },
        { take: HISTORY_GROUP_CAP },
      ),
    ]);

    const grouped: ShopOrdersGrouped = {
      needsAttention: [],
      printing: [],
      ready: [],
      completed: [],
      failed: [],
    };
    for (const order of [...live, ...completed, ...failed]) {
      const group = groupForOrder(order.orderStatus, order.printJobs, order.creationSource);
      if (group && group !== "hidden") {
        grouped[group].push(this.toResponse(order));
      }
    }
    // Merged from three queries, so restore the list's newest-first order per group.
    for (const orders of Object.values(grouped) as ShopOrderResponse[][]) {
      orders.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
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
  async getOrder(orderId: string): Promise<ShopOrderDetailResponse> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: SHOP_ORDER_DETAIL_INCLUDE,
    });
    if (!order) {
      throw new NotFoundException("Order not found.");
    }
    return this.toDetailResponse(order);
  }

  /** 23.13: the order's timeline for staff (VIEW_ORDERS), oldest first, paged. It gathers the
   * audit rows of the order itself and of everything that hangs off it -- every print job
   * (including superseded ones: reassignments, late-print holds, inventory shortfalls and
   * failed consumption are recorded on jobs), its payments, refunds and delivery -- and
   * shows only allowlisted metadata (order-history.ts). The scope is the order id, which
   * ShopScopeGuard has already tied to the caller's business; the id sets are read here
   * from that order only. Uses the (resource_type, resource_id) index.
   *
   * 23.19: staff-typed free text (reasons, notes) is shown only when the caller's role at
   * this business holds MANAGE_DELIVERY -- the roles that may already see the customer's
   * contact details -- because such text can hold a phone number or an address. */
  async getHistory(
    orderId: string,
    query: OrderHistoryQueryInput,
    actorId: string,
  ): Promise<Page<OrderHistoryEvent>> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { shopId: true },
    });
    if (!order?.shopId) {
      throw new NotFoundException("Order not found.");
    }
    const role = await this.shopMembership.getEffectiveRole(order.shopId, actorId);
    const includeFreeText =
      role !== null && (ROLE_PERMISSIONS[role] ?? []).includes(Permission.MANAGE_DELIVERY);
    const [jobs, payments, refunds, delivery] = await Promise.all([
      this.prisma.printJob.findMany({ where: { orderId }, select: { id: true } }),
      this.prisma.payment.findMany({ where: { orderId }, select: { id: true } }),
      this.prisma.refund.findMany({ where: { orderId }, select: { id: true } }),
      this.prisma.orderDelivery.findUnique({ where: { orderId }, select: { id: true } }),
    ]);
    const where: Prisma.AuditLogWhereInput = {
      OR: [
        { resourceType: "order", resourceId: orderId },
        ...(jobs.length
          ? [{ resourceType: "print_job", resourceId: { in: jobs.map((j) => j.id) } }]
          : []),
        ...(payments.length
          ? [{ resourceType: "payment", resourceId: { in: payments.map((p) => p.id) } }]
          : []),
        ...(refunds.length
          ? [{ resourceType: "refund", resourceId: { in: refunds.map((r) => r.id) } }]
          : []),
        ...(delivery ? [{ resourceType: "order_delivery", resourceId: delivery.id }] : []),
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: query.limit,
        skip: query.offset,
        include: { actor: { select: { id: true, name: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        at: row.createdAt,
        action: row.action,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        actor: row.actor,
        metadata: sanitizeHistoryMetadata(row.metadata, { includeFreeText }),
      })),
      total,
      limit: query.limit,
      offset: query.offset,
    };
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
        qualityCheckStatus: true,
        orderStatus: true,
        shop: { select: { multiItemEnabled: true, qualityCheckEnabled: true } },
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

    // 26.3 (Phase 26): shared by every caller of dispatchToPrinter (acceptOrder,
    // retryPrint, changePrinter, resolveUnknownPrint per this method's own doc
    // comment), so one check here blocks every path that creates or re-dispatches
    // a job -- login, dashboards and every non-print route are unaffected (that's
    // the whole point: only the print pipeline itself is gated).
    if (!(await this.shopPlan.isActive(tx, freshOrder.shopId))) {
      throw new AppException(
        HttpStatus.CONFLICT,
        "SHOP_PLAN_EXPIRED",
        "This business's plan has expired. Printing is paused until it's renewed.",
        true,
      );
    }

    await this.syncQualityCheckStatus(tx, orderId, freshOrder);

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

    const { candidates, deviceIdsByPrinterId, automation, rules } = await buildPrinterCandidates(
      tx,
      freshOrder.shopId,
      new Date(),
    );
    // 22.2 (PRD 76/122): naming a printer is manual and always honoured; picking
    // one automatically only happens while automatic assignment is on. Off: the job
    // is created WAITING (AUTOMATION_DISABLED) for staff to assign, in EVERY mode
    // (even multiItemEnabled=false, where a blocked allocation used to be a 409):
    // accepting an order must keep working with automation off.
    const assignmentOff = requestedPrinterId === undefined && !automation.autoPrinterAssignment;
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
      const jp = jobPages(
        draft.printConfiguration,
        pageCount,
        itemQuantity.get(draft.orderItemId),
        logJobPagesFallback({ orderId, orderItemId: draft.orderItemId }),
      );
      const pages = jp.total;
      const attempt = await tx.printJob.count({ where: { orderItemId: draft.orderItemId } });
      const idempotencyToken = `${draft.orderItemId}:${attempt + 1}`;

      // 20.3 (PRD 28): the paper gate is an AUTOMATIC-path check; a staff member
      // naming a printer overrides automation. A no-op (same array back) unless
      // the shop enabled inventory tracking.
      const allocationCandidates =
        requestedPrinterId === undefined
          ? await withPaperAvailability(
              tx,
              freshOrder.shopId,
              candidates,
              paperNeedFor(draft.printConfiguration, jp),
            )
          : candidates;
      const request: AllocationRequest = {
        printConfiguration: draft.printConfiguration,
        pageCount: pages,
        pagesPerCopy: jp.pagesPerCopy,
        allowUnknownCapabilities: requestedPrinterId !== undefined,
        requestedPrinterId,
        rules,
      };
      const allocation: AllocationResult = assignmentOff
        ? { outcome: "BLOCKED", blockedReason: BlockedReason.AUTOMATION_DISABLED }
        : await this.allocateLocked(tx, request, allocationCandidates);

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
      } else if (freshOrder.shop.multiItemEnabled || assignmentOff) {
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

  /** 25.2 (PRD 100: "allocation must avoid assigning one job to multiple printers"):
   * allocate, then lock the chosen printer row (FOR SHARE) and re-read its status, the same
   * re-validation resume and the recovery sweep do. Candidates are read without locks, so
   * without this a printer being taken out of service at the same moment could still be
   * chosen: its disable commits and its queued jobs are moved, then this job commits QUEUED
   * on it, stranded (found by concurrency-100.e2e, 12 accepts racing a disable). With the
   * lock, a disable that committed first is seen here and the item is allocated again
   * without that printer; one that comes second waits for this commit, and its re-evaluation
   * then finds and moves this job. The printer update commits on its own and moves jobs
   * afterwards, so it never holds the printer while waiting for an order lock: no deadlock. */
  private async allocateLocked(
    tx: Prisma.TransactionClient,
    request: AllocationRequest,
    candidates: PrinterCandidate[],
  ): Promise<AllocationResult> {
    // Each pass either returns or rules a printer out (or updates its status), so this ends;
    // the bound only guards against a status that flips on every read.
    for (let pass = 0; ; pass += 1) {
      const allocation = allocatePrinter(request, candidates);
      if (allocation.outcome !== "ALLOCATED" || pass > candidates.length + 1) {
        return allocation;
      }
      // Lock first (bare SELECT id .. FOR SHARE, the same idiom resume and failover already
      // use), THEN re-read through Prisma's own typed client -- never hand-parse a raw row.
      await tx.$queryRaw`SELECT id FROM printers WHERE id = ${allocation.printerId} FOR SHARE`;
      const current = await tx.printer.findUnique({
        where: { id: allocation.printerId },
        select: { status: true },
      });
      const chosen = candidates.find((candidate) => candidate.id === allocation.printerId);
      if (current === null || chosen === undefined) {
        // Deleted meanwhile: never a candidate again in this dispatch.
        const index = candidates.findIndex((candidate) => candidate.id === allocation.printerId);
        if (index >= 0) candidates.splice(index, 1);
        continue;
      }
      if (current.status === chosen.status) {
        return allocation;
      }
      // Changed since it was read: allocate again with the status as it is now (the same
      // candidate list later items in this dispatch use, so they see it too).
      chosen.status = current.status;
    }
  }

  /** 21.3 (§68): new production work on an order needs a (fresh) quality check
   * when the shop runs them. Flag ON: anything but PENDING becomes PENDING (a
   * retry after a failed check, a reprint). Flag OFF: only a stale PENDING/FAILED
   * (the shop turned QC off mid-flight) is released back to NOT_REQUIRED, so an
   * order that was never QC'd is never written: byte-identical to before 21.3.
   * Writes qualityCheckStatus only, never order_status. */
  private async syncQualityCheckStatus(
    tx: Prisma.TransactionClient,
    orderId: string,
    order: {
      qualityCheckStatus: string | null;
      orderStatus: OrderStatus;
      shop: { qualityCheckEnabled: boolean };
    },
  ): Promise<void> {
    // 21.7: an order already released (READY_FOR_COLLECTION/COMPLETED) is past its
    // quality check and the order machine no longer re-derives it from its jobs, so
    // a reprint there must not flip the recorded result to a PENDING nothing clears.
    if (
      order.orderStatus === OrderStatus.READY_FOR_COLLECTION ||
      order.orderStatus === OrderStatus.COMPLETED
    ) {
      return;
    }
    const current = order.qualityCheckStatus ?? QualityCheckStatus.NOT_REQUIRED;
    let next: string | null = null;
    if (order.shop.qualityCheckEnabled) {
      if (current !== QualityCheckStatus.PENDING) {
        next = QualityCheckStatus.PENDING;
      }
    } else if (current === QualityCheckStatus.PENDING || current === QualityCheckStatus.FAILED) {
      next = QualityCheckStatus.NOT_REQUIRED;
    }
    if (next !== null) {
      await tx.order.update({ where: { id: orderId }, data: { qualityCheckStatus: next } });
    }
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
          : allocation.blockedReason === "NO_PAPER"
            ? "No printer is available to accept this order: the required paper is out of stock."
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
    failure?: { reason?: JobFailureReason; note?: string },
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
    let accruedPrinterId: string | undefined;
    try {
      // One transaction, orders row locked first: the job write, (for RETRY)
      // the replacement dispatch, and the order sync commit together. Never a
      // 200 when nothing was resolved: a job that is no longer UNKNOWN is a
      // 409 like any other lost race.
      const resolved = await this.jobStateMachine.transition(
        target.id,
        event,
        { id: actorId },
        {
          metadata: {
            resolution,
            ...(failure?.reason ? { failureReason: failure.reason } : {}),
          },
          ...(resolution === "MARK_FAILED" && failure?.reason
            ? { failureReason: failure.reason, failureNote: failure.note ?? null }
            : {}),
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
      accruedPrinterId = resolved.accruedPrinterId;
    } catch (error) {
      if (error instanceof AppException && error.errorCode === "ILLEGAL_JOB_TRANSITION") {
        throw illegal("This print job is no longer awaiting resolution.");
      }
      throw error;
    }

    await this.notifyDevices(notifyDeviceIds);
    // 19.3/19.4: staff confirming UNKNOWN as printed accrued usage; a
    // limit-enabled printer may no longer fit its queue.
    if (accruedPrinterId) {
      await this.agentJobsService.onUsageAccrued(accruedPrinterId);
    }
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
    // 21.3 (§69): with quality checking on, the check must be completed before
    // the order can be released. The order waits in QUALITY_CHECK (MARK_READY is
    // not legal there) and this names the reason instead of a bare illegal-
    // transition; the state machine stays the authority.
    // 21.7: only while the shop still runs quality checks (turning QC off must
    // unblock a stale PENDING).
    const current = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        orderStatus: true,
        qualityCheckStatus: true,
        shop: { select: { qualityCheckEnabled: true } },
      },
    });
    if (
      current?.orderStatus === OrderStatus.QUALITY_CHECK ||
      (current?.orderStatus === OrderStatus.PRINTED &&
        current.shop.qualityCheckEnabled &&
        current.qualityCheckStatus === QualityCheckStatus.PENDING)
    ) {
      throw new AppException(
        HttpStatus.CONFLICT,
        "QUALITY_CHECK_REQUIRED",
        "This order must pass its quality check before it can be marked ready.",
        false,
      );
    }
    await this.orderStateMachine.transition(orderId, OrderEvent.MARK_READY, { id: actorId });
    return this.getOrder(orderId);
  }

  /** 21.3 (§68/69): the verdict on an order waiting in QUALITY_CHECK, through
   * the order machine's own QC_PASS / QC_FAIL / QC_REPRINT events (legal only
   * from QUALITY_CHECK, and serialised by its orders-row lock, so two concurrent
   * verdicts yield one winner and a clean 409). The recorded qualityCheckStatus
   * changes in the same transaction as the transition, so aggregateOrderStatus
   * (which reads it) agrees with the order from then on.
   *
   * NEEDS_REPRINT creates NEW jobs for the named (default: all) printed jobs'
   * items through the normal allocation path (dispatchToPrinter: new attempt,
   * new idempotency token), leaving the originals PRINTED and unsuperseded. */
  async recordQualityCheck(
    orderId: string,
    actorId: string,
    input: QualityCheckInput,
  ): Promise<ShopOrderResponse> {
    const metadata = { ...(input.note ? { note: input.note } : {}) };
    if (input.result === "PASSED" || input.result === "FAILED") {
      const passed = input.result === "PASSED";
      await this.orderStateMachine.transition(
        orderId,
        passed ? OrderEvent.QC_PASS : OrderEvent.QC_FAIL,
        { id: actorId },
        {
          metadata,
          sideEffect: async (tx) => {
            await tx.order.update({
              where: { id: orderId },
              data: {
                qualityCheckStatus: passed ? QualityCheckStatus.PASSED : QualityCheckStatus.FAILED,
              },
            });
          },
        },
      );
      return this.getOrder(orderId);
    }

    let notifyDeviceIds: string[] = [];
    await this.orderStateMachine.transition(
      orderId,
      OrderEvent.QC_REPRINT,
      { id: actorId },
      {
        metadata: { ...metadata, ...(input.jobIds ? { jobIds: input.jobIds } : {}) },
        sideEffect: async (tx) => {
          const originals = await this.qualityCheckReprintJobs(tx, orderId, input.jobIds);
          notifyDeviceIds = (
            await this.createReprintsWithin(tx, orderId, actorId, originals, {
              reason: input.reprintReason ?? "POOR_QUALITY",
              note: input.note,
              additionalCostMinor: input.additionalCostMinor ?? 0,
              source: "QUALITY_CHECK",
            })
          ).notifyDeviceIds;
        },
      },
    );
    await this.notifyDevices(notifyDeviceIds);
    return this.getOrder(orderId);
  }

  /** The jobs a NEEDS_REPRINT verdict reprints: the named ones (each must be a
   * printed, unsuperseded job of this order), or by default the newest printed job
   * of every item (a job that already has a reprint is superseded by its own
   * reprint in a chain, so it is left out). */
  private async qualityCheckReprintJobs(
    tx: Prisma.TransactionClient,
    orderId: string,
    jobIds: string[] | undefined,
  ): Promise<string[]> {
    const printed = await tx.printJob.findMany({
      where: { orderId, supersededAt: null, status: PrintJobStatus.PRINTED },
      select: { id: true, reprintedAs: { select: { id: true } } },
    });
    const chosen = jobIds
      ? printed.filter((job) => jobIds.includes(job.id))
      : printed.filter((job) => job.reprintedAs === null);
    if (chosen.length === 0 || (jobIds && chosen.length !== new Set(jobIds).size)) {
      throw new AppException(
        HttpStatus.CONFLICT,
        "REPRINT_JOB_INVALID",
        "Every job to reprint must be a printed job of this order.",
        false,
      );
    }
    return chosen.map((job) => job.id);
  }

  /** 21.4 (§67): the reprint core. The CALLER holds the orders-row lock (the
   * order machine's transition or lockOrderStatus), so everything below is
   * serialised per order and no lock order is inverted. Each original must be a
   * settled PRINTED, unsuperseded job of this order (never a job that might still
   * be printing or whose outcome is unknown: duplicate printing is the cardinal
   * rule), must not already have been reprinted, and its item must have no
   * attempt still in flight. The new jobs come from the SAME allocation path as
   * accept/retry (dispatchToPrinter: new attempt, new idempotency token); the
   * originals are never written. The link row's UNIQUE(original_job_id) is the
   * database-level backstop behind the application checks. */
  async createReprintsWithin(
    tx: Prisma.TransactionClient,
    orderId: string,
    actorId: string,
    originalJobIds: string[],
    detail: {
      reason: ReprintReason;
      note?: string;
      additionalCostMinor: number;
      source: "STAFF" | "QUALITY_CHECK";
      printerId?: string;
    },
  ): Promise<{
    notifyDeviceIds: string[];
    reprints: Array<{ id: string; originalJobId: string; reprintJobId: string }>;
  }> {
    const invalid = (message: string) =>
      new AppException(HttpStatus.CONFLICT, "REPRINT_JOB_INVALID", message, false);
    const ids = [...new Set(originalJobIds)].sort();
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        orderId: string;
        orderItemId: string | null;
        status: PrintJobStatus;
        supersededAt: Date | null;
      }>
    >`
      SELECT id, order_id AS "orderId", order_item_id AS "orderItemId", status,
             superseded_at AS "supersededAt"
      FROM print_jobs WHERE id = ANY(${ids}::text[]) ORDER BY id FOR UPDATE
    `;
    if (rows.length !== ids.length) {
      throw invalid("The job to reprint was not found.");
    }
    for (const row of rows) {
      if (row.orderId !== orderId) {
        throw invalid("The job to reprint does not belong to this order.");
      }
      if (row.status !== PrintJobStatus.PRINTED || row.supersededAt !== null) {
        throw invalid(
          `Only a printed job can be reprinted; this one is ${row.status}${row.supersededAt ? " (superseded)" : ""}.`,
        );
      }
      if (!row.orderItemId) {
        throw invalid("This job has no order item to reprint.");
      }
    }
    const itemIds = rows.map((row) => row.orderItemId as string);
    if (new Set(itemIds).size !== itemIds.length) {
      throw invalid("Two of the named jobs are for the same item; reprint only the latest.");
    }

    const already = await tx.printJobReprint.count({ where: { originalJobId: { in: ids } } });
    if (already > 0) {
      throw new AppException(
        HttpStatus.CONFLICT,
        "REPRINT_ALREADY_EXISTS",
        "This job has already been reprinted; reprint the reprint if it is still not right.",
        false,
      );
    }
    const inFlight = await tx.printJob.count({
      where: {
        orderItemId: { in: itemIds },
        supersededAt: null,
        status: { in: REPRINT_BLOCKING_JOB_STATUSES },
      },
    });
    if (inFlight > 0) {
      throw new AppException(
        HttpStatus.CONFLICT,
        "REPRINT_ITEM_IN_PROGRESS",
        "Another attempt for this item is still in progress; wait for it to finish first.",
        false,
      );
    }

    const attemptsBefore = new Map<string, number>();
    for (const itemId of itemIds) {
      attemptsBefore.set(itemId, await tx.printJob.count({ where: { orderItemId: itemId } }));
    }
    const { notifyDeviceIds } = await this.dispatchToPrinter(
      tx,
      orderId,
      detail.printerId,
      new Set(itemIds),
    );

    const shopId = (await tx.order.findUniqueOrThrow({ where: { id: orderId } })).shopId;
    const reprints: Array<{ id: string; originalJobId: string; reprintJobId: string }> = [];
    for (const row of rows) {
      const created = await tx.printJob.findFirstOrThrow({
        where: {
          orderId,
          orderItemId: row.orderItemId,
          attempt: (attemptsBefore.get(row.orderItemId as string) ?? 0) + 1,
        },
        select: { id: true },
      });
      const link = await tx.printJobReprint.create({
        data: {
          shopId,
          orderId,
          originalJobId: row.id,
          reprintJobId: created.id,
          reason: detail.reason,
          note: detail.note ?? null,
          requestedBy: actorId,
          additionalCostMinor: detail.additionalCostMinor,
          source: detail.source,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: "JOB_REPRINT_CREATED",
          resourceType: "print_job",
          resourceId: created.id,
          metadata: {
            originalJobId: row.id,
            reason: detail.reason,
            additionalCostMinor: detail.additionalCostMinor,
            source: detail.source,
            orderId,
            ...(detail.note ? { note: detail.note } : {}),
          },
        },
      });
      reprints.push({ id: link.id, originalJobId: row.id, reprintJobId: created.id });
    }
    return { notifyDeviceIds, reprints };
  }

  /** 21.4 (§67): reprint one printed job. One transaction under the orders-row
   * lock (like retry/change-printer): validate, create the new job through the
   * allocation path, record the link, re-derive the order. Two concurrent requests
   * for the same job serialise on that lock and the second gets a clean 409; a
   * unique violation that slips through anyway (the DB backstop) is mapped to the
   * same 409 and rolls the whole request back. Closed orders are refused. */
  async reprintJob(
    jobId: string,
    actorId: string,
    input: {
      reason: ReprintReason;
      note?: string;
      additionalCostMinor?: number;
      printerId?: string;
    },
  ): Promise<ReprintResponse> {
    const found = await this.prisma.printJob.findUnique({
      where: { id: jobId },
      select: { orderId: true },
    });
    if (!found) {
      throw new NotFoundException("Print job not found.");
    }
    let notifyDeviceIds: string[] = [];
    let pendingEmail: SendEmailJob | undefined;
    let reprintId = "";
    try {
      await this.prisma.$transaction(
        async (tx) => {
          const status = await this.lockOrderStatus(tx, found.orderId);
          if (!REPRINTABLE_ORDER_STATUSES.has(status)) {
            throw new AppException(
              HttpStatus.CONFLICT,
              "ORDER_NOT_REPRINTABLE",
              `An order in ${status} cannot have a job reprinted.`,
              false,
            );
          }
          const created = await this.createReprintsWithin(tx, found.orderId, actorId, [jobId], {
            reason: input.reason,
            note: input.note,
            additionalCostMinor: input.additionalCostMinor ?? 0,
            source: "STAFF",
            printerId: input.printerId,
          });
          notifyDeviceIds = created.notifyDeviceIds;
          reprintId = created.reprints[0]!.id;
          pendingEmail = await this.syncOrderWithin(tx, found.orderId, actorId);
        },
        { maxWait: 10_000, timeout: 10_000 },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AppException(
          HttpStatus.CONFLICT,
          "REPRINT_ALREADY_EXISTS",
          "This job was reprinted concurrently; refresh and check the order.",
          true,
        );
      }
      throw error;
    }
    await this.orderStateMachine.enqueuePendingEmail(pendingEmail);
    await this.notifyDevices(notifyDeviceIds);

    const link = await this.prisma.printJobReprint.findUniqueOrThrow({
      where: { id: reprintId },
      include: { reprintJob: { include: { printer: { select: { name: true } } } } },
    });
    return {
      reprintId: link.id,
      originalJobId: link.originalJobId,
      reason: link.reason,
      note: link.note,
      additionalCostMinor: link.additionalCostMinor,
      requestedBy: link.requestedBy,
      createdAt: link.createdAt,
      job: {
        id: link.reprintJob.id,
        orderId: link.reprintJob.orderId,
        status: link.reprintJob.status,
        printerId: link.reprintJob.printerId,
        printerName: link.reprintJob.printer?.name ?? null,
        blockedReason: link.reprintJob.blockedReason,
        attempt: link.reprintJob.attempt,
      },
    };
  }

  async completeOrder(orderId: string, actorId: string): Promise<ShopOrderResponse> {
    // 21.7: a live reprint (or any unfinished job) blocks completion. Checked inside
    // the transition, under the orders-row lock reprintJob also takes, so COMPLETE
    // and a reprint cannot both win.
    await this.orderStateMachine.transition(
      orderId,
      OrderEvent.COMPLETE,
      { id: actorId },
      {
        sideEffect: async (tx) => {
          const live = await tx.printJob.count({
            where: {
              orderId,
              supersededAt: null,
              status: { in: REPRINT_BLOCKING_JOB_STATUSES },
            },
          });
          if (live > 0) {
            throw new AppException(
              HttpStatus.CONFLICT,
              "REPRINT_IN_PROGRESS",
              "A reprint (or another job) for this order is still in progress; complete the order once it has printed.",
              false,
            );
          }
        },
      },
    );
    this.logger.log({ metric: "order.completed", orderId }, "Order completed.");
    return this.getOrder(orderId);
  }

  /** 23.13: the list shape plus items, contact and payment. */
  private toDetailResponse(order: ShopOrderDetailWithRelations): ShopOrderDetailResponse {
    const base = this.toResponse(order);
    const quoteTotal =
      (order.pricingSnapshot as { quote?: { totalMinor?: number } } | null)?.quote?.totalMinor ??
      null;
    const config = order.printConfiguration as { copies?: number } | null;

    const items: ShopOrderItemSummary[] =
      order.items.length > 0
        ? order.items.map((item) => {
            const own = (item.pricingSnapshot as { totalMinor?: number } | null)?.totalMinor;
            return {
              id: item.id,
              sequence: item.sequence,
              itemType: item.itemType,
              required: item.required,
              documentName: item.document.filename,
              quantity: item.quantity,
              printConfiguration: item.printConfiguration,
              status: order.printJobs.find((job) => job.orderItemId === item.id)?.status ?? null,
              priceMinor: own ?? (order.items.length === 1 ? quoteTotal : null),
            };
          })
        : [
            // Before acceptance no order_items row exists yet (dispatch creates it): show the
            // order's own single document so the screen has a line to render.
            {
              id: null,
              sequence: 0,
              itemType: OrderItemType.PRINT,
              required: true,
              documentName: order.document.filename,
              quantity: config?.copies ?? 1,
              printConfiguration: order.printConfiguration,
              status: order.printJobs[0]?.status ?? null,
              priceMinor: quoteTotal,
            },
          ];

    const moneyStates: PaymentStatus[] = [
      PaymentStatus.PAID,
      PaymentStatus.REFUND_PENDING,
      PaymentStatus.REFUNDED,
      PaymentStatus.REFUND_FAILED,
    ];
    // payments are newest first; the one that became money wins, else the latest attempt.
    const primary = order.payments.find((p) => moneyStates.includes(p.status)) ?? order.payments[0];
    const allRefunds = order.payments.flatMap((p) => p.refunds);

    return {
      ...base,
      items,
      customerContact: order.customerRecord
        ? {
            kind: "WALK_IN",
            name: order.customerRecord.name,
            phone: order.customerRecord.phone,
            email: order.customerRecord.email,
          }
        : order.creationSource === OrderCreationSource.COUNTER
          ? // A counter order with no customer record: `customer` is the STAFF member who
            // placed it, so their phone/email are not the customer's and are not exposed.
            { kind: "WALK_IN", name: order.customer.name, phone: null, email: null }
          : {
              kind: "ACCOUNT",
              name: order.customer.name,
              phone: order.customer.phone,
              email: order.customer.email,
            },
      payment: primary
        ? {
            provider: primary.provider,
            status: primary.status,
            amountMinor: primary.amountMinor,
            currency: primary.currency,
            paidAt: primary.paidAt,
          }
        : null,
      refunds: {
        count: allRefunds.length,
        refundedMinor: allRefunds
          .filter((r) => r.status === PaymentStatus.REFUNDED)
          .reduce((sum, r) => sum + r.amountMinor, 0),
        pendingMinor: allRefunds
          .filter((r) => r.status === PaymentStatus.REFUND_PENDING)
          .reduce((sum, r) => sum + r.amountMinor, 0),
        currency: allRefunds[0]?.currency ?? primary?.currency ?? null,
      },
    };
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
      creationSource: order.creationSource,
      createdAt: order.createdAt,
      printerName: order.printJobs[0]?.printer?.name ?? null,
      qualityCheckStatus: order.qualityCheckStatus,
      delivery: order.delivery ? toDeliveryResponse(order.delivery) : null,
      priority: order.printJobs.reduce((max, job) => Math.max(max, job.priority), 0),
      pricingRuleVersion: pricingRuleVersionOf(order.pricingSnapshot),
      printJobs: order.printJobs.map((job) => ({
        id: job.id,
        status: job.status,
        printerName: job.printer?.name ?? null,
        blockedReason: job.blockedReason,
        failureReason: job.failureReason,
        failureNote: job.failureNote,
        operatorId: job.operator?.id ?? null,
        operatorName: job.operator?.name ?? null,
        attempt: job.attempt,
        priority: job.priority,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        pausedAt: job.pausedAt,
        supersededAt: job.supersededAt,
        reprint: job.reprintOf
          ? {
              originalJobId: job.reprintOf.originalJobId,
              reason: job.reprintOf.reason,
              additionalCostMinor: job.reprintOf.additionalCostMinor,
            }
          : null,
      })),
    };
  }
}
