import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocPage, PlannedBadge, TableScroll } from "@/components/docs";
import type { TocItem } from "@/components/docs";
import { CodeBlock } from "@/components/pages";

export const metadata: Metadata = {
  title: "Webhooks",
  description:
    "Print Automated receives signed payment webhooks today. Outbound event webhooks for order and print-job status changes are planned; this page documents the design.",
  alternates: { canonical: "/docs/webhooks" },
};

const toc: TocItem[] = [
  { id: "status", label: "What exists today" },
  { id: "inbound", label: "Inbound payment webhooks" },
  { id: "outbound", label: "Outbound event webhooks (planned)" },
  { id: "events", label: "Planned events" },
  { id: "payload", label: "Planned payload" },
  { id: "verify", label: "Planned signature check" },
  { id: "retries", label: "Planned retry policy" },
];

const inboundExample = `POST /v1/webhooks/payment/mock
x-mock-signature: 9f2c...FAKE_HEX_HMAC_SHA256_OF_RAW_BODY
Content-Type: application/json

{
  "providerEventId": "evt_7d1c0b7e-0000-4000-8000-000000000003",
  "eventType": "payment.paid",
  "providerPaymentId": "mock_pay_123",
  "outcome": "PAID"
}

# 200 OK
{ "received": true }`;

const payloadExample = `{
  "id": "evt_01J0FAKE0000000000000000",
  "type": "order.status_changed",
  "createdAt": "2026-01-01T10:20:00.000Z",
  "shopId": "6ddee6f2-64f4-42ed-8e6e-f51691514da5",
  "data": {
    "orderId": "b2b6d1a0-0000-4000-8000-000000000004",
    "publicOrderNumber": "PA-000123",
    "previousStatus": "PRINTED",
    "status": "READY_FOR_COLLECTION"
  }
}`;

const verifyExample = `import { createHmac, timingSafeEqual } from "node:crypto";

// Planned header: X-PrintAutomated-Signature: t=<unix seconds>,v1=<hex hmac>
export function verify(rawBody: Buffer, header: string, secret: string): boolean {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  const age = Math.abs(Date.now() / 1000 - Number(parts.t));
  if (!(age < 300)) return false; // reject replays older than 5 minutes
  const expected = createHmac("sha256", secret)
    .update(parts.t + "." + rawBody.toString("utf8"))
    .digest("hex");
  const a = Buffer.from(parts.v1 ?? "", "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}`;

const events: [string, string][] = [
  ["order.created", "A new order exists (customer web or counter)."],
  [
    "order.status_changed",
    "Any order status change, such as SHOP_ACCEPTED, READY_FOR_COLLECTION or COMPLETED.",
  ],
  ["order.rejected", "Staff rejected the order, with the rejection reason."],
  ["payment.status_changed", "PAID, FAILED, CANCELLED, REFUNDED and the other payment statuses."],
  [
    "print_job.status_changed",
    "A job moved between QUEUED, CLAIMED, PRINTING, PRINTED, FAILED, UNKNOWN, PAUSED and the other job statuses.",
  ],
  [
    "print_job.blocked",
    "The allocation engine could not place a job. Includes the blocked reason.",
  ],
  ["printer.status_changed", "A printer went ONLINE, OFFLINE, ERROR, DISABLED and so on."],
  ["inventory.low_stock", "A low-stock alert opened."],
];

