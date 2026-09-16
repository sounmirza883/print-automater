import { Injectable, HttpStatus, NotFoundException } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import {
  NotificationChannel,
  OrderStatus,
  type NotificationType,
  type Prisma,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { redactMetadata } from "../audit/redact-metadata.js";
import { AppException } from "../errors/app-exception.js";
import { buildNotificationContent } from "../notifications/notification-content.js";
import { QUEUE_NAMES } from "../queues/queue-names.js";
import type { SendEmailJob } from "../queues/send-email.job.js";

/** Every event this machine accepts. Not shared with any client bundle
 * (packages/types' `OrderStatus` is the public-facing state; the
 * events that move between them are purely a server-side transition
 * vocabulary), so it lives here in backend-shared rather than a
 * client-facing package -- both services/api (order creation, cancel)
 * and services/worker (5.6's expiration sweep) transition orders, so
 * "shared", for this class, means shared between server processes, not
 * shared with a browser or the Expo app. */
export const OrderEvent = {
  CONFIRM_UPLOAD: "CONFIRM_UPLOAD",
  REQUEST_PAYMENT: "REQUEST_PAYMENT",
  CONFIRM_PAYMENT: "CONFIRM_PAYMENT",
  FAIL_PAYMENT: "FAIL_PAYMENT",
  ROUTE_TO_SHOP: "ROUTE_TO_SHOP",
  SHOP_ACCEPT: "SHOP_ACCEPT",
  SHOP_REJECT: "SHOP_REJECT",
  QUEUE_PRINT: "QUEUE_PRINT",
  START_PRINT: "START_PRINT",
  FINISH_PRINT: "FINISH_PRINT",
  FAIL_PRINT: "FAIL_PRINT",
  LOSE_PRINT_STATUS: "LOSE_PRINT_STATUS",
  RESOLVE_UNKNOWN_PRINTED: "RESOLVE_UNKNOWN_PRINTED",
  RESOLVE_UNKNOWN_RETRY: "RESOLVE_UNKNOWN_RETRY",
  RESOLVE_UNKNOWN_FAILED: "RESOLVE_UNKNOWN_FAILED",
  RETRY_PRINT: "RETRY_PRINT",
  MARK_READY: "MARK_READY",
  COMPLETE: "COMPLETE",
  CANCEL: "CANCEL",
  EXPIRE: "EXPIRE",
} as const;
export type OrderEvent = (typeof OrderEvent)[keyof typeof OrderEvent];

/** §25's linear happy path, plus the failure/side branches §26, §79,
 * §108, §109, §110 and 10.2-10.4 each call for. A state with no entry
 * here is terminal -- every event thrown at it is illegal. Cancellation
 * (§79) is deliberately narrow: the plan's own 5.4 scope limits it to
 * `PAYMENT_PENDING`/`WAITING_FOR_SHOP` ("refused from PRINTING
 * onward") -- `SHOP_ACCEPTED` and `QUEUED_FOR_PRINT` are not in that
 * allowed set either, so CANCEL is illegal there too, not just from
 * PRINTING forward. `PRINT_FAILED`'s `RETRY_PRINT` covers both 10.2's
 * safe auto-retry and 10.4's change-printer reassignment -- both land
 * the *order* back in `QUEUED_FOR_PRINT`; which physical printer or
 * job id it's queued against is a `print_jobs`-table concern, not an
 * order-status one. */
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
  [OrderStatus.QUEUED_FOR_PRINT]: {
    [OrderEvent.START_PRINT]: OrderStatus.PRINTING,
    [OrderEvent.FAIL_PRINT]: OrderStatus.PRINT_FAILED,
  },
  [OrderStatus.PRINTING]: {
    [OrderEvent.FINISH_PRINT]: OrderStatus.PRINTED,
    [OrderEvent.FAIL_PRINT]: OrderStatus.PRINT_FAILED,
    [OrderEvent.LOSE_PRINT_STATUS]: OrderStatus.PRINT_STATUS_UNKNOWN,
  },
  [OrderStatus.PRINTED]: {
    [OrderEvent.MARK_READY]: OrderStatus.READY_FOR_COLLECTION,
  },
  [OrderStatus.READY_FOR_COLLECTION]: {
    [OrderEvent.COMPLETE]: OrderStatus.COMPLETED,
  },
  [OrderStatus.COMPLETED]: {},
  [OrderStatus.PAYMENT_FAILED]: {},
  [OrderStatus.SHOP_REJECTED]: {},
  [OrderStatus.PRINT_FAILED]: {
    [OrderEvent.RETRY_PRINT]: OrderStatus.QUEUED_FOR_PRINT,
  },
  [OrderStatus.PRINT_STATUS_UNKNOWN]: {
    [OrderEvent.RESOLVE_UNKNOWN_PRINTED]: OrderStatus.PRINTED,
    [OrderEvent.RESOLVE_UNKNOWN_RETRY]: OrderStatus.QUEUED_FOR_PRINT,
    [OrderEvent.RESOLVE_UNKNOWN_FAILED]: OrderStatus.PRINT_FAILED,
  },
  [OrderStatus.CANCELLED]: {},
  [OrderStatus.EXPIRED]: {},
};

