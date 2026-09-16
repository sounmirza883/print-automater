import type { PrintOptions, PrinterDriver, PrintSubmission } from "./printer-driver.js";

/** §9.9/§15: "FakePrinterDriver runs the complete job lifecycle in CI
 * with no hardware." Records every submission instead of touching a
 * real printer, so tests can assert exactly what would have been sent
 * to SumatraPDF without needing it (or a printer) installed. */
export class FakePrinterDriver implements PrinterDriver {
  public readonly submissions: PrintOptions[] = [];

  print(options: PrintOptions): Promise<PrintSubmission> {
    this.submissions.push(options);
    return Promise.resolve({ osJobId: `fake-${this.submissions.length}` });
  }
}
