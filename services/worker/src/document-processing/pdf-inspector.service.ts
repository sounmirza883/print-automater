import { Injectable } from "@nestjs/common";
import { EncryptedPDFError, PDFDocument } from "pdf-lib";
import { DocumentRejectedError } from "./document-rejected.error.js";
import { RejectionReason } from "./rejection-reason.js";

const MAX_PAGES = 500;

export interface PdfInspectionResult {
  pageCount: number;
}

/** §86: page count and password-protection, via pdf-lib -- the design's
 * named library for this check. `PDFDocument.load` without
 * `ignoreEncryption` throws pdf-lib's own EncryptedPDFError for a
 * password-protected file, which is exactly the signal to distinguish
 * "encrypted" from "genuinely corrupt" (some other parse failure).
 *
 * `instanceof EncryptedPDFError` alone proved fragile in practice (a
 * dual-package-instance quirk observed empirically: the thrown error's
 * message matched EncryptedPDFError's exactly, but `instanceof` still
 * returned false) -- checking the message too is belt-and-suspenders
 * against that, not a style choice. */
@Injectable()
export class PdfInspectorService {
  async inspect(buffer: Buffer): Promise<PdfInspectionResult> {
    let pdf: PDFDocument;
    try {
      pdf = await PDFDocument.load(buffer);
    } catch (error) {
      if (isEncryptedPdfError(error)) {
        throw new DocumentRejectedError(RejectionReason.PASSWORD_PROTECTED);
      }
      throw new DocumentRejectedError(RejectionReason.CORRUPT_FILE);
    }

    const pageCount = pdf.getPageCount();
    if (pageCount > MAX_PAGES) {
      throw new DocumentRejectedError(RejectionReason.PAGE_LIMIT_EXCEEDED);
    }

    return { pageCount };
  }
}

function isEncryptedPdfError(error: unknown): boolean {
  if (error instanceof EncryptedPDFError) {
    return true;
  }
  return error instanceof Error && error.message.includes("is encrypted");
}
