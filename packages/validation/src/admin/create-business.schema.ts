import { z } from "zod";
import { registerSchema } from "../auth/register.schema.js";
import { printerCapabilitiesSchema } from "../printers/printer-capabilities.schema.js";

/** 23.7/Workstream A: `POST /admin/businesses` (ADMIN only) -- since fix wave 1 the
 * ONLY way a business comes into existence (public self-service signup was removed:
 * onboarding is admin-only). Deliberately narrow -- `id` and `status` are never
 * accepted from the client (a new business is always born `CLOSED`, per the schema's
 * own default, until its owner opens it; `id` is always server-generated), matching
 * the "no field a client can smuggle in" discipline this codebase already uses for
 * e.g. `registerPrinterSchema`. `capabilities` reuses the exact shape
 * `Shop.capabilities` already stores (printerCapabilitiesSchema), since the Prisma
 * schema itself documents that mirror.
 *
 * `owner` (fix wave 1): the person who will run the business. The API creates their
 * SHOP_OWNER account and owner membership in the same transaction and emails them a
 * single-use code to set their OWN password -- so there is deliberately no password
 * field (the admin never knows it). Same name/email/phone rules as account sign-up
 * (`registerSchema`); the email is trimmed and lower-cased the same way. */
export const createBusinessSchema = z.object({
  name: z.string().min(1).max(200),
  address: z.string().min(1).max(500),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  phone: z.string().min(1).max(50).optional(),
  capabilities: printerCapabilitiesSchema.optional(),
  owner: registerSchema.pick({ name: true, email: true, phone: true }),
});

export type CreateBusinessInput = z.infer<typeof createBusinessSchema>;
