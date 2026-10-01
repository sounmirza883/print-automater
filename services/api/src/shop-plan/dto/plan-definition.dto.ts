import { createZodDto } from "nestjs-zod";
import {
  createPlanDefinitionSchema,
  updatePlanDefinitionSchema,
} from "@print-automated/validation";

export class CreatePlanDefinitionDto extends createZodDto(createPlanDefinitionSchema) {}

export class UpdatePlanDefinitionDto extends createZodDto(updatePlanDefinitionSchema) {}
