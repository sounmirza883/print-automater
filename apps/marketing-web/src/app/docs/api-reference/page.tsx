import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocPage, EndpointTable, TableScroll } from "@/components/docs";
import type { Endpoint, TocItem } from "@/components/docs";
import { CodeBlock } from "@/components/pages";

export const metadata: Metadata = {
  title: "API reference",
  description:
    "The Print Automated REST API: base URL and versioning, JWT authentication with refresh tokens, the error format, rate limits, idempotency and every endpoint that exists today.",
  alternates: { canonical: "/docs/api-reference" },
};

const toc: TocItem[] = [
  { id: "basics", label: "Basics" },
  { id: "authentication", label: "Authentication" },
  { id: "errors", label: "Errors" },
  { id: "rate-limits", label: "Rate limits" },
  { id: "idempotency", label: "Idempotency" },
  { id: "customer", label: "Customer endpoints" },
  { id: "shop", label: "Shop endpoints" },
  { id: "agents", label: "Agent endpoints" },
  { id: "other", label: "Other" },
];

const loginExample = `curl -X POST https://api.example.com/v1/auth/login \\
  -H "Content-Type: application/json" \\
  -d '{ "email": "owner@example.com", "password": "correct horse battery" }'

# 200 OK
{
  "user": { "id": "0f8b...", "name": "Sana Khan", "email": "owner@example.com", "role": "SHOP_OWNER" },
  "accessToken": "eyJhbGciOi...FAKE_ACCESS_TOKEN",
  "refreshToken": "FAKE_REFRESH_TOKEN_0123456789"
}`;

const refreshExample = `curl -X POST https://api.example.com/v1/auth/refresh \\
  -H "Content-Type: application/json" \\
  -d '{ "refreshToken": "FAKE_REFRESH_TOKEN_0123456789" }'

# 200 OK  (a new pair; store the new refresh token)
{ "accessToken": "eyJhbGciOi...FAKE_NEW_ACCESS_TOKEN", "refreshToken": "FAKE_NEW_REFRESH_TOKEN_9876543210" }`;

const callExample = `curl https://api.example.com/v1/shop/orders?shopId=6ddee6f2-64f4-42ed-8e6e-f51691514da5 \\
  -H "Authorization: Bearer eyJhbGciOi...FAKE_ACCESS_TOKEN"`;

const errorExample = `HTTP/1.1 403 Forbidden
x-request-id: 5c1e0e9a-0000-4000-8000-000000000002

{
  "error_code": "FORBIDDEN",
  "message": "You do not have access to this shop.",
  "retryable": false,
  "request_id": "5c1e0e9a-0000-4000-8000-000000000002"
}`;

const orderFlow = `# 1. Declare the file (PDF, JPG, PNG or DOCX, max 25 MB)
POST /v1/documents
{ "filename": "menu.pdf", "mimeType": "application/pdf", "sizeBytes": 482113 }
-> { "documentId": "<uuid>", "uploadUrl": "<presigned upload URL>" }

# 2. PUT the bytes to uploadUrl, then confirm
POST /v1/documents/<documentId>/upload
-> { "id": "...", "filename": "menu.pdf", "status": "...", "pageCount": 12, "rejectionReason": null, "createdAt": "..." }

# 3. Quote, create the order (send an Idempotency-Key), then pay
POST /v1/orders/quote
POST /v1/orders            # Idempotency-Key: <uuid>
POST /v1/payments/checkout { "orderId": "<uuid>" }  -> { "checkoutUrl": "https://..." }`;

