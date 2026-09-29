import { z } from "zod";
import { printConfigurationSchema } from "../print-configuration.schema.js";

/** Characters a human-typed phone number may contain. */
const PHONE_CHARACTERS = /^[0-9+\-().\s]+$/;

/** 24.1 `POST /public/shops/:shopId/orders` -- a guest who scanned the
 * shop's QR code, with no account. Same "no price field, ever" shape as
 * createQuoteSchema, and deliberately no `shopId` (the route param decides
 * the shop), no `customerRecordId` (the service creates the guest's
 * Customer row itself) and no `creationSource` (always QR): zod's default
 * strip drops anything else a caller sends.
 *
 * `name`/`phone` use createCustomerSchema's own bounds (15.5/17.4), but the
 * phone is REQUIRED here -- with no account, it is the only way the shop
 * can reach the guest -- and must look like a phone number (7-15 digits,
 * E.164's maximum), since nobody at a counter is checking it. */
export const createPublicOrderSchema = z.object({
  name: z.string().trim().min(1).max(200),
  phone: z
    .string()
    .trim()
    .max(50)
    .regex(PHONE_CHARACTERS, "Enter a phone number using digits only.")
    .refine((phone) => {
      const digits = phone.replace(/\D/g, "").length;
      return digits >= 7 && digits <= 15;
    }, "Enter a phone number of 7 to 15 digits."),
  documentId: z.string().uuid(),
  printConfiguration: printConfigurationSchema,
});

export type CreatePublicOrderInput = z.infer<typeof createPublicOrderSchema>;
