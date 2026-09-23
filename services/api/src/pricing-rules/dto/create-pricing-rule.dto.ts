import { createZodDto } from "nestjs-zod";
import { createPricingRuleSchema } from "@print-automated/validation";

export class CreatePricingRuleDto extends createZodDto(createPricingRuleSchema) {}
