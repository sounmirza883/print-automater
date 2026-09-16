import { z } from "zod";

/** §9.12. Deliberately narrower than the full `PrintJobStatus` enum --
 * QUEUED/CLAIMED are server-driven (9.7), TIMEOUT is the backend's own
 * (10.5), CANCELLED is staff-driven. These four are the only outcomes
 * an agent has any basis to report about its own submission: PRINTING
 * once 9.9's driver call succeeds, then whichever verdict 9.11's
 * monitor reaches. */
export const reportJobStatusSchema = z.object({
  status: z.enum(["PRINTING", "PRINTED", "FAILED", "UNKNOWN"]),
  osJobId: z.string().optional(),
});

export type ReportJobStatusInput = z.infer<typeof reportJobStatusSchema>;
