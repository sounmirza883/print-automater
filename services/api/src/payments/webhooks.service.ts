import { HttpStatus, Injectable, Logger, UnprocessableEntityException } from "@nestjs/common";
import { PaymentStatus } from "@prisma/client";
import {
  AppException,
  AuditService,
  OrderEvent,
  OrderStateMachine,
  PrismaService,
} from "@print-automated/backend-shared";
import { AuditAction } from "../audit/audit-action.js";
import { OrderLockService } from "./order-lock.service.js";
import type { ProviderPaymentOutcome, ProviderWebhookEvent } from "./payment-provider.interface.js";

/** §26: `PaymentStatus` and `OrderStatus` are separate concerns.
 * `OrderEvent` has no distinct "payment abandoned" event -- from the
 * order's perspective, a payment that was rejected and one the
 * customer walked away from both mean the same thing (this order does
 * not proceed to PAID), so both map to `FAIL_PAYMENT`. The finer
 * distinction (FAILED vs CANCELLED) is preserved on the payment row's
 * own `status`, not lost, just not modeled as a separate order state. */
function toOrderEvent(outcome: ProviderPaymentOutcome): OrderEvent {
  switch (outcome) {
    case "PAID":
      return OrderEvent.CONFIRM_PAYMENT;
    case "FAILED":
    case "CANCELLED":
      return OrderEvent.FAIL_PAYMENT;
    case "PENDING":
      throw new UnprocessableEntityException("A webhook cannot report a PENDING outcome.");
  }
}

function toPaymentStatus(outcome: ProviderPaymentOutcome): PaymentStatus {
  switch (outcome) {
    case "PAID":
      return PaymentStatus.PAID;
    case "FAILED":
      return PaymentStatus.FAILED;
    case "CANCELLED":
      return PaymentStatus.CANCELLED;
    case "PENDING":
      throw new UnprocessableEntityException("A webhook cannot report a PENDING outcome.");
  }
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderStateMachine: OrderStateMachine,
    private readonly orderLock: OrderLockService,
    private readonly audit: AuditService,
  ) {}

  /** §76/§92. The `payment_events` row is created only as part of the
   * *same* transaction that also applies the order transition and the
   * payment status update (all inside `sideEffect`) -- so an event
   * that fails to apply (an out-of-order delivery the state machine
   * legitimately refuses, a genuine transient error) leaves no
   * `payment_events` row behind at all, and a later redelivery of that
   * exact event retries the whole thing fresh rather than being
   * silently swallowed as "already handled." Only an event that
   * actually completes ever becomes findable by `providerEventId`,
   * which is exactly what makes the early return below a correct
   * "already processed" signal and not a false positive. */
  async process(event: ProviderWebhookEvent): Promise<void> {
    const payment = await this.prisma.payment.findUnique({
      where: { providerPaymentId: event.providerPaymentId },
    });
    if (!payment) {
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "UNKNOWN_PAYMENT",
        "No payment found for this provider payment id.",
        false,
      );
    }

    if (await this.alreadyProcessed(event.providerEventId)) {
      // §6.6: still attempted on a replay, not just on a fresh
      // transition below -- if an earlier delivery crashed after this
      // event's transition committed but before ROUTE_TO_SHOP ran, the
      // order is stuck at PAID and payment_events' unique constraint
      // means this early-return branch is the *only* code path a later
      // redelivery of the exact same event will ever take.
      if (event.outcome === "PAID") {
        await this.orderLock.withLock(payment.orderId, () =>
          this.routeToShopIfStillPaid(payment.orderId),
        );
      }
      return;
    }

    await this.orderLock.withLock(payment.orderId, async () => {
      // Re-checked inside the lock: a truly concurrent redelivery of
      // the same event that raced the check above may have already
      // been committed by the other caller while this one waited for
      // the lock.
      if (await this.alreadyProcessed(event.providerEventId)) {
        if (event.outcome === "PAID") {
          await this.routeToShopIfStillPaid(payment.orderId);
        }
        return;
      }

      const orderEvent = toOrderEvent(event.outcome);
      const paymentStatus = toPaymentStatus(event.outcome);

      await this.orderStateMachine.transition(
        payment.orderId,
        orderEvent,
        { id: null },
        {
          metadata: { provider: payment.provider, providerEventId: event.providerEventId },
          sideEffect: async (tx) => {
            await tx.payment.update({ where: { id: payment.id }, data: { status: paymentStatus } });
            // §26: `orders.payment_status` is its own column, deliberately
            // separate from `order_status` -- kept in sync with the
            // payment row's own status here rather than left to drift,
            // since it's the field OrderResponse and (eventually) 9.13's
            // dispatch gate actually read, not `payments.status` itself.
            await tx.order.update({ where: { id: payment.orderId }, data: { paymentStatus } });
            await tx.paymentEvent.create({
              data: {
                paymentId: payment.id,
                providerEventId: event.providerEventId,
                eventType: event.eventType,
                processedAt: new Date(),
              },
            });
          },
        },
      );

      // §45/16.6: payment status changes previously wrote no dedicated
      // (resourceType: "payment") audit row -- OrderStateMachine's own
      // ORDER_${event} row already covers the order-status side of
      // this, but not one filterable by `resourceType=payment`. Written
      // right after the transition, not inside its own transaction
      // (AuditService has no tx-aware overload) -- a crash between the
      // two leaves the atomic order-side audit row intact regardless.
      await this.audit.record({
        actorId: null,
        action: AuditAction.PAYMENT_STATUS_CHANGED,
        resourceType: "payment",
        resourceId: payment.id,
        metadata: {
          orderId: payment.orderId,
          status: paymentStatus,
          provider: payment.provider,
          providerEventId: event.providerEventId,
        },
      });

      // §6.6: a successful payment doesn't just leave the order sitting
      // at PAID -- it also routes to the shop queue, in the same locked
      // step (though necessarily a second Postgres transaction, since
      // OrderStateMachine.transition() owns its own).
      if (event.outcome === "PAID") {
        // §103/12.5: this branch only runs on the genuinely first
        // successful processing of this event (both `alreadyProcessed`
        // checks above already returned before reaching here on any
        // replay) -- logging here, not in either replay branch, means
        // this metric counts real payments once each, matching what
        // §92's own idempotency guarantee already promises financially.
        this.logger.log(
          { metric: "payment.succeeded", orderId: payment.orderId, paymentId: payment.id },
          "Payment succeeded.",
        );
        await this.routeToShopIfStillPaid(payment.orderId);
      }
    });
  }

  /** Treats "already routed past PAID by an earlier delivery of this
   * event, or moved further still" as success, not an error -- that's
   * exactly what should have happened. Only a genuinely different
   * failure propagates. */
  private async routeToShopIfStillPaid(orderId: string): Promise<void> {
    try {
      await this.orderStateMachine.transition(orderId, OrderEvent.ROUTE_TO_SHOP, { id: null });
    } catch (error) {
      if (error instanceof AppException && error.errorCode === "ILLEGAL_ORDER_TRANSITION") {
        return;
      }
      throw error;
    }
  }

  private async alreadyProcessed(providerEventId: string): Promise<boolean> {
    const existing = await this.prisma.paymentEvent.findUnique({ where: { providerEventId } });
    return existing !== null;
  }
}