const customer: Endpoint[] = [
  {
    method: "POST",
    path: "/v1/auth/register",
    access: "Public, 3/hour/IP",
    purpose:
      "Create a customer account (name, email, password 8+ chars, optional phone). Returns user and tokens.",
  },
  {
    method: "POST",
    path: "/v1/auth/login",
    access: "Public, 5/15 min",
    purpose: "Exchange email and password for tokens.",
  },
  {
    method: "POST",
    path: "/v1/auth/refresh",
    access: "Refresh token",
    purpose: "Rotate the token pair.",
  },
  {
    method: "POST",
    path: "/v1/auth/logout",
    access: "Refresh token",
    purpose: "Revoke the session. 204 No Content.",
  },
  {
    method: "POST",
    path: "/v1/auth/recovery",
    access: "Public",
    purpose: "Request password recovery for an email. 204 No Content.",
  },
  {
    method: "GET",
    path: "/v1/shops",
    access: "Public",
    purpose: "List shops with name, address, status and declared capabilities.",
  },
  {
    method: "POST",
    path: "/v1/documents",
    access: "Signed in, 20/hour",
    purpose: "Declare an upload; returns documentId and a presigned uploadUrl.",
  },
  {
    method: "POST",
    path: "/v1/documents/:id/upload",
    access: "Owner of document",
    purpose: "Confirm the upload so processing starts.",
  },
  {
    method: "GET",
    path: "/v1/documents/:id",
    access: "Owner of document",
    purpose: "Processing status, page count, rejection reason.",
  },
  {
    method: "GET",
    path: "/v1/documents/:id/download",
    access: "Owner of document",
    purpose: "Stream the decrypted file.",
  },
  {
    method: "DELETE",
    path: "/v1/documents/:id",
    access: "Owner of document",
    purpose: "Delete a document. 204 No Content.",
  },
  {
    method: "POST",
    path: "/v1/orders/quote",
    access: "Signed in",
    purpose: "Price a print configuration. Nothing is saved.",
  },
  {
    method: "POST",
    path: "/v1/orders",
    access: "Signed in",
    purpose: "Create an order. Supports Idempotency-Key.",
  },
  { method: "GET", path: "/v1/orders", access: "Signed in", purpose: "Your orders." },
  { method: "GET", path: "/v1/orders/:id", access: "Signed in", purpose: "One of your orders." },
  {
    method: "POST",
    path: "/v1/orders/:id/cancel",
    access: "Signed in",
    purpose: "Cancel one of your orders (only while its status allows).",
  },
  {
    method: "GET",
    path: "/v1/orders/:id/invoice",
    access: "Signed in",
    purpose: "Invoice for an order.",
  },
  {
    method: "POST",
    path: "/v1/payments/checkout",
    access: "Signed in, 10/hour",
    purpose: "Start payment. Returns checkoutUrl.",
  },
];

const shopOrders: Endpoint[] = [
  {
    method: "GET",
    path: "/v1/shop/orders?shopId=",
    access: "VIEW_ORDERS",
    purpose: "The shop's order queue.",
  },
  {
    method: "POST",
    path: "/v1/shop/orders",
    access: "CREATE_ORDERS",
    purpose: "Create a counter order for a walk-in customer record.",
  },
  { method: "GET", path: "/v1/shop/orders/:id", access: "VIEW_ORDERS", purpose: "One order." },
  {
    method: "GET",
    path: "/v1/shop/orders/:id/invoice",
    access: "VIEW_ORDERS",
    purpose: "Invoice.",
  },
  { method: "POST", path: "/v1/shop/orders/:id/accept", access: "EDIT_ORDERS", purpose: "Accept." },
  {
    method: "POST",
    path: "/v1/shop/orders/:id/reject",
    access: "EDIT_ORDERS",
    purpose: "Reject with a reason.",
  },
  {
    method: "POST",
    path: "/v1/shop/orders/:id/record-payment",
    access: "EDIT_ORDERS",
    purpose: "Record a payment taken at the counter.",
  },
  {
    method: "POST",
    path: "/v1/shop/orders/:id/ready",
    access: "EDIT_ORDERS",
    purpose: "Mark ready for collection.",
  },
  {
    method: "POST",
    path: "/v1/shop/orders/:id/quality-check",
    access: "QUALITY_CHECK",
    purpose: "Record a quality verdict.",
  },
  {
    method: "POST",
    path: "/v1/shop/orders/:id/complete",
    access: "EDIT_ORDERS",
    purpose: "Complete.",
  },
  {
    method: "POST",
    path: "/v1/shop/orders/:id/retry-print",
    access: "EDIT_ORDERS",
    purpose: "Retry a failed print.",
  },
  {
    method: "POST",
    path: "/v1/shop/orders/:id/resolve-unknown",
    access: "EDIT_ORDERS",
    purpose: "Resolve an unknown print outcome.",
  },
  {
    method: "POST",
    path: "/v1/shop/orders/:id/change-printer",
    access: "EDIT_ORDERS",
    purpose: "Change the printer.",
  },
  {
    method: "GET, PUT",
    path: "/v1/shop/orders/:id/delivery",
    access: "VIEW_ORDERS, MANAGE_DELIVERY",
    purpose: "Read or set delivery details.",
  },
  {
    method: "POST",
    path: "/v1/shop/orders/:id/delivery/status",
    access: "MANAGE_DELIVERY",
    purpose: "Update delivery status.",
  },
  {
    method: "GET, POST, PATCH",
    path: "/v1/shop/customers[/:id]",
    access: "VIEW / CREATE / EDIT_ORDERS",
    purpose: "Walk-in customer records.",
  },
];

