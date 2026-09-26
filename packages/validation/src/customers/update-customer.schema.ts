import { z } from "zod";

/** §33/34/17.4's own "edit" action -- every field optional (a PATCH),
 * including `active` (§33's "account status" toggle). */
export const updateCustomerSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    // 23.16: an explicit null clears the value (omitting a key leaves it untouched).
    phone: z.string().max(50).nullable().optional(),
    email: z.string().email().max(320).nullable().optional(),
    company: z.string().max(200).nullable().optional(),
    address: z.string().max(500).nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided.",
  });

export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
