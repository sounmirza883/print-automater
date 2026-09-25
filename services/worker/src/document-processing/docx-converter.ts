/** DI token for the DOCX -> PDF converter. The pipeline depends only on
 * this interface so tests use a fake and production binds the
 * LibreOffice implementation. */
export const DOCX_CONVERTER = Symbol("DOCX_CONVERTER");

/** Why a conversion did not produce a PDF.
 * - UNAVAILABLE: converter disabled or the binary is not installed/runnable.
 * - TIMEOUT: exceeded the wall-clock limit and was killed.
 * - FAILED: the converter ran but produced no usable PDF. */
export type DocxConversionFailure = "UNAVAILABLE" | "TIMEOUT" | "FAILED";

export class DocxConversionError extends Error {
  constructor(
    readonly failure: DocxConversionFailure,
    message: string,
  ) {
    super(message);
    this.name = "DocxConversionError";
  }
}

export interface DocxConverter {
  /** Converts DOCX bytes to PDF bytes, or throws DocxConversionError. */
  convert(docx: Buffer): Promise<Buffer>;
}
