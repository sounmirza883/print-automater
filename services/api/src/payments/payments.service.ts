import { Inject, Injectable } from "@nestjs/common";
import { OrderStatus, PaymentStatus } from "@prisma/client";
import {
  AppException,
  OrderEvent,
  OrderStateMachine,
  PrismaService,
} from "@print-automated/backend-shared";
import { OrdersService, type PricingSnapshot } from "../orders/orders.service.js";
import { PAYMENT_PROVIDER, type PaymentProvider } from "./payment-provider.interface.js";

export interface CheckoutResponse {
  checkoutUrl: string;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
    private readonly orderStateMachine: OrderStateMachine,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  /** §23/6.4. Payment creation and the order's UPLOADED -> PAYMENT_PENDING
   * transition happen inside one `OrderStateMachine.transition()` call
   * (via its `sideEffect` hook, 5.4) -- the same `SELECT ... FOR UPDATE`
   * row lock that makes a transition safe under concurrency is what
   * makes "two checkout calls on one order reuse the same payment
   * record" (this sub-phase's own Done-when) true even when the two
   * calls genuinely race: only one can win the lock and actually
   * transition + create the payment; the other's transition attempt
   * finds the order already PAYMENT_PENDING and throws
   * ILLEGAL_ORDER_TRANSITION, caught below and turned into "look up
   * the payment the winner just created" instead of an error. */
  async checkout(requestingUserId: string, orderId: string): Promise<CheckoutResponse> {
    const order = await this.ordersService.getOwnedOrder(requestingUserId, orderId);

    if (order.orderStatus === OrderStatus.PAYMENT_PENDING) {
      return { checkoutUrl: await this.existingPendingCheckoutUrl(orderId) };
    }

    const { totalMinor, currency } = (order.pricingSnapshot as unknown as PricingSnapshot).quote;
    const session = await this.provider.createCheckout({
      orderId: order.id,
      amountMinor: totalMinor,
      currency,
    });

    try {
      let checkoutUrl: string | undefined;
      await this.orderStateMachine.transition(
        order.id,
        OrderEvent.REQUEST_PAYMENT,
        { id: requestingUserId },
        {
          sideEffect: async (tx) => {
            const payment = await tx.payment.create({
              data: {
                orderId: order.id,
                provider: this.provider.name,
                providerPaymentId: session.providerPaymentId,
                checkoutUrl: session.checkoutUrl,
                amountMinor: totalMinor,
                currency,
              },
            });
            checkoutUrl = payment.checkoutUrl!;
          },
        },
      );
      return { checkoutUrl: checkoutUrl! };
    } catch (error) {
      if (error instanceof AppException && error.errorCode === "ILLEGAL_ORDER_TRANSITION") {
        // Only a genuine race (another concurrent checkout call already
        // won and created a payment) gets the graceful fallback -- an
        // order that's ineligible for a completely different reason
        // (already PAID, CANCELLED, ...) has no pending payment to find
        // here, and must still surface as the real 409, not a confusing
        // "payment not found" error from underneath it.
        const existing = await this.prisma.payment.findFirst({
          where: { orderId, status: PaymentStatus.PENDING },
          orderBy: { createdAt: "desc" },
        });
        if (existing?.checkoutUrl) {
          return { checkoutUrl: existing.checkoutUrl };
        }
      }
      throw error;
    }
  }

  private async existingPendingCheckoutUrl(orderId: string): Promise<string> {
    const payment = await this.prisma.payment.findFirstOrThrow({
      where: { orderId, status: PaymentStatus.PENDING },
      orderBy: { createdAt: "desc" },
    });
    return payment.checkoutUrl!;
  }
}
