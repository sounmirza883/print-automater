import { z } from "zod";

export const checkoutSchema = z.object({
  orderId: z.string().uuid(),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;
