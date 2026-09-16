import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { PaymentStatus, type Refund } from "@prisma/client";
import { AppException, PrismaService } from "@print-automated/backend-shared";
import { OrderLockService } from "./order-lock.service.js";
import { PAYMENT_PROVIDER, type PaymentProvider } from "./payment-provider.interface.js";

/** §80/11.2's own machine: `REFUND_PENDING -> REFUNDED`, failure
 * `REFUND_FAILED`. Deliberately its own service rather than routed
 * through `OrderStateMachine` -- a refund is entirely a `payments`/
 * `orders.payment_status` concern (§26's own separation), and
 * `OrderStatus` has no refund-related value at all; `order_status`
 * itself is untouched by any of this.
 *
 * "Idempotent against retries" (11.2's own Done-when: "a refund
 * requested twice produces one provider call and one refund record")
 * has two layers, mirroring 6.5's own webhook idempotency:
 *   1. `refunds.payment_id` is `@unique` (11.2's own follow-up
 *      migration) -- `upsert` is the database's own "claim, or find
 *      what's already there" primitive, the same guarantee 5.2's order-
 *      number counter and 6.5's `payment_events.provider_event_id`
 *      each already lean on.
 *   2. `OrderLockService.withLock`, the same Redis lock 6.5's own
 *      webhook processing uses, serializes the *whole* "check status,
 *      maybe call the provider, write the result" sequence per order --
 *      the row itself is a database-level backstop against a duplicate
 *      *record*; this lock is what stops a duplicate *provider call*
 *      for a refund that's still REFUND_PENDING when a second request
 *      arrives (a plain unique constraint alone can't prevent two
 *      concurrent readers of the same still-pending row from both
 *      deciding to call the provider). Held only around the provider
 *      call and the surrounding status writes -- never across a whole
 *      Postgres transaction spanning an external call, the same
 *      reasoning that already kept webhooks.service.ts's own lock
 *      separate from OrderStateMachine's transaction. */
@Injectable()
export class RefundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderLock: OrderLockService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  async requestRefund(paymentId: string, reason: string, actorId: string | null): Promise<Refund> {
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (!payment.providerPaymentId) {
      throw new AppException(
        HttpStatus.CONFLICT,
        "PAYMENT_NOT_REFUNDABLE",
        "This payment never reached the provider and cannot be refunded.",
        false,
      );
    }
    const providerPaymentId = payment.providerPaymentId;

    return this.orderLock.withLock(payment.orderId, async () => {
      // Idempotent claim: a first call creates the row; every
      // subsequent call (a genuine retry, or a second request racing
      // for the lock above) finds the exact same row instead of
      // creating a second one.
      const refund = await this.prisma.refund.upsert({
        where: { paymentId },
        create: {
          paymentId,
          orderId: payment.orderId,
          amountMinor: payment.amountMinor,
          currency: payment.currency,
          reason,
          actorId,
          status: PaymentStatus.REFUND_PENDING,
        },
        update: {},
      });

      if (refund.status === PaymentStatus.REFUNDED) {
        // Already succeeded on an earlier call -- the provider is never
        // called a second time for a refund that already went through.
        return refund;
      }

      await this.syncPaymentAndOrderStatus(
        payment.id,
        payment.orderId,
        PaymentStatus.REFUND_PENDING,
      );

      try {
        const result = await this.provider.refund({ providerPaymentId }, refund.amountMinor);
        return this.finalizeRefund(refund.id, payment.id, payment.orderId, {
          status: PaymentStatus.REFUNDED,
          providerRefundId: result.providerRefundId,
        });
      } catch {
        // A failed refund is represented as data (REFUND_FAILED), not a
        // thrown error that would abort whatever wider operation (e.g.
        // 11.3's own shop-rejection flow) triggered this refund -- the
        // same "failure is a terminal-ish state, not an exception"
        // shape PRINT_FAILED already established for the print side.
        return this.finalizeRefund(refund.id, payment.id, payment.orderId, {
          status: PaymentStatus.REFUND_FAILED,
        });
      }
    });
  }

  private async syncPaymentAndOrderStatus(
    paymentId: string,
    orderId: string,
    status: PaymentStatus,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.payment.update({ where: { id: paymentId }, data: { status } }),
      this.prisma.order.update({ where: { id: orderId }, data: { paymentStatus: status } }),
    ]);
  }

  private async finalizeRefund(
    refundId: string,
    paymentId: string,
    orderId: string,
    outcome: { status: PaymentStatus; providerRefundId?: string },
  ): Promise<Refund> {
    const [updatedRefund] = await this.prisma.$transaction([
      this.prisma.refund.update({
        where: { id: refundId },
        data: {
          status: outcome.status,
          ...(outcome.providerRefundId ? { providerRefundId: outcome.providerRefundId } : {}),
        },
      }),
      this.prisma.payment.update({ where: { id: paymentId }, data: { status: outcome.status } }),
      this.prisma.order.update({ where: { id: orderId }, data: { paymentStatus: outcome.status } }),
    ]);
    return updatedRefund;
  }
}
