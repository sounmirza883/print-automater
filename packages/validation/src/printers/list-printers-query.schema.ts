import { z } from "zod";
import { PrinterStatus } from "@print-automated/types";
import { optionalPaginationQuerySchema } from "../common/pagination.schema.js";

/** `GET /shop/printers`. 23.6: `q` matches name/model/location, `status` filters by
 * printer status; `limit`/`offset` opt into the envelope (else the legacy array, capped). */
export const listPrintersQuerySchema = z
  .object({
    shopId: z.string().uuid(),
    // Narrow to one branch. A branch-bound caller is pinned to their own (naming another is 403).
    branchId: z.string().uuid().optional(),
    q: z.string().min(1).max(100).optional(),
    status: z.nativeEnum(PrinterStatus).optional(),
  })
  .merge(optionalPaginationQuerySchema);

export type ListPrintersQueryInput = z.infer<typeof listPrintersQuerySchema>;
