import { z } from "zod";
import { SupplierStatus } from "@print-automated/types";
import { paginationQuerySchema } from "../common/pagination.schema.js";

const text = (max: number) => z.string().trim().min(1).max(max);

export const createSupplierSchema = z.object({
  shopId: z.string().uuid(),
  name: text(200),
  contactName: text(200).optional(),
  email: z.string().trim().email().max(320).optional(),
  phone: text(50).optional(),
  address: text(500).optional(),
  paymentTerms: text(200).optional(),
  notes: text(2000).optional(),
});
export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;

/** PATCH: `null` clears an optional field; `status` INACTIVE retires a supplier
 * (suppliers are never deleted, purchase-order history keeps its subject). */
export const updateSupplierSchema = z
  .object({
    name: text(200).optional(),
    contactName: text(200).nullable().optional(),
    email: z.string().trim().email().max(320).nullable().optional(),
    phone: text(50).nullable().optional(),
    address: text(500).nullable().optional(),
    paymentTerms: text(200).nullable().optional(),
    notes: text(2000).nullable().optional(),
    status: z.nativeEnum(SupplierStatus).optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: "At least one field must be provided." });
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;

export const listSuppliersQuerySchema = paginationQuerySchema.extend({
  shopId: z.string().uuid(),
  search: z.string().trim().min(1).max(100).optional(),
  status: z.nativeEnum(SupplierStatus).optional(),
});
export type ListSuppliersQueryInput = z.infer<typeof listSuppliersQuerySchema>;

export const linkSupplierProductSchema = z.object({
  inventoryItemId: z.string().uuid(),
  supplierSku: text(100).optional(),
  unitPriceMinor: z.number().int().min(0).max(1_000_000_000).optional(),
  leadTimeDays: z.number().int().min(0).max(3650).optional(),
});
export type LinkSupplierProductInput = z.infer<typeof linkSupplierProductSchema>;

export const updateSupplierProductSchema = z
  .object({
    supplierSku: text(100).nullable().optional(),
    unitPriceMinor: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
    leadTimeDays: z.number().int().min(0).max(3650).nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: "At least one field must be provided." });
export type UpdateSupplierProductInput = z.infer<typeof updateSupplierProductSchema>;
