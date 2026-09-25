import { detectDocumentKind } from "./magic-bytes.js";

describe("detectDocumentKind (21.9: sniff real bytes, never the client mime)", () => {
  it("detects a PDF", () => {
    expect(detectDocumentKind(Buffer.from("%PDF-1.7\n"))).toBe("pdf");
  });

  it("detects a JPEG by FF D8 FF", () => {
    expect(detectDocumentKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe("jpeg");
  });

  it("detects a PNG by its full 8-byte signature", () => {
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    expect(detectDocumentKind(sig)).toBe("png");
  });

  it("does not detect a PNG from a truncated or altered signature", () => {
    expect(detectDocumentKind(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    // CRLF-mangled signature (a classic text-mode transfer corruption)
    expect(
      detectDocumentKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0a, 0x1a, 0x0a, 0x00])),
    ).toBeNull();
  });

  it("detects a zip local-file header as a DOCX candidate (21.10)", () => {
    expect(detectDocumentKind(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]))).toBe("docx");
    // an empty-archive/spanned marker is not a document
    expect(detectDocumentKind(Buffer.from([0x50, 0x4b, 0x05, 0x06]))).toBeNull();
  });

  it("returns null for an executable, a GIF, an empty buffer and two bytes of JPEG", () => {
    expect(detectDocumentKind(Buffer.from([0x4d, 0x5a, 0x90, 0x00]))).toBeNull();
    expect(detectDocumentKind(Buffer.from("GIF89a"))).toBeNull();
    expect(detectDocumentKind(Buffer.alloc(0))).toBeNull();
    expect(detectDocumentKind(Buffer.from([0xff, 0xd8]))).toBeNull();
  });
});
