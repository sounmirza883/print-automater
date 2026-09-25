import { readFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { ImageToPdfService, MAX_IMAGE_PIXELS } from "./image-to-pdf.service.js";
import { readImageDimensions } from "./image-dimensions.js";
import { DocumentRejectedError } from "./document-rejected.error.js";
import { RejectionReason } from "./rejection-reason.js";

const FIXTURES = path.resolve(__dirname, "../../test/fixtures");
const fixture = (name: string): Buffer => readFileSync(path.join(FIXTURES, name));

/** A syntactically valid PNG whose IHDR declares huge dimensions but whose
 * pixel data is tiny: the decompression-bomb shape. Nothing here is ever
 * decoded by the code under test because the IHDR check must stop it. */
function pngDeclaring(width: number, height: number): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    return Buffer.concat([len, Buffer.from(type, "ascii"), data, Buffer.alloc(4)]);
  };
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.alloc(16))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function rejectionOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DocumentRejectedError) return error.reason;
    throw error;
  }
  throw new Error("expected a DocumentRejectedError");
}

describe("readImageDimensions", () => {
  it("reads PNG and JPEG dimensions without decoding pixels", () => {
    expect(readImageDimensions(fixture("sample.png"), "png")).toMatchObject({
      width: 60,
      height: 40,
    });
    expect(readImageDimensions(fixture("sample.jpg"), "jpeg")).toMatchObject({
      width: 60,
      height: 40,
    });
    expect(readImageDimensions(fixture("sample-cmyk.jpg"), "jpeg")).toMatchObject({
      width: 60,
      height: 40,
    });
  });

  it("returns null for a truncated header", () => {
    expect(readImageDimensions(fixture("sample.png").subarray(0, 20), "png")).toBeNull();
    expect(readImageDimensions(fixture("sample.jpg").subarray(0, 12), "jpeg")).toBeNull();
  });
});

describe("ImageToPdfService", () => {
  const service = new ImageToPdfService();

  it.each(["sample.jpg", "sample-cmyk.jpg", "sample.png", "sample-alpha.png"])(
    "normalises %s into a valid single-page A4 PDF",
    async (name) => {
      const kind = name.endsWith(".png") ? "png" : "jpeg";
      const pdfBytes = await service.convert(fixture(name), kind);

      expect(pdfBytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
      const pdf = await PDFDocument.load(pdfBytes);
      expect(pdf.getPageCount()).toBe(1);
      const { width, height } = pdf.getPage(0).getSize();
      // 60x40 is landscape, so the page is A4 landscape.
      expect(width).toBeCloseTo(841.89, 1);
      expect(height).toBeCloseTo(595.28, 1);
    },
  );

  it("honours EXIF orientation 6: a 60x40 stored photo displays portrait", async () => {
    const pdfBytes = await service.convert(fixture("sample-orient6.jpg"), "jpeg");
    const pdf = await PDFDocument.load(pdfBytes);
    const { width, height } = pdf.getPage(0).getSize();
    expect(width).toBeCloseTo(595.28, 1);
    expect(height).toBeCloseTo(841.89, 1);
  });

  it("rejects a PNG declaring more than the pixel cap before decoding it", async () => {
    const bomb = pngDeclaring(40_000, 40_000); // 1.6 gigapixels, ~100 bytes of data
    expect(40_000 * 40_000).toBeGreaterThan(MAX_IMAGE_PIXELS);
    expect(await rejectionOf(service.convert(bomb, "png"))).toBe(
      RejectionReason.IMAGE_DIMENSIONS_EXCEEDED,
    );
  });

  it("rejects an absurdly long, thin image even when under the pixel cap", async () => {
    const strip = pngDeclaring(100_000, 10);
    expect(await rejectionOf(service.convert(strip, "png"))).toBe(
      RejectionReason.IMAGE_DIMENSIONS_EXCEEDED,
    );
  });

  it("rejects zero-dimension images as corrupt", async () => {
    expect(await rejectionOf(service.convert(pngDeclaring(0, 10), "png"))).toBe(
      RejectionReason.CORRUPT_FILE,
    );
  });

  it("rejects a truncated JPEG and a JPEG-magic-only file as corrupt, not a crash", async () => {
    const truncated = fixture("sample.jpg").subarray(0, 40);
    expect(await rejectionOf(service.convert(truncated, "jpeg"))).toBe(
      RejectionReason.CORRUPT_FILE,
    );
    const fake = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    expect(await rejectionOf(service.convert(fake, "jpeg"))).toBe(RejectionReason.CORRUPT_FILE);
  });

  it("rejects a PNG with a valid header and garbage pixel data as corrupt", async () => {
    const png = fixture("sample.png");
    const broken = Buffer.concat([png.subarray(0, 40), Buffer.alloc(30, 0xab)]);
    expect(await rejectionOf(service.convert(broken, "png"))).toBe(RejectionReason.CORRUPT_FILE);
  });
});
