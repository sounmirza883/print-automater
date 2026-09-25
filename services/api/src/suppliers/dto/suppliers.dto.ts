import { createZodDto } from "nestjs-zod";
import {
  createSupplierSchema,
  linkSupplierProductSchema,
  listSuppliersQuerySchema,
  listInventoryMovementsQuerySchema,
  updateSupplierProductSchema,
  updateSupplierSchema,
} from "@print-automated/validation";

export class CreateSupplierDto extends createZodDto(createSupplierSchema) {}
export class UpdateSupplierDto extends createZodDto(updateSupplierSchema) {}
export class ListSuppliersQueryDto extends createZodDto(listSuppliersQuerySchema) {}
export class LinkSupplierProductDto extends createZodDto(linkSupplierProductSchema) {}
export class UpdateSupplierProductDto extends createZodDto(updateSupplierProductSchema) {}
/** Plain pagination for the link lists (same shape as movement lists). */
export class PageQueryDto extends createZodDto(listInventoryMovementsQuerySchema) {}
