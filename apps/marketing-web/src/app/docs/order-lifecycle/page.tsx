import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocPage, TableScroll } from "@/components/docs";
import type { TocItem } from "@/components/docs";

export const metadata: Metadata = {
  title: "Order lifecycle",
  description:
    "The statuses an order, its payment and its print jobs move through in Print Automated, and which actions trigger each change.",
  alternates: { canonical: "/docs/order-lifecycle" },
};

const toc: TocItem[] = [
  { id: "three-statuses", label: "Three separate statuses" },
  { id: "order-status", label: "Order status" },
  { id: "actions", label: "Staff actions" },
  { id: "payment-status", label: "Payment status" },
  { id: "print-job-status", label: "Print job status" },
  { id: "blocked", label: "Why a job is blocked" },
];

const happy: [string, string, string][] = [
  ["DRAFT", "UPLOADED", "The customer's file is uploaded and confirmed."],
  ["UPLOADED", "PAYMENT_PENDING", "Checkout is requested."],
  ["PAYMENT_PENDING", "PAID", "The payment provider confirms payment."],
  ["PAID", "WAITING_FOR_SHOP", "The order is routed to the shop for acceptance."],
  ["WAITING_FOR_SHOP", "SHOP_ACCEPTED", "Staff accept the order."],
  ["SHOP_ACCEPTED", "QUEUED_FOR_PRINT", "A print job is created and queued."],
  [
    "QUEUED_FOR_PRINT",
    "PRINTING",
    "The agent reports the job is printing (driven by print-job status).",
  ],
  ["PRINTING", "PRINTED", "The agent reports the job printed (driven by print-job status)."],
  [
    "PRINTED",
    "READY_FOR_COLLECTION",
    "Staff mark it ready. With quality check on, it goes via QUALITY_CHECK first.",
  ],
  ["READY_FOR_COLLECTION", "COMPLETED", "The customer collects it."],
];

const other: [string, string][] = [
  ["PAYMENT_FAILED", "The provider reported a failed or cancelled payment."],
  ["SHOP_REJECTED", "Staff rejected the order, choosing one of four reasons."],
  [
    "CANCELLED",
    "Cancelled by the customer while payment is pending or the shop has not yet accepted.",
  ],
  ["EXPIRED", "Payment was not completed in time."],
  ["PRINT_FAILED", "Printing failed, or a quality check failed."],
  [
    "PRINT_STATUS_UNKNOWN",
    "A submission's outcome could not be confirmed. Needs a person to resolve.",
  ],
  [
    "PREPARING, ASSIGNED, PAUSED",
    "Production-floor states used by the operations layer: preparing a job, assigning it to a printer or operator, and pausing it.",
  ],
  [
    "QUALITY_CHECK",
    "Waiting for a quality verdict: passed goes to ready, failed goes to PRINT_FAILED, reprint goes back to the queue.",
  ],
];

const actions: [string, string, string][] = [
  ["POST /v1/shop/orders/:id/accept", "EDIT_ORDERS", "WAITING_FOR_SHOP to SHOP_ACCEPTED"],
  [
    "POST /v1/shop/orders/:id/reject",
    "EDIT_ORDERS",
    "WAITING_FOR_SHOP to SHOP_REJECTED (body: reason)",
  ],
  ["POST /v1/shop/orders/:id/ready", "EDIT_ORDERS", "PRINTED to READY_FOR_COLLECTION"],
  [
    "POST /v1/shop/orders/:id/quality-check",
    "QUALITY_CHECK",
    "Record the verdict on a QUALITY_CHECK order",
  ],
  ["POST /v1/shop/orders/:id/complete", "EDIT_ORDERS", "READY_FOR_COLLECTION to COMPLETED"],
  ["POST /v1/shop/orders/:id/retry-print", "EDIT_ORDERS", "Queue a failed print again"],
  [
    "POST /v1/shop/orders/:id/resolve-unknown",
    "EDIT_ORDERS",
    "Resolve a PRINT_STATUS_UNKNOWN order",
  ],
  [
    "POST /v1/shop/orders/:id/change-printer",
    "EDIT_ORDERS",
    "Move the order's job to another printer",
  ],
];

const enumRows: [string, string, string][] = [
  ["Payment", "PENDING, AUTHORIZED, PAID, FAILED, CANCELLED", "Money in."],
  ["Payment (refund)", "REFUND_PENDING, REFUNDED, REFUND_FAILED", "Money back out."],
];

const jobRows: [string, string][] = [
  [
    "CREATED, WAITING",
    "Exists but not yet ready to be picked up, for example waiting for a printer.",
  ],
  ["QUEUED", "Ready for its assigned agent to claim."],
  ["CLAIMED", "Exactly one agent has claimed it (an atomic, single-winner claim)."],
  ["PRINTING, PRINTED", "Reported by the agent."],
  ["FAILED, UNKNOWN", "Reported by the agent. UNKNOWN is never retried automatically."],
  ["TIMEOUT", "Set by the backend when a job stops progressing."],
  ["PAUSED, REASSIGNED, CANCELLED", "Set by staff actions."],
];

const blocked: [string, string][] = [
  ["NO_COMPATIBLE_PRINTER", "No printer supports the job's colour, size or duplex needs."],
  ["PRINTER_OFFLINE", "The matching printer is offline."],
  ["PRINTER_DISABLED", "The matching printer has been disabled by staff."],
  ["PAGE_LIMIT_REACHED", "The printer's page limit is reached."],
  ["NO_PAPER", "The required paper stock is out."],
  ["OPERATOR_UNAVAILABLE", "No operator is available to take the job."],
  [
    "MANUAL_APPROVAL_REQUIRED",
    "Held for staff acknowledgement, for example after a late printed report.",
  ],
  [
    "AUTOMATION_DISABLED",
    "Automatic assignment is switched off, so the job waits for staff to assign a printer.",
  ],
];

