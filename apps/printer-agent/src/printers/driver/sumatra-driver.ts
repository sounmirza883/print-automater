import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type pino from "pino";
import { buildPrintSettings } from "./settings-mapping.js";
import type { PrintOptions, PrinterDriver, PrintSubmission } from "./printer-driver.js";

const execFileAsync = promisify(execFile);
const SUBMIT_TIMEOUT_MS = 60_000;

/** §9.9/§17: invoked as a separate process (aggregation, not linking
 * -- SumatraPDF is GPLv3, and 13.3's installer ships it alongside its
 * own license, a licensing boundary this abstraction exists partly to
 * preserve). `-silent -exit-when-done` is what makes this call
 * observably finish rather than leave a GUI window open; exit code 0
 * here means "SumatraPDF accepted the job and handed it to the OS
 * spooler," nothing more -- see printer-driver.ts's own note on why
 * that is never treated as "printed." */
export class SumatraPrinterDriver implements PrinterDriver {
  constructor(
    private readonly sumatraPath: string,
    private readonly logger: pino.Logger,
  ) {}

  async print(options: PrintOptions): Promise<PrintSubmission> {
    const settings = buildPrintSettings(options.configuration);
    const args = [
      "-print-to",
      options.printerName,
      "-print-settings",
      settings,
      "-silent",
      "-exit-when-done",
      options.filePath,
    ];

    this.logger.info({ printer: options.printerName, settings }, "submitting print job");
    await execFileAsync(this.sumatraPath, args, { timeout: SUBMIT_TIMEOUT_MS });
    return {};
  }
}
