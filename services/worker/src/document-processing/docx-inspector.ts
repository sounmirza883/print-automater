import { inflateRawSync } from "node:zlib";
import { DocumentRejectedError } from "./document-rejected.error.js";
import { RejectionReason } from "./rejection-reason.js";

/** 21.10 zip-bomb / structure limits. Every cap is enforced on MEASURED
 * inflation, not on the sizes the archive declares about itself (a
 * hostile zip can lie in its headers), and the declared sizes are also
 * checked first so an honest bomb is refused without inflating anything.
 * 100 MB of expanded content is far beyond any printable Word file that
 * fits the 25 MB upload cap; the 100:1 ratio applies to entries of 1 MB
 * or more (small XML parts legitimately compress 20:1). */
export const DOCX_LIMITS = {
  maxEntries: 2000,
  maxTotalUncompressedBytes: 100 * 1024 * 1024,
  maxCompressionRatio: 100,
  ratioCheckMinBytes: 1024 * 1024,
  maxXmlPartBytes: 1024 * 1024,
} as const;

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

const WORD_MAIN_CONTENT_TYPE = "wordprocessingml.document.main+xml";

/** External relationship targets LibreOffice would follow (fetch or load).
 * Plain hyperlinks are just text and stay allowed. Refusing the rest is
 * the deterministic half of "no network": a DOCX cannot make the
 * converter reach out (SSRF, NTLM leak, tracking pixel). */
const FETCHED_RELATIONSHIP_TYPES = [
  "/attachedTemplate",
  "/oleObject",
  "/image",
  "/subDocument",
  "/frame",
  "/externalLink",
  "/externalLinkPath",
];

