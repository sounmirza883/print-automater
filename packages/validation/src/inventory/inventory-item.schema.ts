import { z } from "zod";
import { InventoryMovementType, PaperSize, PaperType } from "@print-automated/types";
import { paginationQuerySchema, queryBooleanSchema } from "../common/pagination.schema.js";

const quantity = z.number().int().min(0).max(100_000_000);

/** §26. Fields common to create and update. `paperSize`/`paperType` use the
 * same closed vocabulary a print job's configuration uses (15.1), which is what
 * lets the paper gate (20.3) and consumption (20.4) match a job to stock. */
const itemFields = {
  name: z.string().trim().min(1).max(200),
  sku: z.string().trim().min(1).max(100),
  paperSize: z.nativeEnum(PaperSize),
  paperType: z.nativeEnum(PaperType),
  weightGsm: z.number().int().positive().max(5000),
  minQuantity: quantity,
  maxQuantity: quantity,
  location: z.string().trim().min(1).max(200),
  unitCostMinor: z.number().int().min(0).max(100_000_000),
};

const maxNotBelowMin = (data: { minQuantity?: number; maxQuantity?: number | null }): boolean =>
  data.minQuantity === undefined ||
  data.maxQuantity === undefined ||
  data.maxQuantity === null ||
  data.maxQuantity >= data.minQuantity;

export const createInventoryItemSchema = z
  .object({
    shopId: z.string().uuid(),
    name: itemFields.name,
    sku: itemFields.sku.optional(),
    paperSize: itemFields.paperSize.optional(),
    paperType: itemFields.paperType.optional(),
    weightGsm: itemFields.weightGsm.optional(),
    minQuantity: itemFields.minQuantity.optional(),
    maxQuantity: itemFields.maxQuantity.optional(),
    location: itemFields.location.optional(),
    unitCostMinor: itemFields.unitCostMinor.optional(),
    /** Recorded as an audited ADJUSTMENT movement, never a bare column write. */
    initialQuantity: quantity.optional(),
  })
  .refine(maxNotBelowMin, {
    message: "maxQuantity must be at least minQuantity.",
    path: ["maxQuantity"],
  });
export type CreateInventoryItemInput = z.infer<typeof createInventoryItemSchema>;

/** A PATCH: metadata only. `quantity` is deliberately absent and `.strict()`
 * turns sending it into a 400 -- stock changes only through movements. `null`
 * clears an optional field. */
export const updateInventoryItemSchema = z
  .object({
    name: itemFields.name.optional(),
    sku: itemFields.sku.nullable().optional(),
    paperSize: itemFields.paperSize.nullable().optional(),
    paperType: itemFields.paperType.nullable().optional(),
    weightGsm: itemFields.weightGsm.nullable().optional(),
    minQuantity: itemFields.minQuantity.optional(),
    maxQuantity: itemFields.maxQuantity.nullable().optional(),
    location: itemFields.location.nullable().optional(),
    unitCostMinor: itemFields.unitCostMinor.nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided.",
  })
  .refine(maxNotBelowMin, {
    message: "maxQuantity must be at least minQuantity.",
    path: ["maxQuantity"],
  });
export type UpdateInventoryItemInput = z.infer<typeof updateInventoryItemSchema>;

export const listInventoryItemsQuerySchema = paginationQuerySchema.extend({
  shopId: z.string().uuid(),
  search: z.string().trim().min(1).max(100).optional(),
  paperSize: z.nativeEnum(PaperSize).optional(),
  lowStock: queryBooleanSchema.optional(),
  active: queryBooleanSchema.optional(),
});
export type ListInventoryItemsQueryInput = z.infer<typeof listInventoryItemsQuerySchema>;

export const listInventoryMovementsQuerySchema = paginationQuerySchema;
export type ListInventoryMovementsQueryInput = z.infer<typeof listInventoryMovementsQuerySchema>;

/** Manual movements (§27). Consumption from print jobs and purchase-order
 * receipts are written by the system, but staff may also record any kind by
 * hand. Sign rules: purchases/returns add, consumption removes, the rest
 * (adjustment/transfer/correction) may go either way; an adjustment or
 * correction must say why (the audit trail's whole point). */
export const recordInventoryMovementSchema = z
  .object({
    type: z.nativeEnum(InventoryMovementType),
    quantityDelta: z.number().int().min(-100_000_000).max(100_000_000),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .refine((d) => d.quantityDelta !== 0, {
    message: "quantityDelta must not be zero.",
    path: ["quantityDelta"],
  })
  .refine(
    (d) =>
      !(
        (d.type === InventoryMovementType.PURCHASE || d.type === InventoryMovementType.RETURN) &&
        d.quantityDelta < 0
      ),
    {
      message: "A purchase or return must add stock (positive quantityDelta).",
      path: ["quantityDelta"],
    },
  )
  .refine((d) => !(d.type === InventoryMovementType.CONSUMPTION && d.quantityDelta > 0), {
    message: "A consumption must remove stock (negative quantityDelta).",
    path: ["quantityDelta"],
  })
  .refine(
    (d) =>
      !(
        (d.type === InventoryMovementType.ADJUSTMENT ||
          d.type === InventoryMovementType.CORRECTION) &&
        !d.reason
      ),
    { message: "An adjustment or correction needs a reason.", path: ["reason"] },
  );
export type RecordInventoryMovementInput = z.infer<typeof recordInventoryMovementSchema>;

/** 20.3 (PRD 28): the shop-level inventory-tracking toggle (default off). */
export const getInventorySettingsQuerySchema = z.object({ shopId: z.string().uuid() });
export type GetInventorySettingsQueryInput = z.infer<typeof getInventorySettingsQuerySchema>;

export const updateInventorySettingsSchema = z.object({
  shopId: z.string().uuid(),
  trackingEnabled: z.boolean(),
});
export type UpdateInventorySettingsInput = z.infer<typeof updateInventorySettingsSchema>;

/** 20.5: GET /shop/inventory/alerts (paginated; status defaults to OPEN). */
export const listInventoryAlertsQuerySchema = paginationQuerySchema.extend({
  shopId: z.string().uuid(),
  status: z.enum(["OPEN", "RESOLVED"]).default("OPEN"),
});
export type ListInventoryAlertsQueryInput = z.infer<typeof listInventoryAlertsQuerySchema>;

export const inventorySummaryQuerySchema = z.object({ shopId: z.string().uuid() });
export type InventorySummaryQueryInput = z.infer<typeof inventorySummaryQuerySchema>;
