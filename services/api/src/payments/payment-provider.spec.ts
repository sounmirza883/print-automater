import "reflect-metadata";
import { Inject, Injectable } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  PAYMENT_PROVIDER,
  type CheckoutRequest,
  type CheckoutSession,
  type PaymentProvider,
  type ProviderPaymentStatus,
  type ProviderRefundResult,
  type RefundablePayment,
  type WebhookVerificationResult,
} from "./payment-provider.interface.js";

/** A minimal stub -- proof this interface "compiles against a stub"
 * (6.2's own Done-when), with no provider SDK, HMAC logic, or any of
 * 6.3's real Mock provider behavior. */
class StubProvider implements PaymentProvider {
  readonly name: string = "stub";

  async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
    return {
      providerPaymentId: `stub_${request.orderId}`,
      checkoutUrl: `https://stub.invalid/checkout/${request.orderId}`,
    };
  }

  verifyWebhook(_rawBody: Buffer, signature: string): WebhookVerificationResult {
    if (signature !== "valid-signature") {
      return { valid: false };
    }
    return {
      valid: true,
      event: {
        providerEventId: "evt_stub_1",
        eventType: "payment.succeeded",
        providerPaymentId: "stub_order-1",
        outcome: "PAID",
      },
    };
  }

  async fetchPayment(providerPaymentId: string): Promise<ProviderPaymentStatus> {
    return { providerPaymentId, outcome: "PAID" };
  }

  async refund(payment: RefundablePayment, amountMinor: number): Promise<ProviderRefundResult> {
    return { providerRefundId: `refund_${payment.providerPaymentId}_${amountMinor}` };
  }
}

/** Depends only on the token -- proof that "a second provider is a
 * module registration, not a refactor" (6.2's own Done-when) is true
 * of consumer code, not just an aspiration: this class is never
 * touched below when the bound implementation changes. */
@Injectable()
class CheckoutOrchestrator {
  constructor(@Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider) {}

  checkout(request: CheckoutRequest): Promise<CheckoutSession> {
    return this.provider.createCheckout(request);
  }
}

describe("PaymentProvider interface (6.2)", () => {
  it("a stub implementation satisfies the full interface and behaves as expected", async () => {
    const provider: PaymentProvider = new StubProvider();

    const session = await provider.createCheckout({
      orderId: "order-1",
      amountMinor: 5000,
      currency: "PKR",
    });
    expect(session.providerPaymentId).toBe("stub_order-1");
    expect(session.checkoutUrl).toContain("order-1");

    expect(provider.verifyWebhook(Buffer.from("{}"), "wrong")).toEqual({ valid: false });
    const verified = provider.verifyWebhook(Buffer.from("{}"), "valid-signature");
    expect(verified).toEqual({
      valid: true,
      event: {
        providerEventId: "evt_stub_1",
        eventType: "payment.succeeded",
        providerPaymentId: "stub_order-1",
        outcome: "PAID",
      },
    });

    const status = await provider.fetchPayment("stub_order-1");
    expect(status).toEqual({ providerPaymentId: "stub_order-1", outcome: "PAID" });

    const refund = await provider.refund({ providerPaymentId: "stub_order-1" }, 5000);
    expect(refund.providerRefundId).toBe("refund_stub_order-1_5000");
  });

  it("swapping the bound provider changes behavior without touching the consumer class", async () => {
    const firstModule = await Test.createTestingModule({
      providers: [CheckoutOrchestrator, { provide: PAYMENT_PROVIDER, useClass: StubProvider }],
    }).compile();
    const first = firstModule.get(CheckoutOrchestrator);
    const firstSession = await first.checkout({
      orderId: "order-a",
      amountMinor: 1000,
      currency: "PKR",
    });
    expect(firstSession.providerPaymentId).toBe("stub_order-a");

    class AlternateProvider extends StubProvider {
      override readonly name = "alternate";
      override async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
        return {
          providerPaymentId: `alt_${request.orderId}`,
          checkoutUrl: `https://alternate.invalid/${request.orderId}`,
        };
      }
    }

    const secondModule = await Test.createTestingModule({
      providers: [CheckoutOrchestrator, { provide: PAYMENT_PROVIDER, useClass: AlternateProvider }],
    }).compile();
    const second = secondModule.get(CheckoutOrchestrator);
    const secondSession = await second.checkout({
      orderId: "order-a",
      amountMinor: 1000,
      currency: "PKR",
    });
    // Same CheckoutOrchestrator class, same call -- only the bound
    // provider changed, and that alone changed the result.
    expect(secondSession.providerPaymentId).toBe("alt_order-a");
  });
});