/** §78/7.3: which of an order's transitions are also one of the seven
 * customer-facing domain events. Centralized here, inside the state
 * machine itself, rather than left for every future caller (8.x's
 * shop-accept action, 9.x's print-dispatch worker, ...) to separately
 * remember to notify on -- a future call site that transitions an
 * order via `transition()` gets this for free, by construction, the
 * same way it already gets the audit row for free. Events with no
 * entry here (REQUEST_PAYMENT, CANCEL, ...) simply produce no
 * notification, which is correct: not every state change is one of
 * §78's seven. */
const NOTIFICATION_TYPE_BY_EVENT: Partial<Record<OrderEvent, NotificationType>> = {
  [OrderEvent.CONFIRM_PAYMENT]: "PAYMENT_CONFIRMED",
  [OrderEvent.SHOP_ACCEPT]: "ORDER_ACCEPTED",
  [OrderEvent.START_PRINT]: "PRINT_STARTED",
  [OrderEvent.FAIL_PRINT]: "PRINT_FAILED",
  [OrderEvent.FINISH_PRINT]: "PRINT_COMPLETED",
  [OrderEvent.MARK_READY]: "READY_FOR_COLLECTION",
  [OrderEvent.COMPLETE]: "ORDER_COMPLETED",
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

/** The one and only place `orders.order_status` is ever written after
 * creation (enforced by the `no-restricted-syntax` rule in the root
 * eslint config, scoped to every server-side package/app and excluding
 * this file). `SELECT ... FOR UPDATE` first, inside a transaction, so
 * two callers racing the same order -- including 5.6's worker-side
 * expiration sweep racing a customer's own cancel request, or two
 * overlapping sweep ticks racing each other -- serialize on Postgres'
 * own row lock rather than a lost-update race in application code; the
 * same pattern 5.2's order-number counter uses for its own concurrency
 * guarantee, applied here to a row that already exists instead of one
 * being upserted. */
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
    // Captured from inside the transaction below (§78/7.3's email leg
    // can only be enqueued once the transaction genuinely commits --
    // Redis has no part in that transaction, so enqueueing from inside
    // it risks a job for a transition that then rolls back).
    let pendingEmail: SendEmailJob | undefined;

    const next = await this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<Array<{ order_status: OrderStatus }>>`
          SELECT order_status FROM orders WHERE id = ${orderId} FOR UPDATE
        `;
        const current = rows[0]?.order_status;
        if (current === undefined) {
          throw new NotFoundException("Order not found.");
        }

        const nextStatus = TRANSITIONS[current][event];
        if (nextStatus === undefined) {
          throw new AppException(
            HttpStatus.CONFLICT,
            "ILLEGAL_ORDER_TRANSITION",
            `Cannot apply ${event} to an order in ${current}.`,
            false,
          );
        }

        const updatedOrder = await tx.order.update({
          where: { id: orderId },
          data: {
            orderStatus: nextStatus,
            // §56's own completed_at column, set exactly once here --
            // the same "centralize it in the one place order_status is
            // ever written" reasoning as the audit row and the
            // notification below: any future path that ever reaches
            // COMPLETED gets this for free, rather than depending on
            // whichever call site happens to remember it.
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

        // §78/7.3: this transition's own row lock and legality check
        // are what make "exactly one notification per event, no
        // duplicates on transition replay" (7.3's own Done-when) true
        // for free -- this only ever runs once per genuine state
        // change, the same guarantee that already protects the audit
        // row above.
        const notificationType = NOTIFICATION_TYPE_BY_EVENT[event];
        if (notificationType) {
          const recipient = await tx.user.findUniqueOrThrow({
            where: { id: updatedOrder.customerId },
            select: { email: true },
          });
          const content = buildNotificationContent(
            notificationType,
            updatedOrder.publicOrderNumber,
          );

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

        return nextStatus;
      },
      // Prisma's own interactive-transaction defaults (maxWait: 2000ms
      // to acquire a connection, timeout: 5000ms for the whole
      // transaction) are tuned for isolated calls, not a genuine burst
      // of legitimate concurrent transitions on the same table (many
      // orders expiring in the same 5.6 sweep tick, a payment-webhook
      // spike) -- each individual transition here is a handful of fast
      // point queries, never long-running, so generously raising both
      // just gives real bursts room to queue for a connection instead
      // of failing with "unable to start a transaction," without
      // masking an actual stuck transaction (10s is still well short
      // of "hung").
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
}
