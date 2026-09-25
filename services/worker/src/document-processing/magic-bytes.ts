const PDF_MAGIC_BYTES = Buffer.from("%PDF-", "ascii");
const JPEG_MAGIC_BYTES = Buffer.from([0xff, 0xd8, 0xff]);
const ZIP_MAGIC_BYTES = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const PNG_MAGIC_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** "docx" means "a zip local-file header": only a CANDIDATE. inspectDocx()
 * decides whether it is really a Word document. */
export type DocumentKind = "pdf" | "jpeg" | "png" | "docx";

function startsWith(buffer: Buffer, prefix: Buffer): boolean {
  return buffer.subarray(0, prefix.length).equals(prefix);
}

/** §86: "extension and MIME alone are not trusted." A file's declared
 * mimeType (checked client-side by 2.5's Zod schema) says nothing about
 * its actual bytes -- this is the real check, against what the client
 * actually uploaded. */
export function hasValidPdfMagicBytes(buffer: Buffer): boolean {
  return startsWith(buffer, PDF_MAGIC_BYTES);
}

/** 21.9 (PRD 8): classifies the upload from its real leading bytes only.
 * JPEG is FF D8 FF; PNG is the full 8-byte signature (so a CRLF-mangled
 * or truncated header does not pass). Returns null for anything else,
 * which the pipeline rejects as INVALID_FILE_TYPE. */
export function detectDocumentKind(buffer: Buffer): DocumentKind | null {
  if (startsWith(buffer, PDF_MAGIC_BYTES)) return "pdf";
  if (startsWith(buffer, JPEG_MAGIC_BYTES)) return "jpeg";
  if (startsWith(buffer, PNG_MAGIC_BYTES)) return "png";
  if (startsWith(buffer, ZIP_MAGIC_BYTES)) return "docx";
  return null;
}