export default function OrderLifecyclePage() {
  return (
    <DocPage
      href="/docs/order-lifecycle"
      title="Order lifecycle"
      lede="An order carries an order status, a payment status and one or more print jobs, each with its own status. Knowing which is which is most of what you need to integrate."
      toc={toc}
    >
      <h2 id="three-statuses">Three separate statuses</h2>
      <p>
        The order status describes where the order is in the shop&apos;s workflow. The payment
        status tracks money independently, and each print job has its own status reported mostly by
        the <Link href="/docs/printer-agent">printer agent</Link>. The order status is derived from
        its jobs, so a single order never contradicts what its printers are doing.
      </p>

      <h2 id="order-status">Order status</h2>
      <h3>The normal path</h3>
      <TableScroll label="Normal order path" minWidth="min-w-[40rem]">
        <thead>
          <tr>
            <th scope="col">From</th>
            <th scope="col">To</th>
            <th scope="col">Trigger</th>
          </tr>
        </thead>
        <tbody>
          {happy.map(([from, to, why]) => (
            <tr key={from}>
              <th scope="row" className="font-mono text-xs">
                {from}
              </th>
              <td>
                <code>{to}</code>
              </td>
              <td>{why}</td>
            </tr>
          ))}
        </tbody>
      </TableScroll>
      <h3>Exceptions and side states</h3>
      <TableScroll label="Other order statuses" minWidth="min-w-[34rem]">
        <thead>
          <tr>
            <th scope="col">Status</th>
            <th scope="col">Meaning</th>
          </tr>
        </thead>
        <tbody>
          {other.map(([s, d]) => (
            <tr key={s}>
              <th scope="row" className="font-mono text-xs">
                {s}
              </th>
              <td>{d}</td>
            </tr>
          ))}
        </tbody>
      </TableScroll>
      <p>
        Transitions are enforced by a state machine. An action that is not allowed from the
        order&apos;s current status is rejected with a 4xx error and changes nothing.
      </p>

      <h2 id="actions">Staff actions</h2>
      <p>
        These endpoints move orders forward. Each one needs the listed permission (see{" "}
        <Link href="/docs/roles-and-permissions">Roles and permissions</Link>) and staff membership
        of the order&apos;s business.
      </p>
      <TableScroll label="Order actions" minWidth="min-w-[44rem]">
        <thead>
          <tr>
            <th scope="col">Endpoint</th>
            <th scope="col">Permission</th>
            <th scope="col">Effect</th>
          </tr>
        </thead>
        <tbody>
          {actions.map(([e, p, d]) => (
            <tr key={e}>
              <td>
                <code>{e}</code>
              </td>
              <td>
                <code>{p}</code>
              </td>
              <td>{d}</td>
            </tr>
          ))}
        </tbody>
      </TableScroll>
      <Callout title="Rejecting an order">
        <p>
          A rejection takes one reason from a fixed list: <code>PRINTER_UNAVAILABLE</code>,{" "}
          <code>CAPABILITY_UNAVAILABLE</code>, <code>SHOP_UNAVAILABLE</code> or{" "}
          <code>DOCUMENT_ISSUE</code>. A missing or unknown reason returns 400.
        </p>
      </Callout>

      <h2 id="payment-status">Payment status</h2>
      <TableScroll label="Payment statuses" minWidth="min-w-[30rem]">
        <thead>
          <tr>
            <th scope="col">Group</th>
            <th scope="col">Values</th>
            <th scope="col">Notes</th>
          </tr>
        </thead>
        <tbody>
          {enumRows.map(([g, v, n]) => (
            <tr key={g}>
              <th scope="row">{g}</th>
              <td>
                <code>{v}</code>
              </td>
              <td>{n}</td>
            </tr>
          ))}
        </tbody>
      </TableScroll>
      <p>
        Provider results arrive through the <Link href="/docs/webhooks">payment webhook</Link>.
        Staff can also record a payment taken at the counter with{" "}
        <code>POST /v1/shop/orders/:id/record-payment</code>.
      </p>

      <h2 id="print-job-status">Print job status</h2>
      <TableScroll label="Print job statuses" minWidth="min-w-[32rem]">
        <thead>
          <tr>
            <th scope="col">Status</th>
            <th scope="col">Meaning</th>
          </tr>
        </thead>
        <tbody>
          {jobRows.map(([s, d]) => (
            <tr key={s}>
              <th scope="row" className="font-mono text-xs">
                {s}
              </th>
              <td>{d}</td>
            </tr>
          ))}
        </tbody>
      </TableScroll>

      <h2 id="blocked">Why a job is blocked</h2>
      <p>
        When the allocation engine cannot place a job it records a <code>blockedReason</code> on the
        job, so staff see what to fix rather than a silent stall.
      </p>
      <TableScroll label="Blocked reasons" minWidth="min-w-[32rem]">
        <thead>
          <tr>
            <th scope="col">Reason</th>
            <th scope="col">Meaning</th>
          </tr>
        </thead>
        <tbody>
          {blocked.map(([s, d]) => (
            <tr key={s}>
              <th scope="row" className="font-mono text-xs">
                {s}
              </th>
              <td>{d}</td>
            </tr>
          ))}
        </tbody>
      </TableScroll>
    </DocPage>
  );
}
