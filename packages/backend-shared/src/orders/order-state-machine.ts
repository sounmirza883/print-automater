import { Injectable, HttpStatus, NotFoundException } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import {
  NotificationChannel,
  OrderStatus,
  type NotificationType,
  type Prisma,
} from "@prisma/client";
import { QualityCheckStatus } from "@print-automated/types";
import { PrismaService } from "../prisma/prisma.service.js";
import { redactMetadata } from "../audit/redact-metadata.js";
import { AppException } from "../errors/app-exception.js";
import { buildNotificationContent } from "../notifications/notification-content.js";
import { QUEUE_NAMES } from "../queues/queue-names.js";
import type { SendEmailJob } from "../queues/send-email.job.js";
import { aggregateOrderStatus } from "./aggregate-order-status.js";

/** Every event this machine accepts. Not shared with any client bundle
 * (packages/types' `OrderStatus` is the public-facing state; the
 * events that move between them are purely a server-side transition
 * vocabulary), so it lives here in backend-shared rather than a
 * client-facing package -- both services/api (order creation, cancel)
 * and services/worker (5.6's expiration sweep) transition orders, so
 * "shared", for this class, means shared between server processes, not
 * shared with a browser or the Expo app.
 *
 * 18.2: the eight job-driven events from Phases 6-10
 * (START_PRINT/FINISH_PRINT/FAIL_PRINT/LOSE_PRINT_STATUS/RETRY_PRINT/
 * RESOLVE_UNKNOWN_PRINTED/RESOLVE_UNKNOWN_RETRY/RESOLVE_UNKNOWN_FAILED)
 * are deleted -- print_jobs.status is now PrintJobStateMachine's own
 * business (packages/backend-shared/src/print-jobs/), and everything
 * they used to drive on the order side happens through the single
 * SYNC_JOBS event instead, whose target is *computed*
 * (aggregateOrderStatus), not looked up in a fixed table entry like
 * every other event here. QC_PASS/QC_FAIL/QC_REPRINT are the staff-
 * facing exits from QUALITY_CHECK; 21.3 builds the real workflow UI
 * around them, this phase only needs them to exist and be legal. */
export const OrderEvent = {
  CONFIRM_UPLOAD: "CONFIRM_UPLOAD",
  REQUEST_PAYMENT: "REQUEST_PAYMENT",
  CONFIRM_PAYMENT: "CONFIRM_PAYMENT",
  FAIL_PAYMENT: "FAIL_PAYMENT",
  ROUTE_TO_SHOP: "ROUTE_TO_SHOP",
  SHOP_ACCEPT: "SHOP_ACCEPT",
  SHOP_REJECT: "SHOP_REJECT",
  QUEUE_PRINT: "QUEUE_PRINT",
  SYNC_JOBS: "SYNC_JOBS",
  QC_PASS: "QC_PASS",
  QC_FAIL: "QC_FAIL",
  QC_REPRINT: "QC_REPRINT",
  MARK_READY: "MARK_READY",
  COMPLETE: "COMPLETE",
  CANCEL: "CANCEL",
  EXPIRE: "EXPIRE",
} as const;
export type OrderEvent = (typeof OrderEvent)[keyof typeof OrderEvent];

/** 18.2: the nine progress/attention statuses SYNC_JOBS is legal
 * between -- deliberately excludes READY_FOR_COLLECTION, COMPLETED,
 * CANCELLED, EXPIRED and SHOP_REJECTED. A late job report (a straggler
 * agent finally reporting PRINTED after staff already marked the order
 * ready, or after a customer's order was cancelled) must never
 * resurrect an order a human -- or an earlier, legitimate machine step
 * -- already closed out. Callers that fire SYNC_JOBS speculatively
 * (every job-status report is a candidate) are expected to swallow the
 * resulting ILLEGAL_ORDER_TRANSITION the same "already done" way every
 * other self-healing call site in this codebase already does. */
const DERIVED_STATUSES: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.QUEUED_FOR_PRINT,
  OrderStatus.PRINTING,
  OrderStatus.PRINTED,
  OrderStatus.PRINT_FAILED,
  OrderStatus.PRINT_STATUS_UNKNOWN,
  OrderStatus.PREPARING,
  OrderStatus.ASSIGNED,
  OrderStatus.PAUSED,
  OrderStatus.QUALITY_CHECK,
]);

