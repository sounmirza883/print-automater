/** §23's payment-provider abstraction. Every method here trades in
 * generic primitives (order id, amount/currency, an opaque
 * provider-issued payment id) and never a provider SDK's own types --
 * that's what "no provider-specific type leaks into the orders
 * module" (6.2's own Done-when) means structurally: nothing that calls
 * `PaymentProvider` needs to know or import anything about whichever
 * concrete provider is active. Swapping the active implementation (§23:
 * "payment provider must be abstracted behind a payment service") is a
 * DI registration against the `PAYMENT_PROVIDER` token below, not a
 * refactor of any caller -- 6.3's `MockPaymentProvider` is the first
 * one; a real PSP later is the second, registered the same way. */

export type ProviderPaymentOutcome = "PENDING" | "PAID" | "FAILED" | "CANCELLED";

export interface CheckoutRequest {
  orderId: string;
  amountMinor: number;
  currency: string;
}

export interface CheckoutSession {
  providerPaymentId: string;
  checkoutUrl: string;
}

export interface ProviderWebhookEvent {
  providerEventId: string;
  eventType: string;
  providerPaymentId: string;
  outcome: ProviderPaymentOutcome;
}

/** A discriminated union, not a boolean plus a possibly-null event --
 * an invalid signature must be structurally incapable of carrying a
 * (fabricated or stale) event payload anywhere a caller could
 * accidentally read it. */
export type WebhookVerificationResult =
  { valid: true; event: ProviderWebhookEvent } | { valid: false };

export interface ProviderPaymentStatus {
  providerPaymentId: string;
  outcome: ProviderPaymentOutcome;
}

export interface RefundablePayment {
  providerPaymentId: string;
}

export interface ProviderRefundResult {
  providerRefundId: string;
}

export interface PaymentProvider {
  readonly name: string;
  createCheckout(request: CheckoutRequest): Promise<CheckoutSession>;
  verifyWebhook(rawBody: Buffer, signature: string): WebhookVerificationResult;
  fetchPayment(providerPaymentId: string): Promise<ProviderPaymentStatus>;
  refund(payment: RefundablePayment, amountMinor: number): Promise<ProviderRefundResult>;
}

export const PAYMENT_PROVIDER = Symbol("PAYMENT_PROVIDER");
