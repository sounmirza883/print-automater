import { Injectable } from "@nestjs/common";
import { PDFDocument, degrees } from "pdf-lib";
import { DocumentRejectedError } from "./document-rejected.error.js";
import { RejectionReason } from "./rejection-reason.js";
import { readImageDimensions } from "./image-dimensions.js";

/** 21.9 decompression-bomb limits. The header-declared pixel count is
 * checked BEFORE any decoder runs. 40 MP covers phone photos and any
 * realistic scan while bounding decoded RGBA memory to ~160 MB for the
 * worst accepted PNG. The side cap stops absurd strips that pass the
 * area cap. */
export const MAX_IMAGE_PIXELS = 40_000_000;
export const MAX_IMAGE_SIDE = 20_000;

// A4 in PDF points (1/72 in). Images are scaled to fit, never cropped.
const A4_SHORT = 595.28;
const A4_LONG = 841.89;

/** 21.9: the agent contract is PDF-only, so JPG/PNG uploads are
 * normalised here into a single-page A4 PDF (portrait or landscape to
 * match the picture, image scaled to fit and centred). The printing
 * path, pricing and the agent stay untouched. Uses pdf-lib, already a
 * dependency, so no new package. */
@Injectable()
export class ImageToPdfService {
  async convert(buffer: Buffer, kind: "jpeg" | "png"): Promise<Buffer> {
    const dimensions = readImageDimensions(buffer, kind);
    if (!dimensions || dimensions.width < 1 || dimensions.height < 1) {
      throw new DocumentRejectedError(RejectionReason.CORRUPT_FILE);
    }
    if (
      dimensions.width * dimensions.height > MAX_IMAGE_PIXELS ||
      dimensions.width > MAX_IMAGE_SIDE ||
      dimensions.height > MAX_IMAGE_SIDE
    ) {
      throw new DocumentRejectedError(RejectionReason.IMAGE_DIMENSIONS_EXCEEDED);
    }

    try {
      const pdf = await PDFDocument.create();
      // pdf-lib's JPEG embedder reads `data.buffer` as if it began at the
      // view's start; a small Node Buffer is a slice of a shared pool, so
      // hand it a copy that owns its ArrayBuffer ("SOI not found" otherwise).
      const bytes = new Uint8Array(buffer);
      const image = kind === "jpeg" ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);

      // EXIF orientation only ever applies to JPEG here. 5-8 swap axes.
      const orientation = kind === "jpeg" ? dimensions.orientation : 1;
      const swapped = orientation >= 5;
      const shownW = swapped ? image.height : image.width;
      const shownH = swapped ? image.width : image.height;

      const landscape = shownW > shownH;
      const pageW = landscape ? A4_LONG : A4_SHORT;
      const pageH = landscape ? A4_SHORT : A4_LONG;
      const scale = Math.min(pageW / shownW, pageH / shownH);
      const displayW = shownW * scale;
      const displayH = shownH * scale;
      const offsetX = (pageW - displayW) / 2;
      const offsetY = (pageH - displayH) / 2;

      // Size of the image in its own (pre-rotation) frame.
      const drawW = swapped ? displayH : displayW;
      const drawH = swapped ? displayW : displayH;

      const page = pdf.addPage([pageW, pageH]);
      // pdf-lib rotates counter-clockwise about (x, y).
      if (orientation === 3) {
        page.drawImage(image, {
          x: offsetX + displayW,
          y: offsetY + displayH,
          width: drawW,
          height: drawH,
          rotate: degrees(180),
        });
      } else if (orientation === 6 || orientation === 5) {
        page.drawImage(image, {
          x: offsetX,
          y: offsetY + displayH,
          width: drawW,
          height: drawH,
          rotate: degrees(-90),
        });
      } else if (orientation === 8 || orientation === 7) {
        page.drawImage(image, {
          x: offsetX + displayW,
          y: offsetY,
          width: drawW,
          height: drawH,
          rotate: degrees(90),
        });
      } else {
        page.drawImage(image, { x: offsetX, y: offsetY, width: drawW, height: drawH });
      }

      return Buffer.from(await pdf.save());
    } catch (error) {
      if (error instanceof DocumentRejectedError) throw error;
      // pdf-lib's decoders throw plain Errors on truncated/garbled data.
      throw new DocumentRejectedError(RejectionReason.CORRUPT_FILE);
    }
  }
}