/** §25's linear happy path, plus the failure/side branches §26, §79,
 * §108, §109, §110 and 10.2-10.4 each call for. A state with no entry
 * here is terminal -- every event thrown at it is illegal. Cancellation
 * (§79) is deliberately narrow: the plan's own 5.4 scope limits it to
 * `PAYMENT_PENDING`/`WAITING_FOR_SHOP` ("refused from PRINTING
 * onward") -- `SHOP_ACCEPTED` and `QUEUED_FOR_PRINT` are not in that
 * allowed set either, so CANCEL is illegal there too, not just from
 * PRINTING forward.
 *
 * 18.2: every one of the nine DERIVED_STATUSES above now has an EMPTY
 * (or, for PRINTED/QUALITY_CHECK, a deliberately narrow) entry here --
 * their real transitions all happen through SYNC_JOBS, which is
 * special-cased in applyLocked() below rather than looked up in this
 * table at all, since its target is computed per-call, not fixed per
 * event. PRINTED keeps MARK_READY (a genuine staff action, not
 * job-driven); QUALITY_CHECK keeps its three QC_* exits. */
const TRANSITIONS: Record<OrderStatus, Partial<Record<OrderEvent, OrderStatus>>> = {
  [OrderStatus.DRAFT]: {
    [OrderEvent.CONFIRM_UPLOAD]: OrderStatus.UPLOADED,
  },
  [OrderStatus.UPLOADED]: {
    [OrderEvent.REQUEST_PAYMENT]: OrderStatus.PAYMENT_PENDING,
  },
  [OrderStatus.PAYMENT_PENDING]: {
    [OrderEvent.CONFIRM_PAYMENT]: OrderStatus.PAID,
    [OrderEvent.FAIL_PAYMENT]: OrderStatus.PAYMENT_FAILED,
    [OrderEvent.CANCEL]: OrderStatus.CANCELLED,
    [OrderEvent.EXPIRE]: OrderStatus.EXPIRED,
  },
  [OrderStatus.PAID]: {
    [OrderEvent.ROUTE_TO_SHOP]: OrderStatus.WAITING_FOR_SHOP,
  },
  [OrderStatus.WAITING_FOR_SHOP]: {
    [OrderEvent.SHOP_ACCEPT]: OrderStatus.SHOP_ACCEPTED,
    [OrderEvent.SHOP_REJECT]: OrderStatus.SHOP_REJECTED,
    [OrderEvent.CANCEL]: OrderStatus.CANCELLED,
  },
  [OrderStatus.SHOP_ACCEPTED]: {
    [OrderEvent.QUEUE_PRINT]: OrderStatus.QUEUED_FOR_PRINT,
  },
  [OrderStatus.QUEUED_FOR_PRINT]: {},
  [OrderStatus.PRINTING]: {},
  [OrderStatus.PRINTED]: {
    [OrderEvent.MARK_READY]: OrderStatus.READY_FOR_COLLECTION,
  },
  [OrderStatus.READY_FOR_COLLECTION]: {
    [OrderEvent.COMPLETE]: OrderStatus.COMPLETED,
  },
  [OrderStatus.COMPLETED]: {},
  [OrderStatus.PAYMENT_FAILED]: {},
  [OrderStatus.SHOP_REJECTED]: {},
  [OrderStatus.PRINT_FAILED]: {},
  [OrderStatus.PRINT_STATUS_UNKNOWN]: {},
  [OrderStatus.CANCELLED]: {},
  [OrderStatus.EXPIRED]: {},
  [OrderStatus.PREPARING]: {},
  [OrderStatus.ASSIGNED]: {},
  [OrderStatus.PAUSED]: {},
  [OrderStatus.QUALITY_CHECK]: {
    [OrderEvent.QC_PASS]: OrderStatus.READY_FOR_COLLECTION,
    [OrderEvent.QC_FAIL]: OrderStatus.PRINT_FAILED,
    [OrderEvent.QC_REPRINT]: OrderStatus.QUEUED_FOR_PRINT,
  },
};

/** §78/7.3: which of an order's transitions are also a customer-facing
 * domain event, for the FIXED-target events. Centralized here, inside
 * the state machine itself, rather than left for every future caller
 * to separately remember to notify on.
 *
 * 18.2: SYNC_JOBS is deliberately absent -- its notification, when one
 * applies, is decided by the TARGET status it computed, via
 * NOTIFICATION_TYPE_BY_DERIVED_TARGET below, not by the event itself. */
