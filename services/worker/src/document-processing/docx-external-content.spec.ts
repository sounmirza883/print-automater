import { inspectDocx } from "./docx-inspector.js";
import { DocumentRejectedError } from "./document-rejected.error.js";
import { RejectionReason } from "./rejection-reason.js";
import { buildDocx, wordDocument, R_NS } from "../../test/helpers/zip-builder.js";

/** 21.11: hostile fixtures for the external-content gate. Every one of these
 * would make LibreOffice read a local file or fetch a remote URL into the
 * PDF the customer downloads (local-file read / SSRF), so the gate must FAIL
 * CLOSED: it parses .rels and the word/ parts with a strict XML tokenizer and
 * rejects on any parse failure, not on a regex that can be stepped around. */

function reasonOf(buffer: Buffer): string | null {
  try {
    inspectDocx(buffer);
    return null;
  } catch (error) {
    if (error instanceof DocumentRejectedError) return error.reason;
    throw error;
  }
}

const rels = (inner: string, prefix = ""): string =>
  `<?xml version="1.0"?><${prefix}Relationships xmlns${prefix ? ":" + prefix.slice(0, -1) : ""}="http://schemas.openxmlformats.org/package/2006/relationships">${inner}</${prefix}Relationships>`;

const relsEntry = (data: string | Buffer) => [{ name: "word/_rels/document.xml.rels", data }];

const imageRel = (target: string, extra = 'TargetMode="External"', type = "image") =>
  `<Relationship Id="r1" Type="${R_NS}/${type}" Target="${target}" ${extra}/>`;