const shopJobs: Endpoint[] = [
  {
    method: "POST",
    path: "/v1/print-jobs/:id/reassign",
    access: "ASSIGN_JOBS",
    purpose: "Move a job to another printer.",
  },
  {
    method: "POST",
    path: "/v1/print-jobs/:id/assign-operator",
    access: "ASSIGN_JOBS",
    purpose: "Assign an operator.",
  },
  { method: "POST", path: "/v1/print-jobs/:id/pause", access: "PAUSE_JOBS", purpose: "Pause." },
  { method: "POST", path: "/v1/print-jobs/:id/resume", access: "PAUSE_JOBS", purpose: "Resume." },
  {
    method: "POST",
    path: "/v1/print-jobs/:id/reprint",
    access: "REPRINT_JOBS",
    purpose: "Create a reprint with a reason.",
  },
  {
    method: "POST",
    path: "/v1/print-jobs/:id/failure-reason",
    access: "RECORD_JOB_FAILURE",
    purpose: "Record why a job failed.",
  },
];

const shopConfig: Endpoint[] = [
  {
    method: "GET, POST",
    path: "/v1/shop/printers",
    access: "Shop roles / MANAGE_PRINTERS",
    purpose: "List (query shopId) and register printers.",
  },
  {
    method: "PATCH, DELETE",
    path: "/v1/shop/printers/:id",
    access: "MANAGE_PRINTERS",
    purpose: "Rename, enable or disable, set capabilities and page limit; remove.",
  },
  {
    method: "POST",
    path: "/v1/shop/agents/pairing-code",
    access: "MANAGE_PRINTERS",
    purpose: "Issue a one-time agent pairing code.",
  },
  {
    method: "GET, POST",
    path: "/v1/shop/pricing-rules",
    access: "MANAGE_PRICES",
    purpose: "List versions and create the next version.",
  },
  {
    method: "GET, POST, PATCH",
    path: "/v1/shop/products[/:id]",
    access: "MANAGE_PRICES",
    purpose: "Product catalogue.",
  },
  {
    method: "GET, PUT",
    path: "/v1/shop/settings",
    access: "VIEW_SETTINGS (write per key)",
    purpose: "Business and automation settings with optimistic versioning.",
  },
  {
    method: "GET, POST, PATCH, DELETE",
    path: "/v1/shop/printer-rules[/:id]",
    access: "VIEW_SETTINGS / MANAGE_AUTOMATION",
    purpose: "Ordered printer automation rules; PUT /order reorders.",
  },
  {
    method: "GET",
    path: "/v1/shop/staff/me",
    access: "Staff",
    purpose: "The businesses you belong to.",
  },
  {
    method: "POST, PATCH, DELETE",
    path: "/v1/shop/staff[/:id[/role]]",
    access: "MANAGE_USERS",
    purpose: "Add staff, change a role, remove staff.",
  },
  {
    method: "GET, PUT, POST, PATCH",
    path: "/v1/shop/inventory/...",
    access: "VIEW_INVENTORY / MANAGE_INVENTORY",
    purpose: "settings, summary, alerts, items, and item movements.",
  },
  {
    method: "GET, POST, PATCH, DELETE",
    path: "/v1/shop/suppliers/... and /supplier-products/:id",
    access: "MANAGE_SUPPLIERS",
    purpose: "Suppliers and the products they supply.",
  },
  {
    method: "GET, POST, PATCH",
    path: "/v1/shop/purchase-orders/...",
    access: "MANAGE_INVENTORY",
    purpose: "Purchase orders: create, edit, payment, order, cancel, receive.",
  },
];

