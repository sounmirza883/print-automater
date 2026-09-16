import { z } from "zod";

/** §49/10.4. */
export const changePrinterSchema = z.object({
  printerId: z.string().uuid(),
});

export type ChangePrinterInput = z.infer<typeof changePrinterSchema>;
