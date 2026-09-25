import { z } from "zod";

/** §14/§71 POST /documents. The client declares intended metadata
 * upfront so the server can generate a presigned PUT immediately;
 * §86's real, authoritative checks (magic bytes, actual size, ClamAV,
 * page count) happen server-side in 2.7 once the bytes actually arrive
 * -- this is a cheap early rejection, not the security boundary. */
/** PRD 8 upload types. The declared type is only a cheap early gate:
 * the worker sniffs the real bytes and never trusts this value. JPG and
 * PNG (21.9) and DOCX (21.10, LibreOffice in the worker) are normalised
 * to a PDF by the worker, so everything downstream (pricing, agent)
 * still only ever sees a PDF. */
export const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const ALLOWED_UPLOAD_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  DOCX_MIME_TYPE,
] as const;

export type AllowedUploadMimeType = (typeof ALLOWED_UPLOAD_MIME_TYPES)[number];

export const createDocumentSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.enum(ALLOWED_UPLOAD_MIME_TYPES),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(25 * 1024 * 1024, "File exceeds the 25MB limit."),
});

export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;
