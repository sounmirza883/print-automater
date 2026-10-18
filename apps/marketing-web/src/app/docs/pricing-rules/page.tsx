import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocPage, TableScroll } from "@/components/docs";
import type { TocItem } from "@/components/docs";
import { CodeBlock } from "@/components/pages";

export const metadata: Metadata = {
  title: "Pricing rules",
  description:
    "How Print Automated calculates a quote: per-page price, colour, paper size and type surcharges, finishing, minimum charge, tax and platform fee, all in integer minor units.",
  alternates: { canonical: "/docs/pricing-rules" },
};

const toc: TocItem[] = [
  { id: "principles", label: "Principles" },
  { id: "fields", label: "Rule fields" },
  { id: "calculation", label: "How a total is built" },
  { id: "example", label: "Worked example" },
  { id: "versions", label: "Versions and snapshots" },
  { id: "endpoints", label: "Endpoints" },
];

const ruleExample = `{
  "shopId": "6ddee6f2-64f4-42ed-8e6e-f51691514da5",
  "currency": "PKR",
  "pricePerPageMinor": 500,
  "colorSurchargePerPageMinor": 1500,
  "minimumChargeMinor": 2000,
  "paperSizeSurchargePerPageMinor": { "A3": 1000 },
  "paperTypeSurchargePerPageMinor": { "PHOTO": 2500 },
  "finishingChargeMinor": { "STAPLING": 300, "BINDING": 8000 },
  "taxRateBasisPoints": 1700,
  "otherCharges": [{ "label": "Loyalty discount", "amountMinor": -500 }]
}`;

const quoteRequest = `curl -X POST https://api.example.com/v1/orders/quote \\
  -H "Authorization: Bearer eyJhbGciOi...FAKE_ACCESS_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "documentId": "0b6f1f0e-0000-4000-8000-000000000001",
    "shopId": "6ddee6f2-64f4-42ed-8e6e-f51691514da5",
    "printConfiguration": {
      "pages": { "mode": "range", "from": 1, "to": 10 },
      "copies": 2,
      "paperSize": "A4",
      "color": "COLOR",
      "sides": "DOUBLE",
      "orientation": "PORTRAIT"
    }
  }'`;

const quoteResponse = `{
  "documentId": "0b6f1f0e-0000-4000-8000-000000000001",
  "shopId": "6ddee6f2-64f4-42ed-8e6e-f51691514da5",
  "lineItems": [
    { "label": "Page price", "amountMinor": 10000 },
    { "label": "Color surcharge", "amountMinor": 30000 }
  ],
  "subtotalMinor": 40000,
  "taxMinor": 6800,
  "platformFeeMinor": 0,
  "totalMinor": 46800,
  "currency": "PKR"
}`;

const fields: [string, string, string][] = [
  ["currency", "3-letter code", "Currency of every amount in the rule."],
  ["pricePerPageMinor", "integer >= 0", "Price of one page, per copy."],
  ["colorSurchargePerPageMinor", "integer >= 0", "Added per page, per copy, for colour jobs."],
  [
    "minimumChargeMinor",
    "integer >= 0",
    "Floor for the subtotal. A smaller job gets a visible Minimum order adjustment line.",
  ],
  [
    "paperSizeSurchargePerPageMinor",
    "map, optional",
    "Per page surcharge keyed by A4, A5, A3, LETTER, LEGAL or CUSTOM.",
  ],
  [
    "paperTypeSurchargePerPageMinor",
    "map, optional",
    "Per page surcharge keyed by STANDARD, PREMIUM, CARD or PHOTO.",
  ],
  [
    "finishingChargeMinor",
    "map, optional",
    "Flat charge once per job for each selected finishing: STAPLING, BINDING, CUTTING, LAMINATION.",
  ],
  [
    "taxRateBasisPoints",
    "0 to 10000, optional",
    "Tax in basis points, so 1700 is 17%. Applied to the subtotal after the minimum.",
  ],
  [
    "otherCharges",
    "list of label and amount",
    "Extra lines. A negative amount works as a discount.",
  ],
];

