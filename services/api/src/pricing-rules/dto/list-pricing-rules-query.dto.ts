import { createZodDto } from "nestjs-zod";
import { listPricingRulesQuerySchema } from "@print-automated/validation";

export class ListPricingRulesQueryDto extends createZodDto(listPricingRulesQuerySchema) {}