const agents: Endpoint[] = [
  {
    method: "POST",
    path: "/v1/agents/register",
    access: "Pairing code, 10/min/device",
    purpose: "Register a device with its public key. Returns deviceId, shopId.",
  },
  {
    method: "POST",
    path: "/v1/agents/authenticate/challenge",
    access: "Public, 10/min/device",
    purpose: "Get a nonce.",
  },
  {
    method: "POST",
    path: "/v1/agents/authenticate",
    access: "Signature, 10/min/device",
    purpose: "Exchange a signed nonce for a 15-minute accessToken.",
  },
  {
    method: "POST",
    path: "/v1/agents/heartbeat",
    access: "Agent token",
    purpose: "Report printers and their ONLINE or ERROR status.",
  },
  {
    method: "GET",
    path: "/v1/agents/jobs?wait=",
    access: "Agent token",
    purpose: "Long-poll (1 to 25 s) for the next job. 204 if none.",
  },
  {
    method: "POST",
    path: "/v1/agents/jobs/:id/claim",
    access: "Agent token",
    purpose: "Atomically claim a job.",
  },
  {
    method: "GET",
    path: "/v1/agents/jobs/:id/document",
    access: "Agent token",
    purpose: "Download the job's PDF.",
  },
  {
    method: "POST",
    path: "/v1/agents/jobs/:id/status",
    access: "Agent token, Idempotency-Key",
    purpose: "Report PRINTING, PRINTED, FAILED or UNKNOWN.",
  },
];

const other: Endpoint[] = [
  { method: "GET", path: "/v1/health", access: "Public", purpose: "Liveness." },
  { method: "GET", path: "/v1/health/ready", access: "Public", purpose: "Readiness." },
  {
    method: "GET",
    path: "/v1/admin/{businesses,users,audit,system}",
    access: "ADMIN role",
    purpose: "Platform administration (Print Automated staff only).",
  },
  {
    method: "POST",
    path: "/v1/webhooks/payment/:provider",
    access: "Signature",
    purpose: "Inbound payment provider webhook. See Webhooks.",
  },
];

