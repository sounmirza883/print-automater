import { z } from "zod";

/** §14/§71 POST /documents. The client declares intended metadata
 * upfront so the server can generate a presigned PUT immediately;
 * §86's real, authoritative checks (magic bytes, actual size, ClamAV,
 * page count) happen server-side in 2.7 once the bytes actually arrive
 * -- this is a cheap early rejection, not the security boundary. */
export const createDocumentSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.literal("application/pdf"),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(25 * 1024 * 1024, "File exceeds the 25MB limit."),
});

export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;
