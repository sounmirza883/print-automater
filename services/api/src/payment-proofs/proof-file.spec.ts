import { decodeProofFile } from "./proof-file.js";

const b64 = (bytes: number[]) => Buffer.from(bytes).toString("base64");
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00];
const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0, 0x00];
const PDF_HEAD = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31];

describe("decodeProofFile", () => {
  it("accepts a file whose magic bytes match its declared type", () => {
    expect(decodeProofFile(b64(PNG_HEAD), "image/png").ok).toBe(true);
    expect(decodeProofFile(b64(JPEG_HEAD), "image/jpeg").ok).toBe(true);
    expect(decodeProofFile(b64(PDF_HEAD), "application/pdf").ok).toBe(true);
  });

  it("refuses a file whose bytes do not match the declared type", () => {
    expect(decodeProofFile(b64(PNG_HEAD), "application/pdf")).toEqual({
      ok: false,
      reason: "TYPE_MISMATCH",
    });
    expect(decodeProofFile(b64([0x4d, 0x5a, 0x90, 0x00]), "image/png")).toEqual({
      ok: false,
      reason: "TYPE_MISMATCH",
    });
  });

  it("refuses empty content", () => {
    expect(decodeProofFile("", "image/png")).toEqual({ ok: false, reason: "EMPTY" });
  });

  it("refuses a file over 5 MB", () => {
    const big = Buffer.concat([Buffer.from(PNG_HEAD), Buffer.alloc(5 * 1024 * 1024)]);
    expect(decodeProofFile(big.toString("base64"), "image/png")).toEqual({
      ok: false,
      reason: "TOO_LARGE",
    });
  });
});
