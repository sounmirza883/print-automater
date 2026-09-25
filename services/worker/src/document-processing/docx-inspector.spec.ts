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

  describe("21.13 zip structure hardening", () => {
    it("rejects duplicate entry names (exact and case-insensitive)", () => {
      expect(reasonOf(buildDocx([{ name: "word/document.xml", data: "<x/>" }]))).toBe(
        RejectionReason.CORRUPT_FILE,
      );
      expect(reasonOf(buildDocx([{ name: "WORD/Document.XML", data: "<x/>" }]))).toBe(
        RejectionReason.CORRUPT_FILE,
      );
    });

    it("rejects an entry whose local header name differs from the central directory", () => {
      expect(
        reasonOf(buildDocx([{ name: "word/a.txt", data: "hi", localName: "word/b.txt" }])),
      ).toBe(RejectionReason.CORRUPT_FILE);
    });

    it("rejects an entry whose local compressed size differs from the central directory", () => {
      expect(
        reasonOf(buildDocx([{ name: "word/a.txt", data: "hi", localCompressedSize: 3 }])),
      ).toBe(RejectionReason.CORRUPT_FILE);
    });

    it("rejects overlapping entries (two central entries pointing at the same data)", () => {
      expect(
        reasonOf(buildDocx([{ name: "word/alias.txt", data: "x", centralLocalOffset: 0 }])),
      ).toBe(RejectionReason.CORRUPT_FILE);
    });
  });

  describe("21.13 main part is resolved by parsing, not substring matching", () => {
    const ct = (inner: string) =>
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${inner}</Types>`;
    const MAIN = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";

    it("accepts the main part when the officeDocument relationship and Override agree", () => {
      expect(
        reasonOf(
          buildDocx([], ct(`<Override PartName="/word/document.xml" ContentType="${MAIN}"/>`)),
        ),
      ).toBeNull();
    });

    it("a content-type string that merely appears in a comment or another part does not count", () => {
      const sneaky = ct(
        `<!-- ${MAIN} --><Override PartName="/word/other.xml" ContentType="${MAIN}"/>`,
      );
      expect(reasonOf(buildDocx([], sneaky))).toBe(RejectionReason.INVALID_FILE_TYPE);
    });

    it("rejects when there is no officeDocument relationship", () => {
      const noRel = buildZip([
        {
          name: "[Content_Types].xml",
          data: ct(`<Override PartName="/word/document.xml" ContentType="${MAIN}"/>`),
        },
        { name: "_rels/.rels", data: "<Relationships/>" },
        { name: "word/document.xml", data: "<w:document xmlns:w='urn:w'/>" },
      ]);
      expect(reasonOf(noRel)).toBe(RejectionReason.INVALID_FILE_TYPE);
    });

    it("rejects an officeDocument relationship that points at an external or missing part", () => {
      const R =
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";
      for (const rel of [
        `<Relationship Id="a" Type="${R}" Target="http://x/doc.xml" TargetMode="External"/>`,
        `<Relationship Id="a" Type="${R}" Target="word/missing.xml"/>`,
      ]) {
        const zip = buildZip([
          {
            name: "[Content_Types].xml",
            data: ct(`<Override PartName="/word/document.xml" ContentType="${MAIN}"/>`),
          },
          { name: "_rels/.rels", data: `<Relationships>${rel}</Relationships>` },
          { name: "word/document.xml", data: "<w:document xmlns:w='urn:w'/>" },
        ]);
        expect([RejectionReason.INVALID_FILE_TYPE, RejectionReason.EXTERNAL_CONTENT]).toContain(
          reasonOf(zip),
        );
      }
    });

    it("macro-enabled content type on the main part is a macro rejection, prefixed elements included", () => {
      const docm = ct(
        `<c:Override xmlns:c="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/>`,
      );
      expect(reasonOf(buildDocx([], docm))).toBe(RejectionReason.MACRO_ENABLED_DOCUMENT);
    });

    it("a UTF-16 [Content_Types].xml is decoded properly, not substring-matched as bytes", () => {
      const text = ct(`<Override PartName="/word/document.xml" ContentType="${MAIN}"/>`);
      const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
      const zip = buildZip([
        { name: "[Content_Types].xml", data: utf16 },
        {
          name: "_rels/.rels",
          data: `<Relationships><Relationship Id="a" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="/word/document.xml"/></Relationships>`,
        },
        { name: "word/document.xml", data: "<w:document xmlns:w='urn:w'/>" },
      ]);
      expect(reasonOf(zip)).toBeNull();
    });
  });
});
