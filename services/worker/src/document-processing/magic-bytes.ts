const PDF_MAGIC_BYTES = Buffer.from("%PDF-", "ascii");

/** §86: "extension and MIME alone are not trusted." A file's declared
 * mimeType (checked client-side by 2.5's Zod schema) says nothing about
 * its actual bytes -- this is the real check, against what the client
 * actually uploaded. */
export function hasValidPdfMagicBytes(buffer: Buffer): boolean {
  return buffer.subarray(0, PDF_MAGIC_BYTES.length).equals(PDF_MAGIC_BYTES);
}
