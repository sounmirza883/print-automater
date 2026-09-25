import { readFileSync } from "node:fs";
import path from "node:path";
import zlib, { deflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { expectedRawSize, sanitizePng } from "./png-sanitizer.js";
import { ImageToPdfService } from "./image-to-pdf.service.js";
import { DocumentRejectedError } from "./document-rejected.error.js";
import { RejectionReason } from "./rejection-reason.js";
import {
  IEND,
  assemblePng,
  ihdr,
  pngBomb,
  pngChunk,
  validPng,
} from "../../test/helpers/png-builder.js";

const sample = (name: string): Buffer =>
  readFileSync(path.resolve(__dirname, "../../test/fixtures", name));

function reasonOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    if (error instanceof DocumentRejectedError) return error.reason;
    throw error;
  }
}

describe("21.12 expectedRawSize (independent of the decoder)", () => {
  it("non-interlaced: height * (1 + ceil(width * bitsPerPixel / 8))", () => {
    expect(expectedRawSize(1, 1, 8, 6, 0)).toBe(5); // RGBA8
    expect(expectedRawSize(60, 40, 8, 2, 0)).toBe(40 * (1 + 180)); // RGB8
    expect(expectedRawSize(10, 3, 1, 0, 0)).toBe(3 * (1 + 2)); // 1-bit gray, 10 px -> 2 bytes
    expect(expectedRawSize(5, 2, 16, 2, 0)).toBe(2 * (1 + 30)); // RGB16
    expect(expectedRawSize(7, 2, 4, 3, 0)).toBe(2 * (1 + 4)); // 4-bit palette, 7 px -> 4 bytes
  });

  it("Adam7 interlaced: sums the seven reduced images", () => {
    // 2x2 RGB8: passes 1 (1x1), 6 (1x1) and 7 (2x1) are non-empty.
    expect(expectedRawSize(2, 2, 8, 2, 1)).toBe(4 + 4 + 7);
    expect(expectedRawSize(1, 1, 8, 6, 1)).toBe(5);
  });
});

