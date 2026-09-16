import type { PrintConfiguration } from "@print-automated/types";

export interface PrintOptions {
  printerName: string;
  filePath: string;
  configuration: PrintConfiguration;
}

export interface PrintSubmission {
  osJobId?: string;
}

/** §9.9. The one seam between "an agent has a job to print" and "a
 * specific mechanism does the printing" -- `SumatraPrinterDriver`
 * (real hardware, GPLv3, invoked as a separate process per §17's own
 * risk note) and `FakePrinterDriver` (CI, no hardware needed) are
 * both just this. A successful `print()` means "submitted to the
 * spooler," never "printed" -- 9.11's own monitor is what determines
 * the real outcome by watching the OS print queue. */
export interface PrinterDriver {
  print(options: PrintOptions): Promise<PrintSubmission>;
}