describe("21.11 external-content gate fails closed (.rels bypass fixtures)", () => {
  it("baseline: an external image relationship is rejected", () => {
    expect(reasonOf(buildDocx(relsEntry(rels(imageRel("http://x/a.png")))))).toBe(
      RejectionReason.EXTERNAL_CONTENT,
    );
  });

  it("'>' inside a quoted attribute does not hide TargetMode from the gate", () => {
    const tag = `<Relationship Id="r1" Type="${R_NS}/image" Target="http://x/&gt;" TargetMode="External"/>`;
    const raw = `<Relationship Id="r1" Type="${R_NS}/image" Target="http://x/>" TargetMode="External"/>`;
    expect(reasonOf(buildDocx(relsEntry(rels(tag))))).toBe(RejectionReason.EXTERNAL_CONTENT);
    expect(reasonOf(buildDocx(relsEntry(rels(raw))))).toBe(RejectionReason.EXTERNAL_CONTENT);
  });

  it("a namespace-prefixed <p:Relationship> is still a relationship", () => {
    const inner = `<p:Relationship Id="r1" Type="${R_NS}/image" Target="http://x/a.png" TargetMode="External"/>`;
    expect(reasonOf(buildDocx(relsEntry(rels(inner, "p:"))))).toBe(
      RejectionReason.EXTERNAL_CONTENT,
    );
  });

  it("a UTF-16 (BOM) .rels part is decoded and inspected, not skipped", () => {
    const text = rels(imageRel("file:///etc/passwd"));
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
    expect(reasonOf(buildDocx(relsEntry(le)))).toBe(RejectionReason.EXTERNAL_CONTENT);
    const be = Buffer.from(le);
    be.swap16(); // BOM becomes FE FF, payload big-endian
    expect(reasonOf(buildDocx(relsEntry(be)))).toBe(RejectionReason.EXTERNAL_CONTENT);
  });

  it("UTF-16 without a BOM, invalid UTF-8 and unsupported declared encodings are rejected", () => {
    const noBom = Buffer.from(rels(imageRel("http://x/a.png")), "utf16le");
    expect(reasonOf(buildDocx(relsEntry(noBom)))).toBe(RejectionReason.CORRUPT_FILE);
    const bad = Buffer.concat([Buffer.from("<Relationships>"), Buffer.from([0xff, 0xfe, 0xfd])]);
    expect(reasonOf(buildDocx(relsEntry(bad)))).toBe(RejectionReason.CORRUPT_FILE);
    const latin = `<?xml version="1.0" encoding="ISO-8859-1"?><Relationships/>`;
    expect(reasonOf(buildDocx(relsEntry(latin)))).toBe(RejectionReason.CORRUPT_FILE);
  });

  it("malformed XML (comment splicing an attribute, unclosed tags) fails closed", () => {
    const spliced = `<Relationships><Relationship Id="r1" Type="${R_NS}/image" Target="http://x"<!-- -->TargetMode="External"/></Relationships>`;
    expect(reasonOf(buildDocx(relsEntry(spliced)))).toBe(RejectionReason.CORRUPT_FILE);
    expect(reasonOf(buildDocx(relsEntry("<Relationships><Relationship")))).toBe(
      RejectionReason.CORRUPT_FILE,
    );
    expect(reasonOf(buildDocx(relsEntry("<Relationships></Wrong>")))).toBe(
      RejectionReason.CORRUPT_FILE,
    );
  });

  it("a relationship hidden in CDATA or a comment is not a relationship, but never crashes the gate", () => {
    const inert = `<Relationships><!-- ${imageRel("http://x/a.png")} --><![CDATA[${imageRel("http://y")}]]></Relationships>`;
    expect(reasonOf(buildDocx(relsEntry(inert)))).toBeNull();
  });

  it("DOCTYPE and entity declarations (XXE) are rejected", () => {
    const xxe = `<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]><Relationships/>`;
    expect(reasonOf(buildDocx(relsEntry(xxe)))).toBe(RejectionReason.EXTERNAL_CONTENT);
    const billion = `<!DOCTYPE r [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;">]><Relationships/>`;
    expect(reasonOf(buildDocx(relsEntry(billion)))).toBe(RejectionReason.EXTERNAL_CONTENT);
  });

  it("undeclared or custom entity references in attribute values are rejected", () => {
    const inner = `<Relationship Id="r1" Type="${R_NS}/hyperlink" Target="&custom;" TargetMode="External"/>`;
    expect(reasonOf(buildDocx(relsEntry(rels(inner))))).toBe(RejectionReason.CORRUPT_FILE);
  });

  it("a URI-scheme or UNC Target is rejected even with NO TargetMode=External", () => {
    for (const target of [
      "file:///etc/passwd",
      "http://169.254.169.254/latest/meta-data",
      "\\\\attacker\\share\\a.png",
      "//attacker/share/a.png",
      "ftp://x/a.png",
    ]) {
      expect(reasonOf(buildDocx(relsEntry(rels(imageRel(target, "")))))).toBe(
        RejectionReason.EXTERNAL_CONTENT,
      );
    }
  });

  it("entity- and whitespace-obfuscated schemes are decoded before the check", () => {
    for (const target of ["&#102;ile:///etc/passwd", "&#x66;ile:///etc/passwd", " \t\nfile:///x"]) {
      expect(reasonOf(buildDocx(relsEntry(rels(imageRel(target, "")))))).toBe(
        RejectionReason.EXTERNAL_CONTENT,
      );
    }
  });

  it("every non-hyperlink external relationship type is rejected, not an allowlist of bad ones", () => {
    for (const type of ["oleObject", "attachedTemplate", "frame", "somethingNew", "package"]) {
      expect(reasonOf(buildDocx(relsEntry(rels(imageRel("http://x/y", undefined, type)))))).toBe(
        RejectionReason.EXTERNAL_CONTENT,
      );
    }
  });

  it("hyperlinks: http(s) and mailto are fine, file: and UNC hyperlinks are not", () => {
    const link = (t: string) => imageRel(t, 'TargetMode="External"', "hyperlink");
    expect(reasonOf(buildDocx(relsEntry(rels(link("https://example.com")))))).toBeNull();
    expect(reasonOf(buildDocx(relsEntry(rels(link("mailto:a@b.c")))))).toBeNull();
    expect(reasonOf(buildDocx(relsEntry(rels(link("file:///etc/passwd")))))).toBe(
      RejectionReason.EXTERNAL_CONTENT,
    );
    expect(reasonOf(buildDocx(relsEntry(rels(link("\\\\h\\s\\f")))))).toBe(
      RejectionReason.EXTERNAL_CONTENT,
    );
  });

  it("the root _rels/.rels and header/footer rels are inspected too", () => {
    const bad = rels(imageRel("http://x/a.png"));
    expect(reasonOf(buildDocx([{ name: "word/_rels/header1.xml.rels", data: bad }]))).toBe(
      RejectionReason.EXTERNAL_CONTENT,
    );
  });
});

