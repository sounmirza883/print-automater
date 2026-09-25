import { deflateSync } from "node:zlib";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function pngChunk(type: string, data: Buffer, corruptCrc = false): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBytes = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE((crc32(Buffer.concat([typeBytes, data])) ^ (corruptCrc ? 1 : 0)) >>> 0, 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

export function ihdr(
  width: number,
  height: number,
  opts: { bitDepth?: number; colorType?: number; interlace?: number } = {},
): Buffer {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = opts.bitDepth ?? 8;
  data[9] = opts.colorType ?? 6;
  data[12] = opts.interlace ?? 0;
  return pngChunk("IHDR", data);
}

/** Assembles a PNG from ready-made chunks (already length+type+crc framed). */
export function assemblePng(...chunks: Buffer[]): Buffer {
  return Buffer.concat([PNG_SIGNATURE, ...chunks]);
}

export const IEND = pngChunk("IEND", Buffer.alloc(0));

/** A 1x1 RGBA PNG whose single IDAT inflates to `rawBytes` bytes of zeros
 * instead of the 5 bytes a 1x1 RGBA image needs: a decompression bomb the
 * IHDR-only check cannot see. `rawBytes` of zeros deflate ~1000:1. */
export function pngBomb(rawBytes: number): Buffer {
  return assemblePng(ihdr(1, 1), pngChunk("IDAT", deflateSync(Buffer.alloc(rawBytes))), IEND);
}

/** A valid PNG with exactly-sized (all zero) pixel data. */
export function validPng(
  width: number,
  height: number,
  rawSize: number,
  opts: { bitDepth?: number; colorType?: number; interlace?: number } = {},
  extraChunks: Buffer[] = [],
): Buffer {
  return assemblePng(
    ihdr(width, height, opts),
    ...extraChunks,
    pngChunk("IDAT", deflateSync(Buffer.alloc(rawSize))),
    IEND,
  );
}