describe("21.12 sanitizePng: bounded, validated, ancillary chunks dropped", () => {
  it("accepts the real fixtures and returns a PNG that still embeds", async () => {
    for (const name of ["sample.png", "sample-alpha.png"]) {
      const clean = sanitizePng(sample(name));
      expect(clean.subarray(1, 4).toString("ascii")).toBe("PNG");
    }
    const pdf = await new ImageToPdfService().convert(sample("sample-alpha.png"), "png");
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
  });

  it("accepts a valid Adam7 interlaced image", () => {
    expect(
      reasonOf(() => sanitizePng(validPng(2, 2, 15, { colorType: 2, interlace: 1 }))),
    ).toBeNull();
  });

  it("a 1x1 IHDR with a highly compressible oversized IDAT is rejected with a bounded inflate", () => {
    const bomb = pngBomb(120 * 1024 * 1024); // ~120 MB of zeros in ~120 KB
    expect(bomb.length).toBeLessThan(400_000);
    const spy = jest.spyOn(zlib, "inflateSync");
    const started = Date.now();
    expect(reasonOf(() => sanitizePng(bomb))).toBe(RejectionReason.IMAGE_DIMENSIONS_EXCEEDED);
    expect(Date.now() - started).toBeLessThan(1500);
    // The output limit handed to zlib is the EXPECTED raw size (5 bytes),
    // never the attacker-controlled amount.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![1]).toMatchObject({ maxOutputLength: 5 });
    spy.mockRestore();
  });

  it("the whole conversion rejects the bomb, terminal not a crash", async () => {
    await expect(
      new ImageToPdfService().convert(pngBomb(64 * 1024 * 1024), "png"),
    ).rejects.toMatchObject({ reason: RejectionReason.IMAGE_DIMENSIONS_EXCEEDED });
  });

  it("one byte more than the expected raw size is a bomb; one byte less is corrupt", () => {
    expect(reasonOf(() => sanitizePng(validPng(1, 1, 6)))).toBe(
      RejectionReason.IMAGE_DIMENSIONS_EXCEEDED,
    );
    expect(reasonOf(() => sanitizePng(validPng(1, 1, 4)))).toBe(RejectionReason.CORRUPT_FILE);
  });

  it("rejects a bad chunk CRC", () => {
    const png = assemblePng(ihdr(1, 1), pngChunk("IDAT", deflateSync(Buffer.alloc(5)), true), IEND);
    expect(reasonOf(() => sanitizePng(png))).toBe(RejectionReason.CORRUPT_FILE);
  });

  it("rejects missing IEND, truncation, a lying chunk length and trailing data structure errors", () => {
    const idat = pngChunk("IDAT", deflateSync(Buffer.alloc(5)));
    expect(reasonOf(() => sanitizePng(assemblePng(ihdr(1, 1), idat)))).toBe(
      RejectionReason.CORRUPT_FILE,
    );
    const good = validPng(1, 1, 5);
    expect(reasonOf(() => sanitizePng(good.subarray(0, good.length - 7)))).toBe(
      RejectionReason.CORRUPT_FILE,
    );
    const lying = Buffer.from(good);
    lying.writeUInt32BE(0x7fffffff, 33); // IDAT length field (after 8 + 25 bytes)
    expect(reasonOf(() => sanitizePng(lying))).toBe(RejectionReason.CORRUPT_FILE);
  });

  it("rejects IHDR problems: not first, duplicated, bad depth/colour combination, bad interlace", () => {
    const idat = pngChunk("IDAT", deflateSync(Buffer.alloc(5)));
    expect(reasonOf(() => sanitizePng(assemblePng(idat, ihdr(1, 1), IEND)))).toBe(
      RejectionReason.CORRUPT_FILE,
    );
    expect(reasonOf(() => sanitizePng(assemblePng(ihdr(1, 1), ihdr(1, 1), idat, IEND)))).toBe(
      RejectionReason.CORRUPT_FILE,
    );
    expect(reasonOf(() => sanitizePng(validPng(1, 1, 5, { bitDepth: 3, colorType: 6 })))).toBe(
      RejectionReason.CORRUPT_FILE,
    );
    expect(reasonOf(() => sanitizePng(validPng(1, 1, 5, { bitDepth: 16, colorType: 3 })))).toBe(
      RejectionReason.CORRUPT_FILE,
    );
    expect(reasonOf(() => sanitizePng(validPng(1, 1, 5, { interlace: 2 })))).toBe(
      RejectionReason.CORRUPT_FILE,
    );
  });

  it("a palette image needs a PLTE chunk", () => {
    expect(reasonOf(() => sanitizePng(validPng(1, 1, 2, { bitDepth: 8, colorType: 3 })))).toBe(
      RejectionReason.CORRUPT_FILE,
    );
    const plte = pngChunk("PLTE", Buffer.from([1, 2, 3]));
    expect(
      reasonOf(() => sanitizePng(validPng(1, 1, 2, { bitDepth: 8, colorType: 3 }, [plte]))),
    ).toBeNull();
  });

  it("rejects an expected raw size beyond the memory cap even when the pixel cap allows it", () => {
    // 6000 x 6000 = 36 MP (under the 40 MP cap) at RGBA 16-bit = ~288 MB raw.
    const huge = assemblePng(
      ihdr(6000, 6000, { bitDepth: 16, colorType: 6 }),
      pngChunk("IDAT", deflateSync(Buffer.alloc(16))),
      IEND,
    );
    expect(reasonOf(() => sanitizePng(huge))).toBe(RejectionReason.IMAGE_DIMENSIONS_EXCEEDED);
  });

  it("drops ancillary chunks (zTXt/iCCP/acTL/fdAT) so the decoder never sees them", () => {
    const evil = [
      pngChunk("zTXt", Buffer.concat([Buffer.from("k\0\0"), deflateSync(Buffer.alloc(1_000_000))])),
      pngChunk("iCCP", Buffer.from("p\0\0garbage")),
      pngChunk("acTL", Buffer.alloc(8)),
      pngChunk("fdAT", Buffer.alloc(20)),
    ];
    const clean = sanitizePng(validPng(1, 1, 5, {}, evil));
    for (const type of ["zTXt", "iCCP", "acTL", "fdAT"]) {
      expect(clean.includes(Buffer.from(type, "ascii"))).toBe(false);
    }
    expect(clean.includes(Buffer.from("IDAT", "ascii"))).toBe(true);
  });

  it("keeps tRNS transparency and multiple IDAT chunks", () => {
    const raw = deflateSync(Buffer.alloc(2));
    const png = assemblePng(
      ihdr(1, 1, { colorType: 3 }),
      pngChunk("PLTE", Buffer.from([1, 2, 3])),
      pngChunk("tRNS", Buffer.from([128])),
      pngChunk("IDAT", raw.subarray(0, 3)),
      pngChunk("IDAT", raw.subarray(3)),
      IEND,
    );
    const clean = sanitizePng(png);
    expect(clean.includes(Buffer.from("tRNS", "ascii"))).toBe(true);
  });
});
