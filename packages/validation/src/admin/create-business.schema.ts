import { z } from "zod";
import { printerCapabilitiesSchema } from "../printers/printer-capabilities.schema.js";

/** 23.7/Workstream A: `POST /admin/businesses` (ADMIN only). Deliberately
 * narrow -- `id` and `status` are never accepted from the client (a new
 * business is always born `CLOSED`, per the schema's own default, until
 * its owner opens it; `id` is always server-generated), matching the
 * "no field a client can smuggle in" discipline this codebase already
 * uses for e.g. `registerPrinterSchema`. `capabilities` reuses the exact
 * shape `Shop.capabilities` already stores (printerCapabilitiesSchema),
 * since the Prisma schema itself documents that mirror. */
export const createBusinessSchema = z.object({
  name: z.string().min(1).max(200),
  address: z.string().min(1).max(500),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  phone: z.string().min(1).max(50).optional(),
  capabilities: printerCapabilitiesSchema.optional(),
});

export type CreateBusinessInput = z.infer<typeof createBusinessSchema>;
