import { inspectDocx, DOCX_LIMITS } from "./docx-inspector.js";
import { DocumentRejectedError } from "./document-rejected.error.js";
import { RejectionReason } from "./rejection-reason.js";
import { buildDocx, buildZip, WORD_CONTENT_TYPES } from "../../test/helpers/zip-builder.js";

function reasonOf(buffer: Buffer): string | null {
  try {
    inspectDocx(buffer);
    return null;
  } catch (error) {
    if (error instanceof DocumentRejectedError) return error.reason;
    throw error;
  }
}

describe("inspectDocx (21.10: structural gate before LibreOffice ever sees the bytes)", () => {
  it("accepts a well-formed DOCX", () => {
    expect(reasonOf(buildDocx())).toBeNull();
  });

  it("rejects a zip that is not OOXML at all", () => {
    expect(reasonOf(buildZip([{ name: "hello.txt", data: "hi" }]))).toBe(
      RejectionReason.INVALID_FILE_TYPE,
    );
  });

  it("rejects a zip with [Content_Types].xml but no word/ part", () => {
    expect(reasonOf(buildZip([{ name: "[Content_Types].xml", data: WORD_CONTENT_TYPES }]))).toBe(
      RejectionReason.INVALID_FILE_TYPE,
    );
  });

  it("rejects other OOXML types (xlsx, pptx)", () => {
    const xlsx = buildZip([
      { name: "[Content_Types].xml", data: "<Types/>" },
      { name: "xl/workbook.xml", data: "<workbook/>" },
    ]);
    const pptx = buildZip([
      { name: "[Content_Types].xml", data: "<Types/>" },
      { name: "ppt/presentation.xml", data: "<p/>" },
    ]);
    expect(reasonOf(xlsx)).toBe(RejectionReason.INVALID_FILE_TYPE);
    expect(reasonOf(pptx)).toBe(RejectionReason.INVALID_FILE_TYPE);
  });

  it("rejects a word/ part that is not a wordprocessing document (e.g. a template)", () => {
    const dotx = WORD_CONTENT_TYPES.replace(
      "wordprocessingml.document.main+xml",
      "wordprocessingml.template.main+xml",
    );
    expect(reasonOf(buildDocx([], dotx))).toBe(RejectionReason.INVALID_FILE_TYPE);
  });

  it("rejects macro-enabled documents by content type (docm) and by vbaProject.bin", () => {
    const docm = WORD_CONTENT_TYPES.replace(
      "wordprocessingml.document.main+xml",
      "ms-word.document.macroEnabled.main+xml",
    );
    expect(reasonOf(buildDocx([], docm))).toBe(RejectionReason.MACRO_ENABLED_DOCUMENT);
    expect(reasonOf(buildDocx([{ name: "word/vbaProject.bin", data: "x" }]))).toBe(
      RejectionReason.MACRO_ENABLED_DOCUMENT,
    );
  });

  it("rejects a document that links external content LibreOffice would fetch (no network)", () => {
    const rels =
      '<Relationships><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="http://169.254.169.254/x.png" TargetMode="External"/></Relationships>';
    expect(reasonOf(buildDocx([{ name: "word/_rels/document.xml.rels", data: rels }]))).toBe(
      RejectionReason.EXTERNAL_CONTENT,
    );
    const template =
      '<Relationships><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="file:///etc/passwd" TargetMode="External"/></Relationships>';
    expect(reasonOf(buildDocx([{ name: "word/_rels/settings.xml.rels", data: template }]))).toBe(
      RejectionReason.EXTERNAL_CONTENT,
    );
  });

  it("allows plain external hyperlinks (they are text, never fetched)", () => {
    const rels =
      '<Relationships><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/></Relationships>';
    expect(reasonOf(buildDocx([{ name: "word/_rels/document.xml.rels", data: rels }]))).toBeNull();
  });

  it("rejects encrypted zip entries as password protected", () => {
    expect(reasonOf(buildDocx([{ name: "word/secret.xml", data: "x", flags: 1 }]))).toBe(
      RejectionReason.PASSWORD_PROTECTED,
    );
  });

  it("rejects a zip bomb whose headers declare a huge expansion", () => {
    const bomb = buildDocx([
      {
        name: "word/media/big.bin",
        data: Buffer.alloc(1024),
        declaredUncompressedSize: DOCX_LIMITS.maxTotalUncompressedBytes + 1,
      },
    ]);
    expect(reasonOf(bomb)).toBe(RejectionReason.ARCHIVE_TOO_LARGE);
  });

  it("rejects a zip bomb that LIES about its size: real inflation is measured, not trusted", () => {
    const lying = buildDocx([
      {
        name: "word/media/lie.bin",
        data: Buffer.alloc(DOCX_LIMITS.maxTotalUncompressedBytes + 10 * 1024 * 1024),
        declaredUncompressedSize: 10,
      },
    ]);
    expect(reasonOf(lying)).toBe(RejectionReason.ARCHIVE_TOO_LARGE);
  }, 30_000);

  it("rejects an absurd compression ratio even under the total cap", () => {
    const highRatio = buildDocx([
      { name: "word/media/zeros.bin", data: Buffer.alloc(20 * 1024 * 1024) },
    ]);
    expect(reasonOf(highRatio)).toBe(RejectionReason.ARCHIVE_TOO_LARGE);
  });

  it("rejects too many entries", () => {
    const entries = Array.from({ length: DOCX_LIMITS.maxEntries + 1 }, (_, i) => ({
      name: `word/media/f${i}.txt`,
      data: "x",
      method: 0 as const,
    }));
    expect(reasonOf(buildDocx(entries))).toBe(RejectionReason.ARCHIVE_TOO_LARGE);
  });

  it("rejects truncated or garbled zips as corrupt, not a crash", () => {
    const good = buildDocx();
    expect(reasonOf(good.subarray(0, good.length - 30))).toBe(RejectionReason.CORRUPT_FILE);
    expect(reasonOf(Buffer.concat([Buffer.from("PK\x03\x04"), Buffer.alloc(50, 7)]))).toBe(
      RejectionReason.CORRUPT_FILE,
    );
  });

  it("rejects entry names that try to escape the extraction directory", () => {
    expect(reasonOf(buildDocx([{ name: "../../evil.txt", data: "x" }]))).toBe(
      RejectionReason.CORRUPT_FILE,
    );
  });
});
