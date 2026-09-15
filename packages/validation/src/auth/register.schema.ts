import { z } from "zod";

/** §70 POST /auth/register. Shared by the backend (as the authoritative
 * validator) and, later, customer-web's signup form -- one rule set,
 * checked twice. `role` is deliberately absent: self-registration is
 * always a CUSTOMER account; the server, not the client, decides that. */
export const registerSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(200),
  phone: z.string().trim().min(1).max(30).optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
