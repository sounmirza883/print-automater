import { inflateSync } from "node:zlib";
import { DocumentRejectedError } from "./document-rejected.error.js";
import { RejectionReason } from "./rejection-reason.js";
import { MAX_IMAGE_PIXELS, MAX_IMAGE_SIDE } from "./image-limits.js";

/** 21.12: the IHDR pixel cap says nothing about how much pdf-lib's PNG
 * decoder (UPNG) will inflate from IDAT, so a 1x1 IHDR with a highly
 * compressible multi-hundred-MB IDAT would blow the worker's memory. Before
 * anything decodes the image this walks the chunk structure, validates every
 * CRC, and inflates the IDAT stream with an output limit equal to the raw size
 * the IHDR implies. It then REBUILDS the file from only the critical chunks
 * (IHDR, PLTE, IDAT, IEND) plus tRNS, so no ancillary chunk (zTXt, iCCP,
 * iTXt, APNG acTL/fdAT...) ever reaches the decoder. */

/** Cap on the expected decoded (filtered) size. 40 MP of RGBA8 is 160 MB;
 * 16-bit RGBA at the same pixel count would be 320 MB, which the 1 GB worker
 * cannot afford alongside the decoder's own copies. */
export const MAX_PNG_RAW_BYTES = 200 * 1024 * 1024;

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(...parts: Buffer[]): number {
  let crc = 0xffffffff;
  for (const part of parts) {
    for (const byte of part) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const VALID_DEPTHS: Record<number, number[]> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
};
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

// Adam7: [xStart, yStart, xStep, yStep]
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

/** Size of the inflated IDAT stream (scanlines including the one filter
 * byte each) for the given header fields. */
export function expectedRawSize(
  width: number,
  height: number,
  bitDepth: number,
  colorType: number,
  interlace: number,
): number {
  const bitsPerPixel = CHANNELS[colorType]! * bitDepth;
  const rows = (w: number, h: number): number =>
    w > 0 && h > 0 ? h * (1 + Math.ceil((w * bitsPerPixel) / 8)) : 0;
  if (interlace === 0) return rows(width, height);
  let total = 0;
  for (const [xStart, yStart, xStep, yStep] of ADAM7) {
    total += rows(Math.ceil((width - xStart) / xStep), Math.ceil((height - yStart) / yStep));
  }
  return total;
}

function corrupt(): never {
  throw new DocumentRejectedError(RejectionReason.CORRUPT_FILE);
}
function tooLarge(): never {
  throw new DocumentRejectedError(RejectionReason.IMAGE_DIMENSIONS_EXCEEDED);
}

/** Validates and rebuilds a PNG (see file comment). Throws a
 * DocumentRejectedError for anything malformed or oversized. */
export function sanitizePng(buffer: Buffer): Buffer {
  if (buffer.length < 8 + 25 || !buffer.subarray(0, 8).equals(SIGNATURE)) corrupt();

  let pos = 8;
  let header: Buffer | null = null;
  let palette: Buffer | null = null;
  let transparency: Buffer | null = null;
  const idatChunks: Buffer[] = [];
  const idatData: Buffer[] = [];
  let sawEnd = false;
  let first = true;

  while (pos < buffer.length && !sawEnd) {
    if (pos + 12 > buffer.length) corrupt();
    const length = buffer.readUInt32BE(pos);
    if (length > 0x7fffffff || pos + 12 + length > buffer.length) corrupt();
    const typeBytes = buffer.subarray(pos + 4, pos + 8);
    const type = typeBytes.toString("latin1");
    if (!/^[A-Za-z]{4}$/.test(type)) corrupt();
    const data = buffer.subarray(pos + 8, pos + 8 + length);
    const declaredCrc = buffer.readUInt32BE(pos + 8 + length);
    if (crc32(typeBytes, data) !== declaredCrc) corrupt();
    const whole = buffer.subarray(pos, pos + 12 + length);

    if (first) {
      if (type !== "IHDR" || length !== 13) corrupt();
      header = whole;
      first = false;
    } else {
      switch (type) {
        case "IHDR":
          corrupt();
          break;
        case "PLTE":
          if (length === 0 || length % 3 !== 0 || length > 768 || idatChunks.length > 0) corrupt();
          palette = whole;
          break;
        case "tRNS":
          if (length > 256 || idatChunks.length > 0) corrupt();
          transparency = whole;
          break;
        case "IDAT":
          idatChunks.push(whole);
          idatData.push(data);
          break;
        case "IEND":
          sawEnd = true;
          break;
        default:
          // Ancillary (or unknown) chunk: dropped. An unknown CRITICAL chunk
          // (uppercase first letter) means a file we cannot decode safely.
          if (type[0] === type[0]!.toUpperCase()) corrupt();
      }
    }
    pos += 12 + length;
  }

  if (!header || !sawEnd || idatChunks.length === 0) corrupt();

  const width = header.readUInt32BE(8);
  const height = header.readUInt32BE(12);
  const bitDepth = header[16]!;
  const colorType = header[17]!;
  const compression = header[18]!;
  const filter = header[19]!;
  const interlace = header[20]!;

  if (width < 1 || height < 1) corrupt();
  if (
    !VALID_DEPTHS[colorType]?.includes(bitDepth) ||
    compression !== 0 ||
    filter !== 0 ||
    (interlace !== 0 && interlace !== 1)
  ) {
    corrupt();
  }
  if (colorType === 3 && !palette) corrupt();
  if (width * height > MAX_IMAGE_PIXELS || width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE) {
    tooLarge();
  }

  const expected = expectedRawSize(width, height, bitDepth, colorType, interlace);
  if (expected > MAX_PNG_RAW_BYTES) tooLarge();

  let raw: Buffer;
  try {
    // The limit is the EXPECTED size: a stream that expands further is a bomb.
    raw = inflateSync(Buffer.concat(idatData), { maxOutputLength: expected });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE") tooLarge();
    return corrupt();
  }
  if (raw.length !== expected) corrupt();

  return Buffer.concat([
    SIGNATURE,
    header,
    ...(colorType === 3 && palette ? [palette] : []),
    ...(transparency ? [transparency] : []),
    ...idatChunks,
    Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]), // IEND
  ]);
}