describe("21.11 field codes and external references in word/ parts", () => {
  const field = (instr: string) =>
    `<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve">${instr}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`;
  const doc = (body: string) => buildDocx([], undefined, wordDocument(body));

  it.each(["INCLUDEPICTURE", "INCLUDETEXT", "LINK", "DDE", "DDEAUTO", "IMPORT"])(
    "rejects the %s field",
    (name) => {
      expect(reasonOf(doc(field(` ${name} "http://x/y" `)))).toBe(RejectionReason.EXTERNAL_CONTENT);
      expect(reasonOf(doc(field(` ${name.toLowerCase()} "file:///c:/x" `)))).toBe(
        RejectionReason.EXTERNAL_CONTENT,
      );
    },
  );

  it("a field name split across several instrText runs is reassembled", () => {
    const split = `<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> INCLUDE</w:instrText></w:r><w:r><w:instrText>PICTURE "http://x"</w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`;
    expect(reasonOf(doc(split))).toBe(RejectionReason.EXTERNAL_CONTENT);
  });

  it("a dangerous field nested inside another field is found", () => {
    const nested = `<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> IF 1=1 </w:instrText></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> INCLUDETEXT "file:///x" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`;
    expect(reasonOf(doc(nested))).toBe(RejectionReason.EXTERNAL_CONTENT);
  });

  it("w:fldSimple with a dangerous instruction is rejected", () => {
    expect(
      reasonOf(
        doc(
          `<w:fldSimple w:instr=' INCLUDETEXT "file:///x" '><w:r><w:t>x</w:t></w:r></w:fldSimple>`,
        ),
      ),
    ).toBe(RejectionReason.EXTERNAL_CONTENT);
  });

  it("an instrText with no surrounding fldChar is still inspected", () => {
    expect(
      reasonOf(doc(`<w:p><w:r><w:instrText> DDEAUTO c:\\\\x </w:instrText></w:r></w:p>`)),
    ).toBe(RejectionReason.EXTERNAL_CONTENT);
  });

  it("harmless fields (HYPERLINK, PAGE, TOC, REF) are allowed", () => {
    for (const instr of [
      ' HYPERLINK "https://example.com" ',
      " PAGE ",
      " TOC \\o 1-3 ",
      " REF _Toc1 ",
    ]) {
      expect(reasonOf(doc(field(instr)))).toBeNull();
    }
  });

  it("rejects altChunk, OLE objects and linked (r:link) images", () => {
    expect(reasonOf(doc('<w:altChunk r:id="rId9"/>'))).toBe(RejectionReason.EXTERNAL_CONTENT);
    expect(
      reasonOf(
        doc('<w:p><w:r><w:object><o:OLEObject xmlns:o="urn:o" r:id="r1"/></w:object></w:r></w:p>'),
      ),
    ).toBe(RejectionReason.EXTERNAL_CONTENT);
    expect(reasonOf(doc('<w:p><a:blip xmlns:a="urn:a" r:link="rId3"/></w:p>'))).toBe(
      RejectionReason.EXTERNAL_CONTENT,
    );
    expect(reasonOf(doc('<w:p><v:imagedata xmlns:v="urn:v" src="http://x/a.png"/></w:p>'))).toBe(
      RejectionReason.EXTERNAL_CONTENT,
    );
  });

  it("scans headers, footers and other word/ parts, not just document.xml", () => {
    const part = wordDocument(field(' INCLUDEPICTURE "file:///etc/passwd" '));
    for (const name of ["word/header1.xml", "word/footer2.xml", "word/footnotes.xml"]) {
      expect(reasonOf(buildDocx([{ name, data: part }]))).toBe(RejectionReason.EXTERNAL_CONTENT);
    }
  });

  it("malformed document.xml fails closed instead of being skipped", () => {
    expect(reasonOf(doc("<w:p><w:r></w:p>"))).toBe(RejectionReason.CORRUPT_FILE);
  });

  it("DOCTYPE inside a word/ part is rejected", () => {
    const xxe = `<?xml version="1.0"?><!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]><w:document xmlns:w="urn:w"/>`;
    expect(reasonOf(buildDocx([], undefined, xxe))).toBe(RejectionReason.EXTERNAL_CONTENT);
  });
});
