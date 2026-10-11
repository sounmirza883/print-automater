import { createZodDto } from "nestjs-zod";
import { createPlanFeatureSchema, updatePlanFeatureSchema } from "@print-automated/validation";

export class CreatePlanFeatureDto extends createZodDto(createPlanFeatureSchema) {}

export class UpdatePlanFeatureDto extends createZodDto(updatePlanFeatureSchema) {}
