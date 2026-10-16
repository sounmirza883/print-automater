import { PDFDocument } from "pdf-lib";
import type { InvoiceData } from "./build-invoice-pdf.js";
import { buildInvoicePdf } from "./build-invoice-pdf.js";

const BASE: InvoiceData = {
  publicOrderNumber: "PA-20261016-000030",
  shopName: "Downtown Print & Copy",
  customerName: "Check Bot",
  documentFilename: "thesis.pdf",
  createdAt: new Date("2026-10-16T13:41:00Z"),
  quote: {
    lineItems: [
      { label: "Page price", amountMinor: 1000 },
      { label: "Minimum order adjustment", amountMinor: 4000 },
    ],
    subtotalMinor: 5000,
    taxMinor: 0,
    platformFeeMinor: 2000,
    totalMinor: 7000,
    currency: "PKR",
  },
};

async function pageCount(buffer: Buffer): Promise<number> {
  return (await PDFDocument.load(buffer)).getPageCount();
}

describe("buildInvoicePdf", () => {
  it("renders a one-page PDF for an ordinary order", async () => {
    const pdf = await buildInvoicePdf(BASE);
    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(await pageCount(pdf)).toBe(1);
  });

  it("still renders when a name or file name has characters the PDF fonts cannot draw", async () => {
    const pdf = await buildInvoicePdf({
      ...BASE,
      customerName: "علی حسن",
      documentFilename: "رپورٹ.pdf",
    });
    expect(await pageCount(pdf)).toBe(1);
  });

  it("continues onto a second page when the line items do not fit, and keeps the tax row", async () => {
    const lineItems = Array.from({ length: 24 }, (_, i) => ({
      label: `Colour pages, batch ${i + 1}`,
      amountMinor: 12_345,
    }));
    const pdf = await buildInvoicePdf({
      ...BASE,
      quote: { ...BASE.quote, lineItems, taxMinor: 15_000, totalMinor: 317_000 },
    });
    expect(await pageCount(pdf)).toBe(2);
  });
});
