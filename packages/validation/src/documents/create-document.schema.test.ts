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

  it("rejects any mimeType other than application/pdf (§14 MVP: PDF only)", () => {
    const result = createDocumentSchema.safeParse({
      filename: "photo.jpg",
      mimeType: "image/jpeg",
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
