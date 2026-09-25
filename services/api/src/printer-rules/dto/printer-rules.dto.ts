import { createZodDto } from "nestjs-zod";
import {
  createPrinterRuleSchema,
  listPrinterRulesQuerySchema,
  reorderPrinterRulesSchema,
  updatePrinterRuleSchema,
} from "@print-automated/validation";

export class ListPrinterRulesQueryDto extends createZodDto(listPrinterRulesQuerySchema) {}
export class CreatePrinterRuleDto extends createZodDto(createPrinterRuleSchema) {}
export class UpdatePrinterRuleDto extends createZodDto(updatePrinterRuleSchema) {}
export class ReorderPrinterRulesDto extends createZodDto(reorderPrinterRulesSchema) {}
