import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { create as createQr } from "qrcode";
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
const MARGIN = 48;
const RIGHT = PAGE_WIDTH - MARGIN;

const HEADER_HEIGHT = 128;
const FOOTER_Y = 36;
/** Rows stop here so the totals and the footer always fit below them. */
const TABLE_FLOOR = 190;
const ROW_HEIGHT = 30;
/** Padding inside the table and totals cells, on both sides. */
const CELL_INSET = 12;

// One neutral palette, matching the monochrome look of the web apps.
const INK = rgb(0.07, 0.07, 0.08);
const MUTED = rgb(0.42, 0.42, 0.46);
const FAINT = rgb(0.7, 0.7, 0.73);
const LINE = rgb(0.88, 0.88, 0.9);
const PANEL = rgb(0.96, 0.96, 0.97);
const WHITE = rgb(1, 1, 1);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatMoney(amountMinor: number, currency: string): string {
  // Minor units -> major, 2dp -- display-only formatting; every actual
  // computation anywhere else in this codebase still stays on integer
  // minor units (§19's own "no floating-point money" rule is about
  // arithmetic, not string rendering).
  return `${currency} ${(amountMinor / 100).toFixed(2)}`;
}

function formatDate(date: Date): string {
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** The standard PDF fonts only encode Latin-1-ish text, and pdf-lib throws on
 * anything else (a guest's name or file name in Urdu, say). Such characters
 * become `?` so an invoice is always produced. */
function printable(font: PDFFont, text: string): string {
  const supported = new Set(font.getCharacterSet());
  return Array.from(text, (ch) => (supported.has(ch.codePointAt(0)!) ? ch : "?")).join("");
}

function fitText(font: PDFFont, text: string, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) {
    return text;
  }
  let cut = text;
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}...`, size) > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut}...`;
}

/** Draws a QR code as vector squares (runs of dark modules merged into one
 * rectangle per row), on a white quiet zone, so it stays sharp at any zoom
 * and scans reliably from a screen or a printout. */
function drawQr(page: PDFPage, text: string, x: number, y: number, size: number): void {
  const { size: count, data } = createQr(text, { errorCorrectionLevel: "M" }).modules;
  const quiet = 2;
  const cell = size / (count + quiet * 2);
  page.drawRectangle({ x, y, width: size, height: size, color: WHITE });
  for (let row = 0; row < count; row++) {
    let col = 0;
    while (col < count) {
      if (!data[row * count + col]) {
        col++;
        continue;
      }
      const start = col;
      while (col < count && data[row * count + col]) {
        col++;
      }
      page.drawRectangle({
        x: x + (start + quiet) * cell,
        // A hair taller than one cell so adjacent rows overlap: viewers
        // anti-alias the edge of each rectangle, which otherwise shows as
        // thin white seams across the code.
        y: y + size - (row + quiet + 1) * cell - 0.2,
        width: (col - start) * cell,
        height: cell + 0.4,
        color: INK,
      });
    }
  }
}

/** §36/17.7: renders a real PDF invoice/receipt from an order's own
 * stored pricing snapshot -- pdf-lib (already a dependency of
 * services/worker, for document inspection) is a general-purpose PDF library,
 * so this reuses it rather than adding a PDF-generation dependency. Pure
 * rendering -- every value is already resolved by the caller
 * (InvoicesService), no I/O here.
 *
 * The QR code encodes the order number: shop staff scan it at the counter to
 * pull up the order, and it is the handle a later status-tracking page can
 * key on. */