export default function PricingRulesPage() {
  return (
    <DocPage
      href="/docs/pricing-rules"
      title="Pricing rules"
      lede="Every price a customer sees comes from one pure calculation on the server, using your current pricing rule. There is no hidden math and no client-supplied total."
      toc={toc}
    >
      <h2 id="principles">Principles</h2>
      <ul>
        <li>
          <strong>Server is authoritative.</strong> The quote endpoint has no price field at all; a{" "}
          <code>total</code> sent by a client is discarded, and orders are re-priced from scratch
          when created.
        </li>
        <li>
          <strong>Integer minor units.</strong> All money is stored as whole paisa or cents. No
          floating-point arithmetic touches a price.
        </li>
        <li>
          <strong>Itemised.</strong> The line items always add up to the subtotal shown to the
          customer.
        </li>
        <li>
          <strong>Sides and orientation are free.</strong> Prices count logical pages, so single and
          double-sided cost the same.
        </li>
      </ul>

      <h2 id="fields">Rule fields</h2>
      <TableScroll label="Pricing rule fields" minWidth="min-w-[40rem]">
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Type</th>
            <th scope="col">Meaning</th>
          </tr>
        </thead>
        <tbody>
          {fields.map(([f, t, m]) => (
            <tr key={f}>
              <th scope="row" className="font-mono text-xs">
                {f}
              </th>
              <td>{t}</td>
              <td>{m}</td>
            </tr>
          ))}
        </tbody>
      </TableScroll>
      <CodeBlock language="json" label="Body for POST /v1/shop/pricing-rules" code={ruleExample} />

      <h2 id="calculation">How a total is built</h2>
      <ol>
        <li>
          Work out the page count: all pages of the document, or an inclusive range. Multiply by
          copies to get the number of <em>units</em>.
        </li>
        <li>
          Add page price, colour surcharge (colour jobs only), paper size and type surcharges (all
          per unit), finishing charges (flat, once per job) and other charges.
        </li>
        <li>If the subtotal is below the minimum charge, add a Minimum order adjustment line.</li>
        <li>Calculate tax on that subtotal, to the nearest minor unit.</li>
        <li>
          Add the platform fee, a platform-wide setting that is not part of any shop rule. Total is
          subtotal + tax + platform fee.
        </li>
      </ol>

      <h2 id="example">Worked example</h2>
      <p>
        Pages 1 to 10, 2 copies, A4, colour, priced by a rule with a page price of 500, a colour
        surcharge of 1,500, a minimum of 2,000, 17% tax and no other charges: 20 units. Page price
        20 x 500 = 10,000. Colour 20 x 1,500 = 30,000. Subtotal 40,000 (400.00), tax 6,800, total
        46,800 (468.00).
      </p>
      <CodeBlock language="bash" label="Request a quote" code={quoteRequest} />
      <CodeBlock language="json" label="Response, 200 OK" code={quoteResponse} />

      <h2 id="versions">Versions and snapshots</h2>
      <p>
        Saving a rule never edits the old one: the server creates the next version (you cannot
        choose the version number). When an order is created, the exact rule values and the
        resulting quote are stored on the order as its <code>pricingSnapshot</code>, so repricing
        your shop later never changes an order that already exists.
      </p>
      <Callout tone="planned" title="Not modelled yet">
        <p>
          Priority (urgent) surcharges and delivery fees are not part of the price calculation
          today.
        </p>
      </Callout>

      <h2 id="endpoints">Endpoints</h2>
      <ul>
        <li>
          <code>POST /v1/orders/quote</code> - any signed-in user. Returns a quote without saving
          anything.
        </li>
        <li>
          <code>GET /v1/shop/pricing-rules?shopId=</code> and{" "}
          <code>POST /v1/shop/pricing-rules</code> - need <code>MANAGE_PRICES</code>.
        </li>
        <li>
          <code>GET/POST /v1/shop/products</code> and <code>PATCH /v1/shop/products/:id</code> -
          product catalogue, also <code>MANAGE_PRICES</code>.
        </li>
      </ul>
      <p>
        Full details are in the <Link href="/docs/api-reference#shop">API reference</Link>.
      </p>
    </DocPage>
  );
}
