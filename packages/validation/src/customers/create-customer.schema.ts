import { z } from "zod";

/** §33/34/17.4's own "create a walk-in customer" action. No email/
 * phone uniqueness constraint -- matching Customer's own schema
 * comment (15.5): two different customers can share a phone number. */
export const createCustomerSchema = z.object({
  shopId: z.string().uuid(),
  name: z.string().min(1).max(200),
  phone: z.string().max(50).optional(),
  email: z.string().email().max(320).optional(),
  company: z.string().max(200).optional(),
  address: z.string().max(500).optional(),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