const NOTIFICATION_TYPE_BY_EVENT: Partial<Record<OrderEvent, NotificationType>> = {
  [OrderEvent.CONFIRM_PAYMENT]: "PAYMENT_CONFIRMED",
  [OrderEvent.SHOP_ACCEPT]: "ORDER_ACCEPTED",
  [OrderEvent.MARK_READY]: "READY_FOR_COLLECTION",
  [OrderEvent.COMPLETE]: "ORDER_COMPLETED",
  [OrderEvent.SHOP_REJECT]: "ORDER_REJECTED",
  [OrderEvent.QC_PASS]: "READY_FOR_COLLECTION",
};

/** 18.2: replaces the old START_PRINT/FAIL_PRINT/FINISH_PRINT entries
 * in NOTIFICATION_TYPE_BY_EVENT -- keyed by the *computed* SYNC_JOBS
 * target rather than a fixed event, since one event now covers every
 * derived target. Deliberately narrower than "every target that could
 * ever be interesting": a SYNC_JOBS transition whose *source* status is
 * PRINT_STATUS_UNKNOWN never notifies, matching the old system exactly
 * -- none of the three RESOLVE_UNKNOWN_* events were ever wired into
 * NOTIFICATION_TYPE_BY_EVENT, so a staff resolution of an unknown print
 * outcome produced no customer notification then, and must not start
 * producing one now just because it happens to land on a target status
 * (PRINTING/PRINTED/PRINT_FAILED) that DOES notify when reached from
 * anywhere else. This is exactly the kind of behavioural drift
 * single-job-equivalence.e2e-spec.ts (18.10) exists to catch. */
const NOTIFICATION_TYPE_BY_DERIVED_TARGET: Partial<Record<OrderStatus, NotificationType>> = {
  [OrderStatus.PRINTING]: "PRINT_STARTED",
  [OrderStatus.PRINT_FAILED]: "PRINT_FAILED",
  [OrderStatus.PRINTED]: "PRINT_COMPLETED",
};

export interface TransitionActor {
  /** null for system-driven transitions (the 5.6 expiration worker,
   * webhook-driven payment confirmation) that have no human actor. */
  id: string | null;
}

export interface TransitionContext {
  metadata?: Record<string, unknown>;
  /** Runs inside the same row-locked transaction as the status write
   * and its audit row -- a side effect that must be atomic with the
   * transition (e.g. enqueueing the 9.13 print-dispatch job once an
   * order reaches `QUEUED_FOR_PRINT`) belongs here, not after
   * `transition()` returns, where a crash between the two would leave
   * the order's persisted status and its side effect disagreeing. */
  sideEffect?: (tx: Prisma.TransactionClient, next: OrderStatus) => Promise<void>;
}

interface ApplyResult {
  status: OrderStatus;
  pendingEmail?: SendEmailJob;
}

/** The one and only place `orders.order_status` is ever written after
 * creation (enforced by the `no-restricted-syntax` rule in the root
 * eslint config, scoped to every server-side package/app and excluding
 * this file). `SELECT ... FOR UPDATE` first, inside a transaction, so
 * two callers racing the same order -- including 5.6's worker-side
 * expiration sweep racing a customer's own cancel request, two
 * overlapping sweep ticks racing each other, or (18.1 onward)
 * PrintJobStateMachine racing a staff-initiated retry -- serialize on
 * Postgres' own row lock rather than a lost-update race in application
 * code; the same pattern 5.2's order-number counter uses for its own
 * concurrency guarantee, applied here to a row that already exists
 * instead of one being upserted.
 *
 * 18.2 split this into three methods, all still in this one
 * ESLint-excluded file (splitting across files would need a second
 * exclusion entry and defeat the single-writer invariant's whole
 * point): `transition()` (public, unchanged signature, opens its own
 * transaction) / `transitionWithin()` (public, NEW, for a caller that
 * already holds an open transaction and its own row lock -- 18.1's job
 * machine, specifically) / `applyLocked()` (private, the actual
 * legality-lookup+write+audit+notification body, shared by both). */
