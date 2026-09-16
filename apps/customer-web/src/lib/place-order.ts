import type { PrintConfiguration } from "@print-automated/types";

export interface CreatedOrder {
  id: string;
}

/** §5.5/§92: `idempotencyKey` is generated once per placement attempt
 * by the caller (review/page.tsx, via a `useRef` so a retry reuses the
 * same value) and forwarded verbatim -- this function never mints its
 * own, since the whole point is that clicking "Pay & Place Order"
 * twice (a double click, or a retry after a transient network error)
 * must not create two orders. */
export async function createOrder(
  documentId: string,
  shopId: string,
  printConfiguration: PrintConfiguration,
  idempotencyKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CreatedOrder> {
  const response = await fetchImpl("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ documentId, shopId, printConfiguration }),
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Could not place this order."));
  }
  return (await response.json()) as CreatedOrder;
}

export interface CheckoutSession {
  checkoutUrl: string;
}

/** §6.4 is already idempotent per order on the backend -- no client-
 * generated key needed for this call the way createOrder needs one. */
export async function startCheckout(
  orderId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CheckoutSession> {
  const response = await fetchImpl("/api/payments/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId }),
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Could not start checkout."));
  }
  return (await response.json()) as CheckoutSession;
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => undefined)) as { message?: unknown } | undefined;
  return typeof body?.message === "string" ? body.message : fallback;
}
