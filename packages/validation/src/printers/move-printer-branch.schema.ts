import { z } from "zod";

/** `PUT /shop/printers/:id/branch`: move the printer's PC, with every printer on it, to a branch. */
export const movePrinterBranchSchema = z.object({
  branchId: z.string().uuid(),
});

export type MovePrinterBranchInput = z.infer<typeof movePrinterBranchSchema>;
