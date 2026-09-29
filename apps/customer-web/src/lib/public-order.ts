import type { PrintConfiguration } from "@print-automated/types";

export interface PublicOrderQuoteLineItem {
  label: string;
  amountMinor: number;
}

export interface PublicOrderPricingSnapshot {
  quote: {
    lineItems: PublicOrderQuoteLineItem[];
    subtotalMinor: number;
    platformFeeMinor: number;
    totalMinor: number;
    currency: string;
  };
}

/** The shape of `POST /public/shops/:shopId/orders`'s `OrderResponse`
 * this app actually reads -- a hand-copied subset, not an import of
 * the backend's own `services/api` type, since customer-web never
 * depends on that package directly. */
export interface PublicOrderResult {
  id: string;
  publicOrderNumber: string;
  documentId: string;
  documentFilename: string;
  shopId: string;
  shopName: string;
  printConfiguration: PrintConfiguration;
  pricingSnapshot: PublicOrderPricingSnapshot;
  paymentStatus: string;
  orderStatus: string;
  creationSource: string;
  customerRecordId: string | null;
  createdAt: string;
}

/** §92, guest version of `lib/place-order.ts`'s `createOrder`:
 * `idempotencyKey` is minted once per placement attempt by the caller
 * (the wizard, via a `useRef`) and forwarded verbatim, never minted
 * here -- a double-tap or a retry after a transient network error must
 * reuse the same key so the backend's `IdempotencyInterceptor` treats
 * it as a replay, not a second order. There is no separate checkout
 * step: a guest has no account to hold a payment session under, so
 * this order's `pricingSnapshot` is the first (and only) price the
 * guest ever sees -- shown on the confirmation screen this resolves
 * to, not before. */
export async function createPublicOrder(
  shopId: string,
  name: string,
  phone: string,
  documentId: string,
  printConfiguration: PrintConfiguration,
  idempotencyKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PublicOrderResult> {
  const response = await fetchImpl(`/api/public/shops/${shopId}/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ name, phone, documentId, printConfiguration }),
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Could not place this order."));
  }
  return (await response.json()) as PublicOrderResult;
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => undefined)) as { message?: unknown } | undefined;
  return typeof body?.message === "string" ? body.message : fallback;
}
