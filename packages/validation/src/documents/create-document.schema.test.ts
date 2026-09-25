import { createDocumentSchema } from "./create-document.schema.js";

describe("createDocumentSchema", () => {
  it("accepts a valid document declaration", () => {
    const result = createDocumentSchema.safeParse({
      filename: "assignment.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
    });
    expect(result.success).toBe(true);
  });

  it.each([
    "image/jpeg",
    "image/png",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ])("accepts %s (PRD 8: JPG/PNG upload 21.9, DOCX 21.10)", (mimeType) => {
    const result = createDocumentSchema.safeParse({
      filename: "photo",
      mimeType,
      sizeBytes: 1024,
    });
    expect(result.success).toBe(true);
  });

  it.each([
    "image/gif",
    "image/webp",
    "text/plain",
    "application/zip",
    "application/msword",
    "application/vnd.ms-word.document.macroEnabled.12",
    "application/x-msdownload",
  ])("rejects unsupported mimeType %s", (mimeType) => {
    const result = createDocumentSchema.safeParse({
      filename: "file.bin",
      mimeType,
      sizeBytes: 1024,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a declared size over 25MB", () => {
    const result = createDocumentSchema.safeParse({
      filename: "huge.pdf",
      mimeType: "application/pdf",
      sizeBytes: 26 * 1024 * 1024,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty filename", () => {
    const result = createDocumentSchema.safeParse({
      filename: "",
      mimeType: "application/pdf",
      sizeBytes: 1024,
    });
    expect(result.success).toBe(false);
  });
});
