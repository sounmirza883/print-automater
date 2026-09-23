import { z } from "zod";

export const listProductsQuerySchema = z.object({
  shopId: z.string().uuid(),
});

export type ListProductsQueryInput = z.infer<typeof listProductsQuerySchema>;
