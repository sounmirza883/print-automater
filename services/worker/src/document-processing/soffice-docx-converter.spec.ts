import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { SofficeDocxConverter, buildSofficeArgs } from "./soffice-docx-converter.js";
import { DocxConversionError } from "./docx-converter.js";
import { buildDocx, buildZip } from "../../test/helpers/zip-builder.js";

const FAKE_PDF = "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF";

/** The converter's argv is fixed, so tests substitute the "soffice" binary
 * with `node <fake.js>` via the `binaryArgsPrefix` seam. The fake finds
 * --outdir and the input path in argv exactly like soffice would. */
function writeFake(dir: string, name: string, body: string): string[] {
  const file = path.join(dir, name);
  writeFileSync(
    file,
    `const a = process.argv.slice(2);
const outdir = a[a.indexOf("--outdir") + 1];
const input = a[a.length - 1];
const fs = require("fs"); const path = require("path");
${body}`,
  );
  return [file];
}

describe("SofficeDocxConverter (fake soffice: behaviour of the sandbox wrapper)", () => {
  let scratch: string; // holds the fake scripts
  let tmpRoot: string; // where the converter makes per-job dirs

  beforeEach(() => {
    scratch = mkdtempSync(path.join(os.tmpdir(), "fake-soffice-"));
    tmpRoot = mkdtempSync(path.join(os.tmpdir(), "docx-jobs-"));
  });
  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  const make = (
    prefix: string[],
    overrides: Partial<{ timeoutMs: number; enabled: boolean }> = {},
  ) =>
    new SofficeDocxConverter({
      enabled: overrides.enabled ?? true,
      binary: process.execPath,
      binaryArgsPrefix: prefix,
      timeoutMs: overrides.timeoutMs ?? 10_000,
      tmpRoot,
    });

  async function failureOf(promise: Promise<unknown>): Promise<string> {
    try {
      await promise;
    } catch (error) {
      if (error instanceof DocxConversionError) return error.failure;
      throw error;
    }
    throw new Error("expected DocxConversionError");
  }

  it("returns the PDF the converter wrote and removes the per-job temp dir", async () => {
    const prefix = writeFake(
      scratch,
      "ok.js",
      `fs.writeFileSync(path.join(outdir, path.basename(input, ".docx") + ".pdf"), ${JSON.stringify(FAKE_PDF)});`,
    );
    const pdf = await make(prefix).convert(buildDocx());
    expect(pdf.toString("latin1")).toBe(FAKE_PDF);
    expect(readdirSync(tmpRoot)).toEqual([]);
  });

  it("builds a fixed argv array (spawned with shell:false): hostile paths are single arguments, never parsed", () => {
    const hostile = "/t/a b; rm -rf ~ $(x)";
    const args = buildSofficeArgs("/t/profile", "/t/out", hostile);
    expect(args).toEqual([
      "--headless",
      "--norestore",
      "--nolockcheck",
      "--nodefault",
      "--nologo",
      "--nofirststartwizard",
      "-env:UserInstallation=file:///t/profile",
      "--convert-to",
      "pdf:writer_pdf_Export",
      "--outdir",
      "/t/out",
      hostile,
    ]);
    expect(buildSofficeArgs("C:\\Temp\\job\\profile", "o", "i")[6]).toBe(
      "-env:UserInstallation=file:///C:/Temp/job/profile",
    );
  });

  it("times out a hung converter, kills it, and cleans up (never hangs the worker)", async () => {
    const prefix = writeFake(scratch, "hang.js", "setInterval(() => {}, 1000);");
    const started = Date.now();
    expect(await failureOf(make(prefix, { timeoutMs: 700 }).convert(buildDocx()))).toBe("TIMEOUT");
    expect(Date.now() - started).toBeLessThan(8000);
    expect(readdirSync(tmpRoot)).toEqual([]);
  }, 15_000);

  it("reports FAILED for a non-zero exit, and for a zero exit that wrote no PDF", async () => {
    const crash = writeFake(scratch, "crash.js", "process.exit(3);");
    expect(await failureOf(make(crash).convert(buildDocx()))).toBe("FAILED");
    const silent = writeFake(scratch, "silent.js", "process.exit(0);");
    expect(await failureOf(make(silent).convert(buildDocx()))).toBe("FAILED");
    expect(readdirSync(tmpRoot)).toEqual([]);
  });

  it("reports FAILED when the output is not actually a PDF", async () => {
    const prefix = writeFake(
      scratch,
      "garbage.js",
      `fs.writeFileSync(path.join(outdir, "input.pdf"), "not a pdf at all");`,
    );
    expect(await failureOf(make(prefix).convert(buildDocx()))).toBe("FAILED");
  });

  it("reports UNAVAILABLE when the binary is missing (no soffice installed) and does not hang", async () => {
    const converter = new SofficeDocxConverter({
      enabled: true,
      binary: path.join(scratch, "definitely-not-soffice"),
      timeoutMs: 10_000,
      tmpRoot,
    });
    const started = Date.now();
    expect(await failureOf(converter.convert(buildDocx()))).toBe("UNAVAILABLE");
    expect(Date.now() - started).toBeLessThan(5000);
    expect(readdirSync(tmpRoot)).toEqual([]);
  });

  it("reports UNAVAILABLE when disabled by configuration, without spawning anything", async () => {
    const prefix = writeFake(scratch, "never.js", "process.exit(0);");
    expect(await failureOf(make(prefix, { enabled: false }).convert(buildDocx()))).toBe(
      "UNAVAILABLE",
    );
    expect(readdirSync(tmpRoot)).toEqual([]);
  });

  it("runs conversions strictly one at a time (concurrency 1)", async () => {
    const prefix = writeFake(
      scratch,
      "slow.js",
      `setTimeout(() => { fs.writeFileSync(path.join(outdir, "input.pdf"), ${JSON.stringify(FAKE_PDF)}); }, 400);`,
    );
    const converter = make(prefix);
    const started = Date.now();
    await Promise.all([converter.convert(buildDocx()), converter.convert(buildDocx())]);
    // Serial: at least two full runs. Parallel would finish in ~400 ms.
    expect(Date.now() - started).toBeGreaterThanOrEqual(780);
  }, 20_000);

  it("a timeout in one job does not poison the queue: the next job still runs", async () => {
    const hang = writeFake(scratch, "hang2.js", "setInterval(() => {}, 1000);");
    const ok = writeFake(
      scratch,
      "ok2.js",
      `fs.writeFileSync(path.join(outdir, "input.pdf"), ${JSON.stringify(FAKE_PDF)});`,
    );
    const slow = make(hang, { timeoutMs: 500 });
    const first = failureOf(slow.convert(buildDocx()));
    expect(await first).toBe("TIMEOUT");
    const fine = make(ok);
    expect((await fine.convert(buildDocx())).toString("latin1")).toBe(FAKE_PDF);
  }, 20_000);
});

/** Real LibreOffice. Skipped (and reported as skipped, not passed) when
 * soffice is not installed, as on this Windows dev machine; it runs where
 * the worker image (which installs LibreOffice) or a dev install exists. */
const SOFFICE = process.env.SOFFICE_PATH ?? "soffice";
const hasSoffice = spawnSync(SOFFICE, ["--version"], { timeout: 30_000 }).status === 0;

(hasSoffice ? describe : describe.skip)("SofficeDocxConverter (real soffice)", () => {
  it("converts a minimal DOCX to a real PDF", async () => {
    const docx = buildZip([
      {
        name: "[Content_Types].xml",
        data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      },
      {
        name: "_rels/.rels",
        data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      },
      {
        name: "word/document.xml",
        data: '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello from the real converter</w:t></w:r></w:p></w:body></w:document>',
      },
    ]);
    const converter = new SofficeDocxConverter({
      enabled: true,
      binary: SOFFICE,
      timeoutMs: 120_000,
    });
    const pdf = await converter.convert(docx);
    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThanOrEqual(1);
  }, 150_000);
});
