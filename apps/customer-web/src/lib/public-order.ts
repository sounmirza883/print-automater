import type { PrintConfiguration } from "@print-automated/types";
import { UNREACHABLE_MESSAGE, publicApiUrl, publicErrorMessage } from "./public-api";

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
 * to, not before. Sent straight to the API's own public route from the
 * browser (see `public-api.ts`); the `Idempotency-Key` header crosses
 * origins under the API's CORS config like any other request header.
 *
 * `branchId` is the branch whose QR code was scanned. It is left out of the body altogether when
 * there is none (a code printed before branches existed), and the API then uses the business's
 * oldest branch. It comes last so the earlier positional calls keep working. */
export async function createPublicOrder(
  shopId: string,
  name: string,
  phone: string,
  documentId: string,
  printConfiguration: PrintConfiguration,
  idempotencyKey: string,
  fetchImpl: typeof fetch = fetch,
  branchId?: string,
): Promise<PublicOrderResult> {
  let response: Response;
  try {
    response = await fetchImpl(publicApiUrl(`/v1/public/shops/${shopId}/orders`), {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({
        ...(branchId !== undefined ? { branchId } : {}),
        name,
        phone,
        documentId,
        printConfiguration,
      }),
    });
  } catch {
    throw new Error(UNREACHABLE_MESSAGE);
  }
  if (!response.ok) {
    throw new Error(await publicErrorMessage(response, "Could not place this order."));
  }
  return (await response.json()) as PublicOrderResult;
}

/** The PDF receipt for an order this guest just placed
 * (`GET /public/shops/:shopId/orders/:orderId/invoice`). Resolves to the file
 * and the name to save it under; the caller turns it into a download. A plain
 * fetch rather than a link, so a failure (rate limit, network) can be shown on
 * the confirmation screen instead of navigating the guest to a JSON error. */
export async function fetchPublicInvoice(
  order: Pick<PublicOrderResult, "id" | "shopId" | "publicOrderNumber">,
  fetchImpl: typeof fetch = fetch,
): Promise<{ blob: Blob; filename: string }> {
  let response: Response;
  try {
    response = await fetchImpl(
      publicApiUrl(`/v1/public/shops/${order.shopId}/orders/${order.id}/invoice`),
    );
  } catch {
    throw new Error(UNREACHABLE_MESSAGE);
  }
  if (!response.ok) {
    throw new Error(await publicErrorMessage(response, "Could not download the invoice."));
  }
  return { blob: await response.blob(), filename: `invoice-${order.publicOrderNumber}.pdf` };
}
