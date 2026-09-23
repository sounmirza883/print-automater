import { HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { OrderStatus, PaymentStatus } from "@prisma/client";
import {
  AppException,
  AuditService,
  OrderEvent,
  OrderStateMachine,
  PrismaService,
} from "@print-automated/backend-shared";
import type { PricingSnapshot } from "../orders/orders.service.js";
import { AuditAction } from "../audit/audit-action.js";
import { OrderLockService } from "./order-lock.service.js";

const MANUAL_PROVIDER = "manual";

/** §35/17.6: cash/offline payment against an order with no PSP
 * involved -- drives the SAME order/payment-status transitions
 * webhooks.service.ts's own mock-PSP path drives (REQUEST_PAYMENT then
 * CONFIRM_PAYMENT, via OrderStateMachine, never a raw
 * `orderStatus: PAID` write), reusing its own ROUTE_TO_SHOP-after-PAID
 * follow-up too. `OrderLockService.withLock`, keyed identically to
 * webhooks.service.ts's own `order-lock:${orderId}` (same class, same
 * key format), is the deliberate choice: it doesn't just serialize two
 * concurrent manual-payment calls against each other, it serializes
 * THIS path against the mock-PSP webhook path for the SAME order too
 * -- a customer paying online and a counter staff member recording
 * cash for the same order at the same moment can't both win.
 *
 * Double-recording / recording against an already-paid order is
 * refused with a real 409 (ORDER_NOT_AWAITING_PAYMENT), never a
 * silent no-op -- deliberately NOT the "swallow ILLEGAL_ORDER_
 * TRANSITION as already-done" pattern acceptOrder()/retryPrint() use
 * elsewhere in this codebase. Those actions are idempotent by design
 * (re-accepting an already-accepted order should look like success);
 * recording a second payment on the same order is a financial action
 * that must never look like a harmless retry -- a caller needs to see
 * the 409 to know nothing new happened. */
@Injectable()
export class ManualPaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderStateMachine: OrderStateMachine,
    private readonly orderLock: OrderLockService,
    private readonly audit: AuditService,
  ) {}

  async recordManualPayment(orderId: string, actorId: string): Promise<void> {
    await this.orderLock.withLock(orderId, async () => {
      const order = await this.prisma.order.findUnique({ where: { id: orderId } });
      if (!order) {
        throw new NotFoundException("Order not found.");
      }

      const snapshot = order.pricingSnapshot as unknown as PricingSnapshot;
      const amountMinor = snapshot.quote.totalMinor;
      const currency = snapshot.quote.currency;

      let paymentId: string;

      if (order.orderStatus === OrderStatus.UPLOADED) {
        // Same "payment creation and the UPLOADED -> PAYMENT_PENDING
        // transition happen inside one OrderStateMachine.transition()
        // call" shape PaymentsService.checkout() already establishes
        // for the online path (6.4) -- the row lock that makes the
        // transition safe under concurrency is what makes "exactly one
        // Payment row per order" true here too.
        let createdPaymentId: string | undefined;
        await this.orderStateMachine.transition(
          orderId,
          OrderEvent.REQUEST_PAYMENT,
          { id: actorId },
          {
            sideEffect: async (tx) => {
              const payment = await tx.payment.create({
                data: {
                  orderId,
                  provider: MANUAL_PROVIDER,
                  amountMinor,
                  currency,
                  status: PaymentStatus.PENDING,
                },
              });
              createdPaymentId = payment.id;
            },
          },
        );
        paymentId = createdPaymentId!;
      } else if (order.orderStatus === OrderStatus.PAYMENT_PENDING) {
        // Already mid-checkout (e.g. an online checkout was started but
        // never completed) -- reuse the existing PENDING payment rather
        // than minting a second row for the same order, the same
        // "reuse the pending payment" shape PaymentsService.checkout()
        // already establishes for a repeated checkout call.
        const existing = await this.prisma.payment.findFirst({
          where: { orderId, status: PaymentStatus.PENDING },
          orderBy: { createdAt: "desc" },
        });
        const payment =
          existing ??
          (await this.prisma.payment.create({
            data: {
              orderId,
              provider: MANUAL_PROVIDER,
              amountMinor,
              currency,
              status: PaymentStatus.PENDING,
            },
          }));
        paymentId = payment.id;
      } else {
        // Covers "already PAID" (a genuine double-call, or the order
        // was already paid online) and every other ineligible state
        // (PAYMENT_FAILED, CANCELLED, EXPIRED, ...) with one real,
        // specific error -- never a silent no-op.
        throw new AppException(
          HttpStatus.CONFLICT,
          "ORDER_NOT_AWAITING_PAYMENT",
          `Cannot record a manual payment for an order in ${order.orderStatus}.`,
          false,
        );
      }

      await this.orderStateMachine.transition(
        orderId,
        OrderEvent.CONFIRM_PAYMENT,
        { id: actorId },
        {
          metadata: { provider: MANUAL_PROVIDER, recordedBy: actorId },
          sideEffect: async (tx) => {
            await tx.payment.update({
              where: { id: paymentId },
              data: { status: PaymentStatus.PAID },
            });
            await tx.order.update({
              where: { id: orderId },
              data: { paymentStatus: PaymentStatus.PAID },
            });
          },
        },
      );

      // §45/17.6: who recorded this cash payment, for audit -- the
      // exact "kind of financial action that should be audited"
      // 17.6's own task text calls out by name.
      await this.audit.record({
        actorId,
        action: AuditAction.MANUAL_PAYMENT_RECORDED,
        resourceType: "payment",
        resourceId: paymentId,
        metadata: { orderId, amountMinor, currency },
      });

      // §6.6's own "a successful payment also routes to the shop
      // queue" behaviour, reused verbatim (webhooks.service.ts's own
      // routeToShopIfStillPaid()) -- a manual payment is no less a
      // real payment success than an online one.
      try {
        await this.orderStateMachine.transition(orderId, OrderEvent.ROUTE_TO_SHOP, {
          id: actorId,
        });
      } catch (error) {
        if (error instanceof AppException && error.errorCode === "ILLEGAL_ORDER_TRANSITION") {
          return;
        }
        throw error;
      }
    });
  }
}
