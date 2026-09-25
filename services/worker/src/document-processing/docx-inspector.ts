import { inflateRawSync } from "node:zlib";
import { DocumentRejectedError } from "./document-rejected.error.js";
import { RejectionReason } from "./rejection-reason.js";
import { localName } from "./strict-xml.js";
import { guardXml, scanRelationshipsPart, scanWordPart } from "./docx-external-content.js";

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
  /** word/*.xml parts (document body, headers, footers...) are scanned as they inflate. */
  maxWordPartBytes: 30 * 1024 * 1024,
} as const;

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

const WORD_MAIN_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";

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
  // 21.13: no duplicate names (a second "word/document.xml" could show the
  // gate one part and LibreOffice another), local headers must agree with
  // the central directory, and no two entries may share bytes.
  const seen = new Set<string>();
  for (const name of names) {
    const key = name.toLowerCase();
    if (seen.has(key)) reject(RejectionReason.CORRUPT_FILE);
    seen.add(key);
  }
  validateLocalHeaders(buffer, entries);
  const declaredTotal = entries.reduce((sum, entry) => sum + entry.uncompressedSize, 0);
  if (declaredTotal > DOCX_LIMITS.maxTotalUncompressedBytes) {
    reject(RejectionReason.ARCHIVE_TOO_LARGE);
  }
  if (!names.includes("[Content_Types].xml")) {
    reject(RejectionReason.INVALID_FILE_TYPE);
  }

  // Inflate everything once, against a shared budget, keeping only the
  // content-types part; .rels and word/ parts are scanned as they inflate.
  let budget = DOCX_LIMITS.maxTotalUncompressedBytes;
  let contentTypesBytes: Buffer | null = null;
  let rootRelsBytes: Buffer | null = null;
  for (const entry of entries) {
    const data = inflateEntry(buffer, entry, budget);
    budget -= data.length;
    if (
      data.length >= DOCX_LIMITS.ratioCheckMinBytes &&
      data.length / Math.max(entry.compressedSize, 1) > DOCX_LIMITS.maxCompressionRatio
    ) {
      reject(RejectionReason.ARCHIVE_TOO_LARGE);
    }
    const lower = entry.name.toLowerCase();
    if (entry.name === "[Content_Types].xml") {
      if (data.length > DOCX_LIMITS.maxXmlPartBytes) reject(RejectionReason.ARCHIVE_TOO_LARGE);
      contentTypesBytes = data;
    } else if (lower.endsWith(".rels")) {
      if (data.length > DOCX_LIMITS.maxXmlPartBytes) reject(RejectionReason.ARCHIVE_TOO_LARGE);
      scanRelationshipsPart(data);
      if (lower === "_rels/.rels") rootRelsBytes = data;
    } else if (lower.startsWith("word/") && lower.endsWith(".xml")) {
      if (data.length > DOCX_LIMITS.maxWordPartBytes) reject(RejectionReason.ARCHIVE_TOO_LARGE);
      scanWordPart(data);
    }
  }

  if (!contentTypesBytes || !rootRelsBytes) reject(RejectionReason.INVALID_FILE_TYPE);

  const { defaults, overrides } = parseContentTypes(contentTypesBytes);
  const declaredTypes = [...defaults.values(), ...overrides.values()];
  if (declaredTypes.some((type) => /macroEnabled|vbaProject/i.test(type))) {
    reject(RejectionReason.MACRO_ENABLED_DOCUMENT);
  }

  // The main part is whatever the package's officeDocument relationship
  // names, and it must be a plain Word document under word/ (so the scanned
  // parts are the ones LibreOffice will read). xlsx, pptx and templates fail here.
  const mainPart = resolveMainPart(rootRelsBytes);
  const mainKey = mainPart.toLowerCase();
  if (!mainKey.startsWith("word/") || !seen.has(mainKey)) {
    reject(RejectionReason.INVALID_FILE_TYPE);
  }
  const extension = mainKey.slice(mainKey.lastIndexOf(".") + 1);
  const mainType = overrides.get(`/${mainKey}`) ?? defaults.get(extension);
  if (mainType !== WORD_MAIN_CONTENT_TYPE) {
    reject(RejectionReason.INVALID_FILE_TYPE);
  }
}

/** Parsed (strict XML) content types: Default by extension, Override by part. */
function parseContentTypes(bytes: Buffer): {
  defaults: Map<string, string>;
  overrides: Map<string, string>;
} {
  const defaults = new Map<string, string>();
  const overrides = new Map<string, string>();
  guardXml(bytes, {
    onOpen(qname, attrs) {
      const name = localName(qname).toLowerCase();
      if (name !== "default" && name !== "override") return;
      let key = "";
      let type = "";
      for (const [attributeName, value] of attrs) {
        const attribute = localName(attributeName).toLowerCase();
        if (attribute === "extension" || attribute === "partname") key = value.toLowerCase();
        if (attribute === "contenttype") type = value;
      }
      if (name === "default") defaults.set(key, type);
      else overrides.set(key, type);
    },
  });
  return { defaults, overrides };
}

/** Target of the package's officeDocument relationship, as a part name
 * without a leading slash. Missing, duplicated or external -> not a DOCX. */
function resolveMainPart(rootRels: Buffer): string {
  const targets: string[] = [];
  guardXml(rootRels, {
    onOpen(qname, attrs) {
      if (localName(qname).toLowerCase() !== "relationship") return;
      let type = "";
      let target = "";
      let mode = "";
      for (const [attributeName, value] of attrs) {
        const attribute = localName(attributeName).toLowerCase();
        if (attribute === "type") type = value.toLowerCase();
        if (attribute === "target") target = value;
        if (attribute === "targetmode") mode = value.toLowerCase();
      }
      if (type.endsWith("/officedocument")) {
        if (mode === "external") reject(RejectionReason.EXTERNAL_CONTENT);
        targets.push(target);
      }
    },
  });
  if (targets.length !== 1) reject(RejectionReason.INVALID_FILE_TYPE);
  return targets[0]!.replace(/^\/+/, "");
}

/** Local file headers must match the central directory (name, and sizes
 * unless a data descriptor is used), and stored data ranges must not overlap. */
function validateLocalHeaders(buffer: Buffer, entries: ZipEntry[]): void {
  const ranges: Array<[number, number]> = [];
  for (const entry of entries) {
    const header = entry.localOffset;
    if (header + 30 > buffer.length || buffer.readUInt32LE(header) !== LOCAL_SIGNATURE) {
      reject(RejectionReason.CORRUPT_FILE);
    }
    const nameLength = buffer.readUInt16LE(header + 26);
    const extraLength = buffer.readUInt16LE(header + 28);
    const localName = buffer.toString("utf8", header + 30, header + 30 + nameLength);
    if (localName !== entry.name) reject(RejectionReason.CORRUPT_FILE);
    if ((buffer.readUInt16LE(header + 6) & 8) === 0) {
      if (
        buffer.readUInt32LE(header + 18) !== entry.compressedSize ||
        buffer.readUInt32LE(header + 22) !== entry.uncompressedSize
      ) {
        reject(RejectionReason.CORRUPT_FILE);
      }
    }
    const end = header + 30 + nameLength + extraLength + entry.compressedSize;
    if (end > buffer.length) reject(RejectionReason.CORRUPT_FILE);
    ranges.push([header, end]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < ranges.length; i += 1) {
    if (ranges[i]![0] < ranges[i - 1]![1]) reject(RejectionReason.CORRUPT_FILE);
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
