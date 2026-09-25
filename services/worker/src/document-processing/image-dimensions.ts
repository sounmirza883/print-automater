export interface ImageDimensions {
  width: number;
  height: number;
  /** EXIF orientation (1-8) for JPEGs that carry one; 1 otherwise. */
  orientation: number;
}

/** Reads width/height (and JPEG EXIF orientation) straight from the file
 * headers, WITHOUT decoding any pixels. The pipeline calls this before
 * any decoder runs, so a decompression bomb (tiny file, gigapixel
 * declared size) is stopped on the header alone. Returns null when the
 * header is truncated or malformed. */
export function readImageDimensions(buffer: Buffer, kind: "jpeg" | "png"): ImageDimensions | null {
  return kind === "png" ? readPng(buffer) : readJpeg(buffer);
}

function readPng(buffer: Buffer): ImageDimensions | null {
  // signature (8) + IHDR length (4) + "IHDR" (4) + width (4) + height (4)
  if (buffer.length < 24 || buffer.toString("ascii", 12, 16) !== "IHDR") {
    return null;
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), orientation: 1 };
}

function readJpeg(buffer: Buffer): ImageDimensions | null {
  let offset = 2; // past FF D8
  let orientation = 1;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1]!;
    if (marker === 0xff) {
      offset += 1; // fill byte
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2; // standalone markers carry no length
      continue;
    }
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return null;
    const segmentStart = offset + 4;
    if (marker === 0xe1) {
      orientation = readExifOrientation(buffer.subarray(segmentStart, offset + 2 + length));
    }
    const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isSof) {
      if (segmentStart + 5 > buffer.length) return null;
      return {
        height: buffer.readUInt16BE(segmentStart + 1),
        width: buffer.readUInt16BE(segmentStart + 3),
        orientation,
      };
    }
    if (marker === 0xda) return null; // start of scan reached with no SOF
    offset += 2 + length;
  }
  return null;
}

function readExifOrientation(segment: Buffer): number {
  if (segment.length < 14 || segment.toString("ascii", 0, 4) !== "Exif") return 1;
  const tiff = segment.subarray(6);
  const little = tiff.toString("ascii", 0, 2) === "II";
  const u16 = (o: number): number => (little ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = (o: number): number => (little ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  try {
    const ifd = u32(4);
    const entries = u16(ifd);
    for (let i = 0; i < entries; i += 1) {
      const entry = ifd + 2 + i * 12;
      if (u16(entry) === 0x0112) {
        const value = u16(entry + 8);
        return value >= 1 && value <= 8 ? value : 1;
      }
    }
  } catch {
    // truncated EXIF: fall back to "as stored"
  }
  return 1;
}
