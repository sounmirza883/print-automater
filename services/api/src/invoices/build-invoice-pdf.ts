import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { Quote } from "@print-automated/pricing";

export interface InvoiceData {
  publicOrderNumber: string;
  shopName: string;
  customerName: string;
  documentFilename: string;
  createdAt: Date;
  /** §82: the order's OWN stored `pricingSnapshot.quote` -- never a
   * live re-price. This function has no access to a live PricingRule
   * at all, structurally: it only ever sees what the caller already
   * read off the order row. */
  quote: Quote;
}

const PAGE_WIDTH = 595.28; // A4 portrait, points
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;

function formatMoney(amountMinor: number, currency: string): string {
  // Minor units -> major, 2dp -- display-only formatting; every actual
  // computation anywhere else in this codebase still stays on integer
  // minor units (§19's own "no floating-point money" rule is about
  // arithmetic, not string rendering).
  return `${currency} ${(amountMinor / 100).toFixed(2)}`;
}

/** §36/17.7: renders a real PDF invoice/receipt from an order's own
 * stored pricing snapshot -- pdf-lib (already a dependency of
 * services/worker, for document inspection) turns out to be a
 * general-purpose PDF library, not an inspection-only one: it can
 * create a brand new PDFDocument and draw text on it just as well as
 * it can read an existing one, so this reuses it rather than adding a
 * new PDF-generation dependency. Pure rendering -- every value is
 * already resolved by the caller (InvoicesService), no I/O here. */
export async function buildInvoicePdf(data: InvoiceData): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let y = PAGE_HEIGHT - MARGIN;
  const black = rgb(0, 0, 0);

  function line(text: string, opts: { bold?: boolean; size?: number; gap?: number } = {}): void {
    const size = opts.size ?? 11;
    page.drawText(text, {
      x: MARGIN,
      y,
      size,
      font: opts.bold ? boldFont : font,
      color: black,
    });
    y -= (opts.gap ?? size) + 6;
  }

  line("INVOICE / RECEIPT", { bold: true, size: 20, gap: 20 });
  line(`Order: ${data.publicOrderNumber}`, { bold: true });
  line(`Date: ${data.createdAt.toISOString().slice(0, 10)}`);
  line(`Shop: ${data.shopName}`);
  line(`Customer: ${data.customerName}`);
  line(`Document: ${data.documentFilename}`);
  y -= 10;

  line("Line items", { bold: true });
  for (const item of data.quote.lineItems) {
    line(`${item.label}  ${formatMoney(item.amountMinor, data.quote.currency)}`);
  }
  y -= 4;
  line(`Subtotal: ${formatMoney(data.quote.subtotalMinor, data.quote.currency)}`);
  if (data.quote.taxMinor > 0) {
    line(`Tax: ${formatMoney(data.quote.taxMinor, data.quote.currency)}`);
  }
  line(`Platform fee: ${formatMoney(data.quote.platformFeeMinor, data.quote.currency)}`);
  line(`Total: ${formatMoney(data.quote.totalMinor, data.quote.currency)}`, {
    bold: true,
    size: 13,
  });

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}
