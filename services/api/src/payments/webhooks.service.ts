import { HttpStatus, Injectable, UnprocessableEntityException } from "@nestjs/common";
import { PaymentStatus } from "@prisma/client";
import {
  AppException,
  OrderEvent,
  OrderStateMachine,
  PrismaService,
} from "@print-automated/backend-shared";
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderStateMachine: OrderStateMachine,
    private readonly orderLock: OrderLockService,
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
      return;
    }

    await this.orderLock.withLock(payment.orderId, async () => {
      // Re-checked inside the lock: a truly concurrent redelivery of
      // the same event that raced the check above may have already
      // been committed by the other caller while this one waited for
      // the lock.
      if (await this.alreadyProcessed(event.providerEventId)) {
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
    });
  }

  private async alreadyProcessed(providerEventId: string): Promise<boolean> {
    const existing = await this.prisma.paymentEvent.findUnique({ where: { providerEventId } });
    return existing !== null;
  }
}
