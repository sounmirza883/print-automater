import { z } from "zod";
import { ReprintReason } from "@print-automated/types";

/** 21.4 (§67). The reason is a picker (required); the note is optional colour.
 * `additionalCostMinor` is the extra cost of the reprint in minor units (recorded
 * only: it never changes the order's price snapshot). `printerId` optionally
 * names the printer, like reassign; omitted means automatic allocation. */
export const reprintJobSchema = z.object({
  reason: z.nativeEnum(ReprintReason),
  note: z.string().trim().min(1).max(500).optional(),
  additionalCostMinor: z.number().int().min(0).max(1_000_000_000).optional(),
  printerId: z.string().uuid().optional(),
});

export type ReprintJobInput = z.infer<typeof reprintJobSchema>;
