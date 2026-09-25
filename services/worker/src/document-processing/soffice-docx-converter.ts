import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DocxConversionError, type DocxConverter } from "./docx-converter.js";

/** Upper bound on the PDF LibreOffice may produce for one document. */
const MAX_OUTPUT_PDF_BYTES = 100 * 1024 * 1024;

export interface SofficeOptions {
  /** DOCX_CONVERSION_ENABLED. When false every call is UNAVAILABLE. */
  enabled: boolean;
  /** SOFFICE_PATH: the soffice binary (default "soffice" on PATH). */
  binary: string;
  /** DOCX_CONVERSION_TIMEOUT_MS: wall-clock limit before the process tree is killed. */
  timeoutMs: number;
  /** Where per-job directories are made (default: the OS temp dir). */
  tmpRoot?: string;
  /** Test seam: arguments placed before the real ones, so a test can run
   * `node fake-soffice.js <args>`. Always empty in production. */
  binaryArgsPrefix?: string[];
}

/** LibreOffice per-job registry: macros hard-disabled and "update links
 * on load" set to Never, so a document cannot make the converter run code
 * or refresh remote links. The structural DOCX gate additionally refuses
 * documents whose relationships point at external images, templates or
 * OLE objects. */
const REGISTRY_MODIFICATIONS = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
<item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>2</value></prop></item>
</oor:items>
`;

/** Exported for tests: the exact argv (never a shell string). */
export function buildSofficeArgs(profileDir: string, outDir: string, inputPath: string): string[] {
  const p = profileDir.replace(/\\/g, "/");
  const profileUrl = p.startsWith("/") ? `file://${p}` : `file:///${p}`;
  return [
    "--headless",
    "--norestore",
    "--nolockcheck",
    "--nodefault",
    "--nologo",
    "--nofirststartwizard",
    `-env:UserInstallation=${profileUrl}`,
    "--convert-to",
    "pdf:writer_pdf_Export",
    "--outdir",
    outDir,
    inputPath,
  ];
}

/** 21.10: DOCX -> PDF with LibreOffice headless, run as a sandboxed child.
 *
 * - argv array via spawn with shell:false: nothing is ever interpolated
 *   into a shell string;
 * - a private per-job directory (input, output AND the LibreOffice
 *   profile) that is removed on every path (success, failure, timeout);
 * - a minimal child environment (no secrets inherited: the worker's
 *   DATABASE_URL, KMS key etc. never reach LibreOffice);
 * - a wall-clock timeout that kills the whole process tree (soffice
 *   spawns soffice.bin);
 * - strictly one conversion at a time in this process (LibreOffice is
 *   heavy and its profile handling is not concurrency-friendly).
 *
 * Network: the converter process gets no proxy/config, macros and link
 * refresh are disabled in its profile, and the DOCX inspector already
 * refused externally-linked content. Production should additionally run
 * the worker where the container cannot reach the internet (see
 * docker-compose.prod.yml notes); this class cannot enforce that alone. */
export class SofficeDocxConverter implements DocxConverter {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: SofficeOptions) {}

  convert(docx: Buffer): Promise<Buffer> {
    // Serialise, and keep the chain alive whatever a single job does.
    const run = this.tail.then(() => this.convertNow(docx));
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async convertNow(docx: Buffer): Promise<Buffer> {
    if (!this.options.enabled) {
      throw new DocxConversionError("UNAVAILABLE", "DOCX conversion is disabled by configuration.");
    }

    const jobDir = await mkdtemp(path.join(this.options.tmpRoot ?? os.tmpdir(), "docx-convert-"));
    try {
      const inputPath = path.join(jobDir, "input.docx");
      const outDir = path.join(jobDir, "out");
      const profileDir = path.join(jobDir, "profile");
      await mkdir(outDir);
      await mkdir(path.join(profileDir, "user"), { recursive: true });
      await writeFile(inputPath, docx);
      await writeFile(
        path.join(profileDir, "user", "registrymodifications.xcu"),
        REGISTRY_MODIFICATIONS,
      );

      await this.run(buildSofficeArgs(profileDir, outDir, inputPath), jobDir);

      const outputPath = path.join(outDir, "input.pdf");
      let size: number;
      try {
        size = (await stat(outputPath)).size;
      } catch {
        throw new DocxConversionError("FAILED", "The converter produced no PDF.");
      }
      if (size > MAX_OUTPUT_PDF_BYTES) {
        throw new DocxConversionError("FAILED", "The converted PDF is too large.");
      }
      const pdf = await readFile(outputPath);
      if (pdf.subarray(0, 5).toString("ascii") !== "%PDF-") {
        throw new DocxConversionError("FAILED", "The converter output is not a PDF.");
      }
      return pdf;
    } finally {
      // Retries: on Windows a just-killed process can hold its files briefly.
      await rm(jobDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(
        () => undefined,
      );
    }
  }

  private run(args: string[], jobDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const isWindows = process.platform === "win32";
      const child = spawn(
        this.options.binary,
        [...(this.options.binaryArgsPrefix ?? []), ...args],
        {
          shell: false,
          stdio: "ignore",
          windowsHide: true,
          // Own process group on POSIX so the timeout can kill soffice.bin too.
          detached: !isWindows,
          env: minimalEnv(jobDir),
        },
      );

      let settled = false;
      const finish = (error?: DocxConversionError): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };

      const timer = setTimeout(() => {
        killTree(child.pid, isWindows);
        finish(
          new DocxConversionError(
            "TIMEOUT",
            `The conversion exceeded ${this.options.timeoutMs} ms and was killed.`,
          ),
        );
      }, this.options.timeoutMs);

      child.on("error", (error: NodeJS.ErrnoException) => {
        finish(
          new DocxConversionError(
            error.code === "ENOENT" || error.code === "EACCES" ? "UNAVAILABLE" : "FAILED",
            `Could not run the converter (${error.code ?? error.message}).`,
          ),
        );
      });
      child.on("exit", (code) => {
        if (code === 0) finish();
        else finish(new DocxConversionError("FAILED", `The converter exited with code ${code}.`));
      });
    });
  }
}

function minimalEnv(jobDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: jobDir,
    TMPDIR: jobDir,
    TEMP: jobDir,
    TMP: jobDir,
    LANG: "C.UTF-8",
    // Headless rendering backend: no X server needed.
    SAL_USE_VCLPLUGIN: "svp",
  };
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  return env;
}

/** Kills only the process this converter spawned (and its descendants). */
function killTree(pid: number | undefined, isWindows: boolean): void {
  if (!pid) return;
  if (isWindows) {
    execFile("taskkill", ["/pid", String(pid), "/T", "/F"], () => undefined);
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
}