@Injectable()
export class OrderStateMachine {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.NOTIFICATIONS)
    private readonly notificationsQueue: Queue<SendEmailJob>,
  ) {}

  async transition(
    orderId: string,
    event: OrderEvent,
    actor: TransitionActor,
    ctx: TransitionContext = {},
  ): Promise<OrderStatus> {
    let pendingEmail: SendEmailJob | undefined;

    const next = await this.prisma.$transaction(
      async (tx) => {
        const result = await this.applyLocked(tx, orderId, event, actor, ctx);
        pendingEmail = result.pendingEmail;
        return result.status;
        // Prisma's own interactive-transaction defaults (maxWait: 2000ms
        // to acquire a connection, timeout: 5000ms for the whole
        // transaction) are tuned for isolated calls, not a genuine burst
        // of legitimate concurrent transitions on the same table (many
        // orders expiring in the same 5.6 sweep tick, a payment-webhook
        // spike, or -- 18.1 onward -- several agents reporting different
        // jobs of the same order at once) -- each individual transition
        // here is a handful of fast point queries, never long-running, so
        // generously raising both just gives real bursts room to queue
        // for a connection instead of failing with "unable to start a
        // transaction," without masking an actual stuck transaction (10s
        // is still well short of "hung").
      },
      { maxWait: 10_000, timeout: 10_000 },
    );

    // Outside the transaction, only after it committed -- a job
    // enqueued from inside it could survive a rollback (Redis isn't
    // part of that transaction), and this order's status has now
    // genuinely changed regardless of whether this enqueue itself
    // ever succeeds.
    if (pendingEmail) {
      await this.notificationsQueue.add("send-email", pendingEmail);
    }

    return next;
  }

  /** 18.1: convenience for a caller with NO open transaction of its own
   * (PrintJobStateMachine's own callers -- agent-jobs.service.ts,
   * print-timeout.processor.ts -- typically, once a job transition's
   * `requiresSync` comes back true). Equivalent to
   * `transition(orderId, OrderEvent.SYNC_JOBS, actor, ctx)`, kept as its
   * own distinctly-named method so every SYNC_JOBS call site reads as
   * "syncing the order from its jobs," not a generic, unlabeled
   * transition. */
  async syncFromJobs(
    orderId: string,
    actor: TransitionActor,
    ctx: TransitionContext = {},
  ): Promise<OrderStatus> {
    return this.transition(orderId, OrderEvent.SYNC_JOBS, actor, ctx);
  }

  /** 18.1/18.2: for a caller that already holds an open transaction and
   * has already locked (or is about to lock, in the structurally
   * mandated order -- orders row first) the rows it needs --
   * PrintJobStateMachine, specifically, calling this once it has
   * applied its own job-level write, still inside the same
   * transaction. Returns the pending email rather than enqueueing it
   * itself: only the caller knows when ITS OWN, larger transaction has
   * actually committed. */
  async transitionWithin(
    tx: Prisma.TransactionClient,
    orderId: string,
    event: OrderEvent,
    actor: TransitionActor,
    ctx: TransitionContext = {},
  ): Promise<ApplyResult> {
    return this.applyLocked(tx, orderId, event, actor, ctx);
  }

  private async applyLocked(
    tx: Prisma.TransactionClient,
    orderId: string,
    event: OrderEvent,
    actor: TransitionActor,
    ctx: TransitionContext,
  ): Promise<ApplyResult> {
    const rows = await tx.$queryRaw<Array<{ order_status: OrderStatus }>>`
      SELECT order_status FROM orders WHERE id = ${orderId} FOR UPDATE
    `;
    const current = rows[0]?.order_status;
    if (current === undefined) {
      throw new NotFoundException("Order not found.");
    }

    let nextStatus: OrderStatus;
    if (event === OrderEvent.SYNC_JOBS) {
      nextStatus = await this.resolveSyncTarget(tx, orderId, current);
      if (nextStatus === current) {
        // 18.2's own load-bearing rule: an equal derived target is a
        // genuine no-op -- no write, no audit row, no notification.
        // This is what keeps "one notification per genuine change"
        // true when several concurrent job reports each independently
        // fire SYNC_JOBS for the same order (18.10's concurrency
        // suite): only the caller whose read produces a *different*
        // aggregate ever reaches the write path below.
        return { status: current };
      }
    } else {
      const mapped = TRANSITIONS[current][event];
      if (mapped === undefined) {
        throw new AppException(
          HttpStatus.CONFLICT,
          "ILLEGAL_ORDER_TRANSITION",
          `Cannot apply ${event} to an order in ${current}.`,
          false,
        );
      }
      nextStatus = mapped;
    }

    const updatedOrder = await tx.order.update({
      where: { id: orderId },
      data: {
        orderStatus: nextStatus,
        // §56's own completed_at column, set exactly once here -- the
        // same "centralize it in the one place order_status is ever
        // written" reasoning as the audit row and the notification
        // below: any future path that ever reaches COMPLETED gets this
        // for free, rather than depending on whichever call site
        // happens to remember it.
        ...(nextStatus === OrderStatus.COMPLETED ? { completedAt: new Date() } : {}),
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: `ORDER_${event}`,
        resourceType: "order",
        resourceId: orderId,
        metadata: redactMetadata({
          from: current,
          to: nextStatus,
          ...ctx.metadata,
        }) as Prisma.InputJsonValue,
      },
    });

    // §78/7.3: this transition's own row lock and legality check are
    // what make "exactly one notification per event, no duplicates on
    // transition replay" (7.3's own Done-when) true for free -- this
    // only ever runs once per genuine state change, the same guarantee
    // that already protects the audit row above. SYNC_JOBS additionally
    // never notifies when its SOURCE was PRINT_STATUS_UNKNOWN -- see
    // NOTIFICATION_TYPE_BY_DERIVED_TARGET's own comment.
    const notificationType =
      event === OrderEvent.SYNC_JOBS
        ? current === OrderStatus.PRINT_STATUS_UNKNOWN
          ? undefined
          : NOTIFICATION_TYPE_BY_DERIVED_TARGET[nextStatus]
        : NOTIFICATION_TYPE_BY_EVENT[event];

    let pendingEmail: SendEmailJob | undefined;
    if (notificationType) {
      const recipient = await tx.user.findUniqueOrThrow({
        where: { id: updatedOrder.customerId },
        select: { email: true },
      });
      const content = buildNotificationContent(notificationType, updatedOrder.publicOrderNumber);

      await tx.notification.create({
        data: {
          userId: updatedOrder.customerId,
          orderId,
          type: notificationType,
          channel: NotificationChannel.APP,
          payload: content as unknown as Prisma.InputJsonValue,
          sentAt: new Date(),
        },
      });
      const emailNotification = await tx.notification.create({
        data: {
          userId: updatedOrder.customerId,
          orderId,
          type: notificationType,
          channel: NotificationChannel.EMAIL,
          payload: content as unknown as Prisma.InputJsonValue,
        },
      });
      pendingEmail = {
        to: recipient.email,
        subject: content.subject,
        text: content.text,
        notificationId: emailNotification.id,
      };
    }

    if (ctx.sideEffect) {
      await ctx.sideEffect(tx, nextStatus);
    }

    return { status: nextStatus, pendingEmail };
  }

  /** 18.2: SYNC_JOBS's target is computed, not looked up -- illegal
   * (throws) unless `current` is one of the nine DERIVED_STATUSES; the
   * pure aggregateOrderStatus() then decides the target from a fresh,
   * lock-protected read of this order's own non-superseded jobs.
   * `null` (aggregateOrderStatus's own "no signal" case -- an empty or
   * entirely-cancelled job set) is treated as "stay put," the same as
   * an equal target: there is nothing yet to derive a status change
   * from. */
  private async resolveSyncTarget(
    tx: Prisma.TransactionClient,
    orderId: string,
    current: OrderStatus,
  ): Promise<OrderStatus> {
    if (!DERIVED_STATUSES.has(current)) {
      throw new AppException(
        HttpStatus.CONFLICT,
        "ILLEGAL_ORDER_TRANSITION",
        `Cannot apply SYNC_JOBS to an order in ${current}.`,
        false,
      );
    }

    const [order, jobs] = await Promise.all([
      tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { qualityCheckStatus: true } }),
      tx.printJob.findMany({
        where: { orderId, supersededAt: null },
        select: { status: true, orderItem: { select: { required: true } } },
      }),
    ]);

    const target = aggregateOrderStatus(
      jobs.map((job) => ({ status: job.status, required: job.orderItem?.required ?? true })),
      {
        qualityCheck: (order.qualityCheckStatus ??
          QualityCheckStatus.NOT_REQUIRED) as QualityCheckStatus,
      },
    );

    return target ?? current;
  }
}
