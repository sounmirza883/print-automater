import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocPage } from "@/components/docs";
import type { TocItem } from "@/components/docs";
import { CodeBlock } from "@/components/pages";

export const metadata: Metadata = {
  title: "Getting started",
  description:
    "Set up your business on Print Automated, set prices, pair a printer agent, share your ordering link and process your first order.",
  alternates: { canonical: "/docs/getting-started" },
};

const toc: TocItem[] = [
  { id: "before-you-begin", label: "Before you begin" },
  { id: "business", label: "1. Set up your business" },
  { id: "prices", label: "2. Set your prices" },
  { id: "printer", label: "3. Pair a printer" },
  { id: "share", label: "4. Share your ordering link" },
  { id: "first-order", label: "5. Handle your first order" },
];

const pricingExample = `curl -X POST https://api.example.com/v1/shop/pricing-rules \\
  -H "Authorization: Bearer eyJhbGciOi...FAKE_ACCESS_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "shopId": "6ddee6f2-64f4-42ed-8e6e-f51691514da5",
    "currency": "PKR",
    "pricePerPageMinor": 500,
    "colorSurchargePerPageMinor": 1500,
    "minimumChargeMinor": 2000,
    "otherCharges": []
  }'`;

const pairingExample = `curl -X POST https://api.example.com/v1/shop/agents/pairing-code \\
  -H "Authorization: Bearer eyJhbGciOi...FAKE_ACCESS_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{ "shopId": "6ddee6f2-64f4-42ed-8e6e-f51691514da5" }'

# 201 Created
# { "code": "K7M2XQ9P", "expiresAt": "2026-01-01T10:10:00.000Z" }`;

export default function GettingStartedPage() {
  return (
    <DocPage
      href="/docs/getting-started"
      title="Getting started"
      lede="From an empty account to a customer order printing on your own printer. Plan for about half an hour, most of it installing the printer agent."
      toc={toc}
    >
      <h2 id="before-you-begin">Before you begin</h2>
      <ul>
        <li>
          A Windows PC connected to the printers you want to use. The printer agent runs there, so
          it should be on during opening hours.
        </li>
        <li>
          A staff account with the <strong>Owner</strong> or <strong>Manager</strong> role. See{" "}
          <Link href="/docs/roles-and-permissions">Roles and permissions</Link>.
        </li>
        <li>
          The <strong>Shop app</strong> (the mobile app for the production floor) if you want to
          accept and track orders from a phone or tablet.
        </li>
      </ul>

      <h2 id="business">1. Set up your business</h2>
      <p>
        Your business is a tenant in Print Automated. The screens call it a <em>Business</em>; the
        API and code call it a <code>shop</code>, and its identifier is the <code>shopId</code> you
        will see in requests.
      </p>
      <Callout tone="planned" title="Self-serve business creation is planned">
        <p>
          There is no public endpoint for creating a business yet. Businesses are provisioned for
          you today. Once yours exists, the owner adds the rest of the team with{" "}
          <code>POST /v1/shop/staff</code> (needs the <code>MANAGE_USERS</code> permission), giving
          each person one of the roles Owner, Manager, Counter, Operator or Printer manager.
        </p>
      </Callout>
      <p>
        Sign in to the Shop app with your staff email and password. The app has four tabs:{" "}
        <strong>Home</strong>, <strong>Orders</strong>, <strong>Printers</strong> and{" "}
        <strong>More</strong>.
      </p>

      <h2 id="prices">2. Set your prices</h2>
      <p>
        Prices are stored as a versioned <strong>pricing rule</strong>. Every change creates a new
        version, and orders already placed keep the version they were quoted with. All amounts are
        integers in minor units (paisa or cents), never decimals. The example below charges 5.00 a
        page, 15.00 extra per colour page, with a 20.00 minimum.
      </p>
      <CodeBlock language="bash" label="Create a pricing rule" code={pricingExample} />
      <p>
        Per-size and per-paper-type surcharges, finishing charges (stapling, binding, cutting,
        lamination) and a tax rate can be added to the same rule. The full model, including how
        totals are calculated, is in <Link href="/docs/pricing-rules">Pricing rules</Link>.
      </p>
      <Callout title="Where to edit prices">
        <p>
          Pricing is managed through the API today (<code>/v1/shop/pricing-rules</code>). A
          browser-based back office for it is planned.
        </p>
      </Callout>

      <h2 id="printer">3. Pair a printer</h2>
      <p>
        Printers are connected by the <Link href="/docs/printer-agent">printer agent</Link>, a small
        Windows program that prints customer jobs to the printers installed on that PC.
      </p>
      <ol>
        <li>
          In <strong>Printers</strong>, choose <strong>Pair a computer</strong> to get a one-time{" "}
          <strong>pairing code</strong> for your business. It is 8 characters, works once and
          expires after 10 minutes. You need the <code>MANAGE_PRINTERS</code> permission.
        </li>
        <li>
          Install the agent on the shop PC. Its page (<code>http://127.0.0.1:7171</code>) opens when
          the installer finishes: enter the code there.
        </li>
        <li>
          Within about 30 seconds the agent reports the printers Windows can see. Check them on the{" "}
          <strong>Printers</strong> tab and enable the ones you want to use.
        </li>
      </ol>
      <CodeBlock language="bash" label="Issue a pairing code" code={pairingExample} />

      <h2 id="share">4. Share your ordering link</h2>
      <p>
        Customers order through the customer web app: they sign up, <strong>upload</strong> a file
        (PDF, JPG, PNG or DOCX), <strong>configure</strong> pages, copies, paper size, colour and
        sides, <strong>review</strong> the live price and pay. Shops that are open and accepting
        orders are listed publicly at <code>GET /v1/shops</code>, so a customer can choose yours.
      </p>
      <p>
        Share the link to your customer app on your window, receipts, social pages and website. The
        price a customer sees is always calculated by the server from your current pricing rule.
      </p>

      <h2 id="first-order">5. Handle your first order</h2>
      <ol>
        <li>
          The order arrives in the <strong>Orders</strong> tab once payment is confirmed.
        </li>
        <li>
          Accept it (or reject it with a reason). With automatic printer assignment on, the job is
          routed to a compatible printer; otherwise a staff member assigns one.
        </li>
        <li>
          The agent prints the job and reports back. Mark the order ready for collection, then
          complete it when the customer picks it up.
        </li>
      </ol>
      <p>
        Every state along the way is described in{" "}
        <Link href="/docs/order-lifecycle">Order lifecycle</Link>. To build on top of this, continue
        to the <Link href="/docs/api-reference">API reference</Link>.
      </p>
    </DocPage>
  );
}
