import { z } from "zod";
import { PurchaseOrderPaymentStatus, PurchaseOrderStatus } from "@print-automated/types";
import { paginationQuerySchema } from "../common/pagination.schema.js";

const money = z.number().int().min(0).max(1_000_000_000);

export const createPurchaseOrderSchema = z
  .object({
    shopId: z.string().uuid(),
    supplierId: z.string().uuid(),
    expectedDeliveryAt: z.coerce.date().optional(),
    notes: z.string().trim().min(1).max(2000).optional(),
    lines: z
      .array(
        z.object({
          inventoryItemId: z.string().uuid(),
          quantity: z.number().int().min(1).max(100_000_000),
          /** Defaults to the supplier's price for the item, else the item's unit cost, else 0. */
          unitCostMinor: money.optional(),
        }),
      )
      .min(1)
      .max(200),
  })
  .refine((d) => new Set(d.lines.map((l) => l.inventoryItemId)).size === d.lines.length, {
    message: "Each item may appear once per purchase order.",
    path: ["lines"],
  });
export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;

export const updatePurchaseOrderSchema = z
  .object({
    expectedDeliveryAt: z.coerce.date().nullable().optional(),
    notes: z.string().trim().min(1).max(2000).nullable().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: "At least one field must be provided." });
export type UpdatePurchaseOrderInput = z.infer<typeof updatePurchaseOrderSchema>;

export const listPurchaseOrdersQuerySchema = paginationQuerySchema.extend({
  shopId: z.string().uuid(),
  status: z.nativeEnum(PurchaseOrderStatus).optional(),
  supplierId: z.string().uuid().optional(),
});
export type ListPurchaseOrdersQueryInput = z.infer<typeof listPurchaseOrdersQuerySchema>;

/** Receive goods. Without `lines` every line is received at its ordered quantity.
 * With `lines`, unlisted lines are received at their ordered quantity and a listed
 * line may be received short or over (a delivery is what it is), including 0. */
export const receivePurchaseOrderSchema = z
  .object({
    actualDeliveryAt: z.coerce.date().optional(),
    lines: z
      .array(
        z.object({
          lineId: z.string().uuid(),
          quantityReceived: z.number().int().min(0).max(100_000_000),
        }),
      )
      .max(200)
      .optional(),
  })
  .strict()
  // A bare POST with no body means "receive everything as ordered".
  .optional()
  .transform((body) => body ?? {});
export type ReceivePurchaseOrderInput = z.infer<typeof receivePurchaseOrderSchema>;

export const updatePurchaseOrderPaymentSchema = z.object({
  paymentStatus: z.nativeEnum(PurchaseOrderPaymentStatus),
});
export type UpdatePurchaseOrderPaymentInput = z.infer<typeof updatePurchaseOrderPaymentSchema>;
