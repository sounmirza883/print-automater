import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { ApiEnv } from "@print-automated/config";
import { API_ENV } from "../config/config.module.js";
import type {
  CheckoutRequest,
  CheckoutSession,
  PaymentProvider,
  ProviderPaymentOutcome,
  ProviderPaymentStatus,
  ProviderRefundResult,
  ProviderWebhookEvent,
  RefundablePayment,
  WebhookVerificationResult,
} from "./payment-provider.interface.js";

/** What the dev checkout page's last button press produced for a given
 * `providerPaymentId` -- enough for `fetchPayment()` to answer with
 * something real, and for `/mock/replay` to resend the exact same
 * signed bytes rather than reconstructing (and potentially
 * re-serializing slightly differently) an equivalent one. In-memory
 * only: this is a dev tool living inside a single process, not a
 * system of record -- it does not need to survive a restart. */
interface LedgerEntry {
  outcome: ProviderPaymentOutcome;
  rawBody: Buffer;
  signature: string;
}

/** §23/6.3. The dev-only checkout page (MockCheckoutController) is
 * this provider's UI; this class is its actual behavior -- real
 * HMAC-SHA256 signing and verification (not a stub that always
 * returns true), so anything that exercises this provider is
 * exercising the exact §76 requirements (signature verification,
 * idempotency, event persistence, retry handling, auditability) a
 * real PSP integration will need too. */
@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock";

  private readonly ledger = new Map<string, LedgerEntry>();

  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
    const providerPaymentId = `mock_${randomUUID()}`;
    const params = new URLSearchParams({
      providerPaymentId,
      orderId: request.orderId,
      amountMinor: String(request.amountMinor),
      currency: request.currency,
    });
    return {
      providerPaymentId,
      checkoutUrl: `${this.env.API_PUBLIC_BASE_URL}/v1/payments/mock/checkout?${params.toString()}`,
    };
  }

  /** Constant-time comparison (`timingSafeEqual`) -- a webhook
   * signature is exactly the kind of secret-derived value a
   * variable-time `===` could leak information about through response
   * timing, same concern §9's password comparisons already account
   * for elsewhere in this codebase. */
  verifyWebhook(rawBody: Buffer, signature: string): WebhookVerificationResult {
    const expected = this.sign(rawBody);
    const provided = Buffer.from(signature, "hex");
    const expectedBuffer = Buffer.from(expected, "hex");
    if (provided.length !== expectedBuffer.length || !timingSafeEqual(provided, expectedBuffer)) {
      return { valid: false };
    }

    try {
      const event = JSON.parse(rawBody.toString("utf8")) as Partial<ProviderWebhookEvent>;
      if (
        typeof event.providerEventId !== "string" ||
        typeof event.eventType !== "string" ||
        typeof event.providerPaymentId !== "string" ||
        typeof event.outcome !== "string"
      ) {
        return { valid: false };
      }
      return { valid: true, event: event as ProviderWebhookEvent };
    } catch {
      return { valid: false };
    }
  }

  async fetchPayment(providerPaymentId: string): Promise<ProviderPaymentStatus> {
    const entry = this.ledger.get(providerPaymentId);
    return { providerPaymentId, outcome: entry?.outcome ?? "PENDING" };
  }

  async refund(_payment: RefundablePayment, _amountMinor: number): Promise<ProviderRefundResult> {
    return { providerRefundId: `mock_refund_${randomUUID()}` };
  }

  sign(rawBody: Buffer): string {
    return createHmac("sha256", this.env.MOCK_PAYMENT_WEBHOOK_SECRET).update(rawBody).digest("hex");
  }

  /** Builds and signs a new event, records it as the ledger entry for
   * this `providerPaymentId` (so both `fetchPayment` and `/mock/replay`
   * see it), and returns the exact bytes + signature a caller should
   * deliver. Does not perform the HTTP delivery itself -- that's
   * MockCheckoutController's job, keeping "construct a valid signed
   * event" (testable in isolation) separate from "make a real HTTP
   * call" (an integration concern). */
  recordEvent(providerPaymentId: string, outcome: ProviderPaymentOutcome): LedgerEntry {
    const event: ProviderWebhookEvent = {
      providerEventId: `evt_${randomUUID()}`,
      eventType: `payment.${outcome.toLowerCase()}`,
      providerPaymentId,
      outcome,
    };
    const rawBody = Buffer.from(JSON.stringify(event), "utf8");
    const entry: LedgerEntry = { outcome, rawBody, signature: this.sign(rawBody) };
    this.ledger.set(providerPaymentId, entry);
    return entry;
  }

  /** The last entry recorded for a payment, or undefined if none --
   * `/mock/replay`'s "nothing to replay yet" case. */
  lastEvent(providerPaymentId: string): LedgerEntry | undefined {
    return this.ledger.get(providerPaymentId);
  }
}
