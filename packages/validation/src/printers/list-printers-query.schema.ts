import { z } from "zod";

export const listPrintersQuerySchema = z.object({
  shopId: z.string().uuid(),
});

export type ListPrintersQueryInput = z.infer<typeof listPrintersQuerySchema>;