export default function ApiReferencePage() {
  return (
    <DocPage
      href="/docs/api-reference"
      title="API reference"
      lede="A JSON REST API over HTTPS. This page lists what exists today: authentication, errors, limits and endpoints. Request bodies are validated, and invalid ones return 400."
      toc={toc}
    >
      <h2 id="basics">Basics</h2>
      <ul>
        <li>
          <strong>Base URL.</strong> Your deployment&apos;s API origin, followed by <code>/v1</code>
          . Examples here use <code>https://api.example.com</code>. The version is part of the path.
        </li>
        <li>
          <strong>Format.</strong> Requests and responses are JSON. Money is integer minor units;
          identifiers are UUIDs; timestamps are ISO 8601.
        </li>
        <li>
          <strong>Request IDs.</strong> Every response carries an <code>x-request-id</code> header.
          Send your own to correlate, and quote it when you contact support.
        </li>
        <li>
          <strong>Business scope.</strong> Shop routes address a business by <code>shopId</code> (in
          the body or query) or through the record you name. You must be active staff of it.
        </li>
      </ul>

      <h2 id="authentication">Authentication</h2>
      <p>
        Staff and customers sign in with email and password and get a short-lived JWT{" "}
        <strong>access token</strong> (15 minutes) plus a <strong>refresh token</strong> (30 days,
        rotated on every use; replaying an old one revokes the session). Send the access token on
        every request:
      </p>
      <CodeBlock language="http" code={"Authorization: Bearer <accessToken>"} />
      <CodeBlock language="bash" label="Sign in" code={loginExample} />
      <CodeBlock
        language="bash"
        label="Refresh before the access token expires"
        code={refreshExample}
      />
      <CodeBlock language="bash" label="Call an endpoint" code={callExample} />
      <p>
        A missing, invalid or expired token returns 401; a valid token without the required role or
        permission returns 403. Self-registration always creates a <code>CUSTOMER</code>; staff
        roles are granted by a business owner or manager (see{" "}
        <Link href="/docs/roles-and-permissions">Roles and permissions</Link>). Printer agents use a
        separate signature-based flow, described under <a href="#agents">Agent endpoints</a>.
      </p>
      <Callout tone="planned" title="API keys are planned">
        <p>
          There are no long-lived API keys or OAuth apps yet. Integrations today sign in as a staff
          user. Dedicated integration credentials are planned.
        </p>
      </Callout>

      <h2 id="errors">Errors</h2>
      <p>Every error, from any endpoint, has the same four-field body:</p>
      <CodeBlock language="http" label="Error response" code={errorExample} />
      <TableScroll label="Error fields" minWidth="min-w-[30rem]">
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">
              <code>error_code</code>
            </th>
            <td>
              Stable machine-readable code, such as <code>RATE_LIMITED</code> or{" "}
              <code>PAIRING_CODE_CONSUMED</code>.
            </td>
          </tr>
          <tr>
            <th scope="row">
              <code>message</code>
            </th>
            <td>Human-readable text, safe to show to users. Never a stack trace.</td>
          </tr>
          <tr>
            <th scope="row">
              <code>retryable</code>
            </th>
            <td>
              Whether repeating the same request may succeed. 5xx and rate limits are retryable.
            </td>
          </tr>
          <tr>
            <th scope="row">
              <code>request_id</code>
            </th>
            <td>
              Matches the <code>x-request-id</code> header and the server log line.
            </td>
          </tr>
        </tbody>
      </TableScroll>
      <p>
        Validation failures return 400. Unexpected server errors return a generic 500 with{" "}
        <code>retryable: true</code>; the real cause is only in server logs.
      </p>

      <h2 id="rate-limits">Rate limits</h2>
      <p>
        Only the endpoints below are rate limited. Exceeding a limit returns 429 with error code{" "}
        <code>RATE_LIMITED</code> and a <code>Retry-After</code> header in seconds.
      </p>
      <TableScroll label="Rate limits" minWidth="min-w-[30rem]">
        <thead>
          <tr>
            <th scope="col">Endpoint</th>
            <th scope="col">Limit</th>
            <th scope="col">Counted per</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">POST /v1/auth/register</th>
            <td>3 per hour</td>
            <td>IP address</td>
          </tr>
          <tr>
            <th scope="row">POST /v1/auth/login</th>
            <td>5 per 15 minutes</td>
            <td>IP address and email</td>
          </tr>
          <tr>
            <th scope="row">POST /v1/documents</th>
            <td>20 per hour</td>
            <td>User</td>
          </tr>
          <tr>
            <th scope="row">POST /v1/payments/checkout</th>
            <td>10 per hour</td>
            <td>User</td>
          </tr>
          <tr>
            <th scope="row">Agent register and authenticate</th>
            <td>10 per minute</td>
            <td>Device ID</td>
          </tr>
        </tbody>
      </TableScroll>

      <h2 id="idempotency">Idempotency</h2>
      <p>
        <code>POST /v1/orders</code> and <code>POST /v1/agents/jobs/:id/status</code> honour an{" "}
        <code>Idempotency-Key</code> header. Repeating a request with the same key replays the first
        response instead of doing the work twice, so a retry after a dropped connection never
        creates a second order. Reusing a key with a different body returns 422 (
        <code>IDEMPOTENCY_KEY_REUSED</code>); a duplicate that arrives while the first is still
        running returns 409.
      </p>

      <h2 id="customer">Customer endpoints</h2>
      <p>The customer web app uses these. A typical order looks like this:</p>
      <CodeBlock language="text" label="Placing an order" code={orderFlow} />
      <EndpointTable label="Customer endpoints" rows={customer} />

      <h2 id="shop">Shop endpoints</h2>
      <p>
        Access shows the permission required, in addition to being active staff of the business.
        Where several methods share a row, the permission listed is the one the row&apos;s reads and
        writes need, in order.
      </p>
      <h3>Orders and customers</h3>
      <EndpointTable label="Shop order endpoints" rows={shopOrders} />
      <h3>Print jobs</h3>
      <EndpointTable label="Print job endpoints" rows={shopJobs} />
      <h3>Configuration, people and stock</h3>
      <EndpointTable label="Shop configuration endpoints" rows={shopConfig} />

      <h2 id="agents">Agent endpoints</h2>
      <p>
        Used by the <Link href="/docs/printer-agent">printer agent</Link>. Agent tokens are signed
        with a separate secret from user tokens and only work on these routes.
      </p>
      <EndpointTable label="Agent endpoints" rows={agents} />

      <h2 id="other">Other</h2>
      <EndpointTable label="Other endpoints" rows={other} />

      <Callout tone="planned" title="Not available yet">
        <p>
          A published OpenAPI document, SDKs, cursor pagination conventions, and outbound event
          webhooks are not available yet. Outbound webhooks are sketched on the{" "}
          <Link href="/docs/webhooks">Webhooks</Link> page.
        </p>
      </Callout>
    </DocPage>
  );
}
