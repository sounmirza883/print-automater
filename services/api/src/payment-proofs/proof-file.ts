import { PAYMENT_PROOF_MAX_BYTES } from "@print-automated/validation";

export type ProofContentType = "image/jpeg" | "image/png" | "application/pdf";

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

function startsWith(bytes: Buffer, magic: number[]): boolean {
  return bytes.length >= magic.length && magic.every((value, index) => bytes[index] === value);
}

const MAGIC: Record<ProofContentType, number[]> = {
  "image/jpeg": JPEG,
  "image/png": PNG,
  "application/pdf": PDF,
};

export type DecodedProofFile =
  { ok: true; bytes: Buffer } | { ok: false; reason: "EMPTY" | "TOO_LARGE" | "TYPE_MISMATCH" };

/** Decodes the client's base64 and checks the REAL bytes against the declared type:
 * the declared content-type is only trusted once the file's own magic bytes agree. */
export function decodeProofFile(
  fileBase64: string,
  declaredType: ProofContentType,
): DecodedProofFile {
  const bytes = Buffer.from(fileBase64, "base64");
  if (bytes.length === 0) {
    return { ok: false, reason: "EMPTY" };
  }
  if (bytes.length > PAYMENT_PROOF_MAX_BYTES) {
    return { ok: false, reason: "TOO_LARGE" };
  }
  if (!startsWith(bytes, MAGIC[declaredType])) {
    return { ok: false, reason: "TYPE_MISMATCH" };
  }
  return { ok: true, bytes };
}