export default function WebhooksPage() {
  return (
    <DocPage
      href="/docs/webhooks"
      title="Webhooks"
      lede="Payment providers can call Print Automated today. Webhooks that call your systems when orders and print jobs change are planned and described below as a design."
      toc={toc}
    >
      <h2 id="status">What exists today</h2>
      <TableScroll label="Webhook availability" minWidth="min-w-[30rem]">
        <thead>
          <tr>
            <th scope="col">Direction</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Inbound: payment provider to Print Automated</th>
            <td>Available</td>
          </tr>
          <tr>
            <th scope="row">Outbound: Print Automated to your endpoint</th>
            <td>
              Not available yet <PlannedBadge />
            </td>
          </tr>
        </tbody>
      </TableScroll>

      <h2 id="inbound">Inbound payment webhooks</h2>
      <p>
        <code>POST /v1/webhooks/payment/:provider</code> receives payment results. It has no user
        login: the request is authenticated by an HMAC-SHA256 signature over the raw request body,
        compared in constant time. A missing or wrong signature returns 401 with{" "}
        <code>INVALID_WEBHOOK_SIGNATURE</code>, and an unknown provider name returns 404.
      </p>
      <p>
        The provider currently wired up is a built-in <code>mock</code> provider used for
        development and testing, with the signature in the <code>x-mock-signature</code> header. A
        real payment provider will be added through the same endpoint with its own signature header.
      </p>
      <CodeBlock
        language="http"
        label="Inbound payment event (mock provider)"
        code={inboundExample}
      />
      <ul>
        <li>
          <code>outcome</code> is <code>PAID</code>, <code>FAILED</code> or <code>CANCELLED</code>.
          A <code>PENDING</code> outcome is rejected with 422.
        </li>
        <li>
          Each event is applied in one transaction: it updates the payment, moves the order (
          <code>PAID</code>, or <code>PAYMENT_FAILED</code>) and records the event. Delivering the
          same <code>providerEventId</code> twice does not apply it twice.
        </li>
        <li>
          Respond within a normal request time; the response body is always {`{ "received": true }`}{" "}
          on success.
        </li>
      </ul>

      <h2 id="outbound">
        Outbound event webhooks <PlannedBadge />
      </h2>
      <Callout tone="planned" title="Planned, not implemented">
        <p>
          Nothing in this section can be called today: there is no endpoint to register a webhook
          URL, no secret to generate and no delivery. It is published so you can plan an integration
          and tell us what you need. Names and shapes may change before release.
        </p>
        <p>
          Until then, poll <code>GET /v1/shop/orders?shopId=</code> (see the{" "}
          <Link href="/docs/api-reference#shop">API reference</Link>) and honour the rate limits.
        </p>
      </Callout>
      <p>
        The idea: a business owner registers an HTTPS URL and receives a signing secret. Print
        Automated then sends a JSON <code>POST</code> for the events they subscribe to, using the
        same status vocabulary as the API, so a value you see in an event is a value you can read
        from an endpoint.
      </p>

      <h2 id="events">
        Planned events <PlannedBadge />
      </h2>
      <TableScroll label="Planned events" minWidth="min-w-[36rem]">
        <thead>
          <tr>
            <th scope="col">Event</th>
            <th scope="col">When</th>
          </tr>
        </thead>
        <tbody>
          {events.map(([e, w]) => (
            <tr key={e}>
              <th scope="row" className="font-mono text-xs">
                {e}
              </th>
              <td>{w}</td>
            </tr>
          ))}
        </tbody>
      </TableScroll>
      <p>
        Status values inside events would be exactly those in{" "}
        <Link href="/docs/order-lifecycle">Order lifecycle</Link>.
      </p>

      <h2 id="payload">
        Planned payload <PlannedBadge />
      </h2>
      <CodeBlock language="json" label="Example event (design)" code={payloadExample} />
      <p>
        Every event would carry a unique <code>id</code>, so receivers can de-duplicate. Delivery
        would be at-least-once and not strictly ordered, so use <code>createdAt</code> and the
        current status from the API when order matters.
      </p>

      <h2 id="verify">
        Planned signature check <PlannedBadge />
      </h2>
      <p>
        Each delivery would carry a timestamp and an HMAC-SHA256 signature computed over the
        timestamp and the raw body with your endpoint&apos;s secret. Verify against the raw bytes,
        not re-serialised JSON, compare in constant time, and reject old timestamps. This mirrors
        the check the inbound endpoint above already performs.
      </p>
      <CodeBlock language="ts" label="Verification sketch (design)" code={verifyExample} />

      <h2 id="retries">
        Planned retry policy <PlannedBadge />
      </h2>
      <ul>
        <li>Any 2xx response counts as delivered. Anything else, or a timeout, is a failure.</li>
        <li>
          Failed deliveries retry with exponential backoff and jitter for up to about 24 hours.
        </li>
        <li>
          An endpoint that keeps failing would be paused and the owner notified, with a way to
          replay missed events.
        </li>
        <li>Respond quickly and process asynchronously; return 2xx first, then do the work.</li>
      </ul>
    </DocPage>
  );
}
