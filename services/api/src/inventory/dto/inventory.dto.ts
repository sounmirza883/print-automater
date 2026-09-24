import { createZodDto } from "nestjs-zod";
import {
  createInventoryItemSchema,
  listInventoryItemsQuerySchema,
  listInventoryMovementsQuerySchema,
  recordInventoryMovementSchema,
  updateInventoryItemSchema,
  getInventorySettingsQuerySchema,
  updateInventorySettingsSchema,
} from "@print-automated/validation";

export class CreateInventoryItemDto extends createZodDto(createInventoryItemSchema) {}
export class UpdateInventoryItemDto extends createZodDto(updateInventoryItemSchema) {}
export class ListInventoryItemsQueryDto extends createZodDto(listInventoryItemsQuerySchema) {}
export class ListInventoryMovementsQueryDto extends createZodDto(
  listInventoryMovementsQuerySchema,
) {}
export class RecordInventoryMovementDto extends createZodDto(recordInventoryMovementSchema) {}
export class GetInventorySettingsQueryDto extends createZodDto(getInventorySettingsQuerySchema) {}
export class UpdateInventorySettingsDto extends createZodDto(updateInventorySettingsSchema) {}