export async function buildInvoicePdf(data: InvoiceData): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`Invoice ${data.publicOrderNumber}`);
  pdfDoc.setProducer("Print Automated");
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const shopName = printable(bold, data.shopName);
  const customerName = printable(font, data.customerName);
  const documentName = printable(font, data.documentFilename);
  const orderNumber = printable(bold, data.publicOrderNumber);
  const { quote } = data;

  const textRight = (
    page: PDFPage,
    text: string,
    y: number,
    size: number,
    face: PDFFont,
    color = INK,
    inset = 0,
  ): void => {
    page.drawText(text, {
      x: RIGHT - inset - face.widthOfTextAtSize(text, size),
      y,
      size,
      font: face,
      color,
    });
  };

  const drawFooter = (page: PDFPage): void => {
    page.drawLine({
      start: { x: MARGIN, y: FOOTER_Y + 16 },
      end: { x: RIGHT, y: FOOTER_Y + 16 },
      thickness: 0.75,
      color: LINE,
    });
    page.drawText(fitText(font, `Thank you for printing with ${shopName}.`, 9, 330), {
      x: MARGIN,
      y: FOOTER_Y,
      size: 9,
      font,
      color: MUTED,
    });
    textRight(page, "Generated by Print Automated", FOOTER_Y, 9, font, MUTED);
  };

  // ---- Page 1: header band -------------------------------------------------
  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  page.drawRectangle({
    x: 0,
    y: PAGE_HEIGHT - HEADER_HEIGHT,
    width: PAGE_WIDTH,
    height: HEADER_HEIGHT,
    color: INK,
  });
  page.drawText("PRINT AUTOMATED", {
    x: MARGIN,
    y: PAGE_HEIGHT - 46,
    size: 9,
    font: bold,
    color: FAINT,
  });
  page.drawText("Invoice", {
    x: MARGIN,
    y: PAGE_HEIGHT - 92,
    size: 34,
    font: bold,
    color: WHITE,
  });
  textRight(page, fitText(bold, shopName, 13, 280), PAGE_HEIGHT - 64, 13, bold, WHITE);
  textRight(page, formatDate(data.createdAt), PAGE_HEIGHT - 84, 10, font, FAINT);

  // ---- Order details (left) and QR card (right) ----------------------------
  const detailsTop = PAGE_HEIGHT - HEADER_HEIGHT - 44;
  const detailsWidth = RIGHT - MARGIN - 170;

  const field = (label: string, value: string, y: number, valueFace = font, size = 11): void => {
    page.drawText(label, { x: MARGIN, y, size: 8, font: bold, color: MUTED });
    page.drawText(fitText(valueFace, value, size, detailsWidth), {
      x: MARGIN,
      y: y - 17,
      size,
      font: valueFace,
      color: INK,
    });
  };
  field("ORDER NUMBER", orderNumber, detailsTop, bold, 17);
  field("CUSTOMER", customerName, detailsTop - 56);
  field("DOCUMENT", documentName, detailsTop - 106);
  field("SHOP", shopName, detailsTop - 156);

  const cardWidth = 150;
  const cardHeight = 192;
  const cardX = RIGHT - cardWidth;
  const cardY = detailsTop - cardHeight + 14;
  page.drawRectangle({
    x: cardX,
    y: cardY,
    width: cardWidth,
    height: cardHeight,
    color: PANEL,
    borderColor: LINE,
    borderWidth: 0.75,
  });
  const qrSize = 122;
  drawQr(
    page,
    data.publicOrderNumber,
    cardX + (cardWidth - qrSize) / 2,
    cardY + cardHeight - qrSize - 14,
    qrSize,
  );
  const caption = ["Scan at the counter to", "look up this order"];
  caption.forEach((text, i) => {
    page.drawText(text, {
      x: cardX + (cardWidth - font.widthOfTextAtSize(text, 8)) / 2,
      y: cardY + 28 - i * 11,
      size: 8,
      font,
      color: MUTED,
    });
  });

  // ---- Line items ----------------------------------------------------------
  let y = cardY - 36;
  const drawTableHead = (): void => {
    page.drawRectangle({ x: MARGIN, y: y - 8, width: RIGHT - MARGIN, height: 26, color: PANEL });
    page.drawText("DESCRIPTION", { x: MARGIN + 12, y, size: 8, font: bold, color: MUTED });
    textRight(page, "AMOUNT", y, 8, bold, MUTED, CELL_INSET);
    y -= 34;
  };
  drawTableHead();

  for (const item of quote.lineItems) {
    if (y < TABLE_FLOOR) {
      drawFooter(page);
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN - 20;
      drawTableHead();
    }
    page.drawText(fitText(font, printable(font, item.label), 11, RIGHT - MARGIN - 150), {
      x: MARGIN + 12,
      y,
      size: 11,
      font,
      color: INK,
    });
    textRight(page, formatMoney(item.amountMinor, quote.currency), y, 11, font, INK, CELL_INSET);
    page.drawLine({
      start: { x: MARGIN, y: y - 11 },
      end: { x: RIGHT, y: y - 11 },
      thickness: 0.5,
      color: LINE,
    });
    y -= ROW_HEIGHT;
  }

  // ---- Totals --------------------------------------------------------------
  const rows: Array<[string, number]> = [["Subtotal", quote.subtotalMinor]];
  if (quote.taxMinor > 0) {
    rows.push(["Tax", quote.taxMinor]);
  }
  rows.push(["Platform fee", quote.platformFeeMinor]);

  y -= 6;
  if (y < FOOTER_Y + 16 + rows.length * 22 + 60) {
    drawFooter(page);
    page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN - 20;
  }
  const totalsX = RIGHT - 230;
  for (const [label, amount] of rows) {
    page.drawText(label, { x: totalsX + 12, y, size: 11, font, color: MUTED });
    textRight(page, formatMoney(amount, quote.currency), y, 11, font, INK, CELL_INSET);
    y -= 22;
  }
  const barTop = y + 8;
  page.drawRectangle({ x: totalsX, y: barTop - 44, width: 230, height: 44, color: INK });
  page.drawText("TOTAL", { x: totalsX + 12, y: barTop - 25, size: 9, font: bold, color: FAINT });
  textRight(
    page,
    formatMoney(quote.totalMinor, quote.currency),
    barTop - 28,
    17,
    bold,
    WHITE,
    CELL_INSET,
  );

  drawFooter(page);

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}