interface ZipEntry {
  name: string;
  flags: number;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

function reject(reason: (typeof RejectionReason)[keyof typeof RejectionReason]): never {
  throw new DocumentRejectedError(reason);
}

/** Structural gate for an uploaded .docx, run BEFORE LibreOffice sees the
 * bytes. Throws a DocumentRejectedError with a specific reason, returns
 * nothing on success. Dependency-free (own zip central-directory
 * reader) and never extracts to disk. */
export function inspectDocx(buffer: Buffer): void {
  const entries = readCentralDirectory(buffer);

  const names = entries.map((entry) => entry.name);
  if (names.some((name) => /(^|\/)vbaProject\.bin$/i.test(name))) {
    reject(RejectionReason.MACRO_ENABLED_DOCUMENT);
  }
  if (entries.some((entry) => (entry.flags & 1) !== 0)) {
    reject(RejectionReason.PASSWORD_PROTECTED);
  }
  const declaredTotal = entries.reduce((sum, entry) => sum + entry.uncompressedSize, 0);
  if (declaredTotal > DOCX_LIMITS.maxTotalUncompressedBytes) {
    reject(RejectionReason.ARCHIVE_TOO_LARGE);
  }
  if (!names.includes("[Content_Types].xml")) {
    reject(RejectionReason.INVALID_FILE_TYPE);
  }

  // Inflate everything once, against a shared budget, keeping only the
  // small XML parts the checks below need.
  let budget = DOCX_LIMITS.maxTotalUncompressedBytes;
  let contentTypes = "";
  const relationshipParts: string[] = [];
  for (const entry of entries) {
    const data = inflateEntry(buffer, entry, budget);
    budget -= data.length;
    if (
      data.length >= DOCX_LIMITS.ratioCheckMinBytes &&
      data.length / Math.max(entry.compressedSize, 1) > DOCX_LIMITS.maxCompressionRatio
    ) {
      reject(RejectionReason.ARCHIVE_TOO_LARGE);
    }
    const keep = entry.name === "[Content_Types].xml" || entry.name.endsWith(".rels");
    if (keep) {
      if (data.length > DOCX_LIMITS.maxXmlPartBytes) reject(RejectionReason.ARCHIVE_TOO_LARGE);
      const text = data.toString("utf8");
      if (entry.name === "[Content_Types].xml") contentTypes = text;
      else relationshipParts.push(text);
    }
  }

  if (/macroEnabled|vbaProject/i.test(contentTypes)) {
    reject(RejectionReason.MACRO_ENABLED_DOCUMENT);
  }
  // xlsx (xl/), pptx (ppt/), templates and anything else that is not a
  // plain wordprocessing document.
  if (
    !names.some((name) => name.startsWith("word/")) ||
    !contentTypes.includes(WORD_MAIN_CONTENT_TYPE)
  ) {
    reject(RejectionReason.INVALID_FILE_TYPE);
  }

  for (const part of relationshipParts) {
    for (const tag of part.match(/<Relationship\b[^>]*>/g) ?? []) {
      const attributes = new Map<string, string>();
      for (const match of tag.matchAll(/([\w:]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
        attributes.set(match[1]!.toLowerCase(), match[3] ?? match[4] ?? "");
      }
      if (attributes.get("targetmode")?.toLowerCase() !== "external") continue;
      const type = attributes.get("type") ?? "";
      if (FETCHED_RELATIONSHIP_TYPES.some((suffix) => type.endsWith(suffix))) {
        reject(RejectionReason.EXTERNAL_CONTENT);
      }
    }
  }
}

function readCentralDirectory(buffer: Buffer): ZipEntry[] {
  // EOCD is 22 bytes plus an optional comment of at most 65535 bytes.
  const searchFrom = Math.max(0, buffer.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= searchFrom; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) reject(RejectionReason.CORRUPT_FILE);

  const count = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  // Zip64 markers: a Word document never needs them at the 25 MB cap.
  if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    reject(RejectionReason.ARCHIVE_TOO_LARGE);
  }
  if (count > DOCX_LIMITS.maxEntries) reject(RejectionReason.ARCHIVE_TOO_LARGE);
  if (count === 0 || centralOffset + centralSize > buffer.length) {
    reject(RejectionReason.CORRUPT_FILE);
  }

  const entries: ZipEntry[] = [];
  let offset = centralOffset;
  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      reject(RejectionReason.CORRUPT_FILE);
    }
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    if (offset + 46 + nameLength > buffer.length) reject(RejectionReason.CORRUPT_FILE);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    if (isUnsafeEntryName(name)) reject(RejectionReason.CORRUPT_FILE);
    entries.push({
      name,
      flags: buffer.readUInt16LE(offset + 8),
      method: buffer.readUInt16LE(offset + 10),
      compressedSize: buffer.readUInt32LE(offset + 20),
      uncompressedSize: buffer.readUInt32LE(offset + 24),
      localOffset: buffer.readUInt32LE(offset + 42),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function isUnsafeEntryName(name: string): boolean {
  return (
    name.startsWith("/") ||
    name.startsWith("\\") ||
    /^[a-zA-Z]:/.test(name) ||
    name.includes("\0") ||
    name.split(/[/\\]/).includes("..")
  );
}

function inflateEntry(buffer: Buffer, entry: ZipEntry, budget: number): Buffer {
  const header = entry.localOffset;
  if (header + 30 > buffer.length || buffer.readUInt32LE(header) !== LOCAL_SIGNATURE) {
    reject(RejectionReason.CORRUPT_FILE);
  }
  const start = header + 30 + buffer.readUInt16LE(header + 26) + buffer.readUInt16LE(header + 28);
  const end = start + entry.compressedSize;
  if (end > buffer.length) reject(RejectionReason.CORRUPT_FILE);
  const body = buffer.subarray(start, end);

  if (entry.method === 0) {
    if (body.length > budget) reject(RejectionReason.ARCHIVE_TOO_LARGE);
    return body;
  }
  if (entry.method !== 8) reject(RejectionReason.CORRUPT_FILE);
  if (budget < 1) reject(RejectionReason.ARCHIVE_TOO_LARGE);
  try {
    return inflateRawSync(body, { maxOutputLength: budget });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ERR_BUFFER_TOO_LARGE") reject(RejectionReason.ARCHIVE_TOO_LARGE);
    return reject(RejectionReason.CORRUPT_FILE);
  }
}
